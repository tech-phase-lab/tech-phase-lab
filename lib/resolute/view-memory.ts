/** What the RESOLUTE pages last showed in this browser tab, so moving between pages draws the page once
 * with what is already known instead of "Checking…" and "Loading…" first (owner, Nov 17: the screen flipped
 * about three times per move). Every page still asks the server again in the background and replaces it.
 *
 * Kept only in this tab's memory (gone on reload), never in storage, never on the server, and cleared as soon
 * as a different sign-in (or sign-out) is seen, so one account's plan is never shown to another. */
export type ViewMemoryKey = "entitlement" | "locale" | "plan" | "risk" | "notifications" | "today";

let session: string | null | undefined;
const values = new Map<ViewMemoryKey, unknown>();
const inBrowser = () => typeof window !== "undefined";

/** Records the signed-in session (null when signed out). A change forgets everything remembered for the previous one. */
export function viewSession(id: string | null) {
  if (!inBrowser()) return;
  if (session !== id) values.clear();
  session = id;
}

/** The session the remembered values belong to; undefined when nothing is known yet. */
export function lastViewSession() { return inBrowser() ? session : undefined; }

export function recall<T>(key: ViewMemoryKey): T | undefined {
  return inBrowser() ? values.get(key) as T | undefined : undefined;
}

export function remember<T>(key: ViewMemoryKey, value: T) {
  if (inBrowser()) values.set(key, value);
}

export function forget(key?: ViewMemoryKey) {
  if (key) values.delete(key); else values.clear();
}
