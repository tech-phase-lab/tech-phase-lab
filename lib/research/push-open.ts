import targets from "./push-targets.json" with { type: "json" };

/** Pages a notification tap may open (the same list as public/research-sw.js). */
export const PUSH_OPENABLE: ReadonlySet<string> = new Set(targets.openable);
const FRAGMENT = new RegExp(targets.fragment);

/** The page a service-worker "open" message asks for, or null when the message is anything else or names a page off the list. */
export function pushOpenPath(data: unknown): string | null {
  if (!data || typeof data !== "object" || (data as { type?: unknown }).type !== "open") return null;
  const value = (data as { url?: unknown }).url;
  if (typeof value !== "string" || value.length > 200 || !value.startsWith("/") || value.startsWith("//") || /[\\\s]/.test(value)) return null;
  const hash = value.indexOf("#");
  const path = hash < 0 ? value : value.slice(0, hash);
  const fragment = hash < 0 ? "" : value.slice(hash);
  if (!PUSH_OPENABLE.has(path) || (fragment && !FRAGMENT.test(fragment))) return null;
  return path + fragment;
}

export type PushOpenNavigation = { push: (href: string) => void; setHash: (hash: string) => void };

/** Go to the notice's page. Only the fragment changes when the app already shows that page, so the page's own hash handling
 * (e.g. the dashboard's #what-changed view) runs; otherwise a client-side navigation. */
export function openPushPath(path: string, current: { pathname: string; hash: string }, navigation: PushOpenNavigation) {
  const hash = path.indexOf("#");
  const pathname = hash < 0 ? path : path.slice(0, hash);
  const fragment = hash < 0 ? "" : path.slice(hash);
  if (fragment && pathname === current.pathname) {
    if (current.hash !== fragment) navigation.setHash(fragment);
    return;
  }
  navigation.push(path);
}

type MessageLike = { data: unknown; origin?: string; ports?: ReadonlyArray<{ postMessage: (message: unknown) => void }> };

/** Handle one message from the service worker. Returns the page opened, or null when the message was ignored. */
export function handlePushOpenMessage(event: MessageLike, location: { origin: string; pathname: string; hash: string }, navigation: PushOpenNavigation) {
  if (event.origin && event.origin !== location.origin) return null;
  const path = pushOpenPath(event.data);
  if (!path) return null;
  openPushPath(path, location, navigation);
  try { event.ports?.[0]?.postMessage({ type: "opened" }); } catch { /* the worker stopped waiting; the page has moved anyway */ }
  return path;
}
