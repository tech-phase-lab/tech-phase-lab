import targets from "./push-targets.json" with { type: "json" };

/** Pages a notification tap may open (the same list as public/research-sw.js). */
export const PUSH_OPENABLE: ReadonlySet<string> = new Set(targets.openable);
const FRAGMENT = new RegExp(targets.fragment);

/** Where public/research-sw.js writes a tap down (and the latest notice shown). Keep in step with that file. */
export const PUSH_OPEN_STORE = "tech-phase-push-open";
export const PENDING_OPEN_KEY = "/research-sw/pending-open";
export const DELIVERED_KEY = "/research-sw/delivered";
/** A tap written down longer ago than this is not opened any more: the person has moved on. */
export const PENDING_OPEN_MAX_AGE_MS = 120_000;
const ID = /^[A-Za-z0-9-]{1,64}$/;

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

/** Go to the notice's page. Nothing happens when the app already shows it; only the fragment changes when the app shows that page
 * with another fragment, so the page's own hash handling (e.g. the dashboard's #what-changed view) runs; otherwise a client-side
 * navigation. */
export function openPushPath(path: string, current: { pathname: string; hash: string }, navigation: PushOpenNavigation) {
  const hash = path.indexOf("#");
  const pathname = hash < 0 ? path : path.slice(0, hash);
  const fragment = hash < 0 ? "" : path.slice(hash);
  if (pathname === current.pathname) {
    if (!fragment) return;
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

/** A tap (or a shown notice) the worker wrote down, when it is well formed, on the list and recent. */
export type PushRecord = { id: string; path: string; at: number; tag: string; listed: boolean };
export function pushRecord(value: unknown, now: number): PushRecord | null {
  if (!value || typeof value !== "object") return null;
  const { id, url, at, tag, listed } = value as { id?: unknown; url?: unknown; at?: unknown; tag?: unknown; listed?: unknown };
  if (typeof id !== "string" || !ID.test(id) || typeof at !== "number" || !Number.isFinite(at)) return null;
  // A little room for a clock that moved between the worker's write and this read; never older than the limit.
  if (now - at > PENDING_OPEN_MAX_AGE_MS || at - now > 10_000) return null;
  const path = pushOpenPath({ type: "open", url });
  if (!path) return null;
  return { id, path, at, tag: typeof tag === "string" ? tag.slice(0, 100) : "", listed: listed === true };
}

/** Where the app reads what the worker wrote down. Every method may fail; a failure is the same as "nothing written". */
export type PushOpenSources = {
  /** The worker's records: asked of the worker first, then read from Cache Storage. */
  read: () => Promise<{ pending?: unknown; delivered?: unknown } | null>;
  /** Forget one record (the worker and the store), so it is opened once. */
  clear: (id: string) => Promise<void>;
  /** Ids of the notices with this tag still shown on the device, or null when the device cannot say. */
  shown: (tag: string) => Promise<string[] | null>;
};
export type PushOpenerOptions = {
  sources: PushOpenSources;
  location: () => { origin: string; pathname: string; hash: string };
  navigation: PushOpenNavigation;
  now?: () => number;
};

/** Nov 15 (iPhone home-screen app): a tap must open its page however the app learns of it — the worker's message, the tap the
 * worker wrote down (read when the app is shown again), or, when iOS never tells the worker about the tap, the notice having gone
 * from the device. Each tap is opened once, whichever way arrives first. */
export function createPushOpener({ sources, location, navigation, now = Date.now }: PushOpenerOptions) {
  const handled = new Set<string>();
  let delivered: PushRecord | null = null;
  let checking: Promise<string | null> | null = null;
  const forget = (id: string) => { void sources.clear(id).catch(() => { /* written down again only by a new tap */ }); };
  function open(record: PushRecord) {
    if (handled.has(record.id)) return null;
    handled.add(record.id);
    if (delivered?.id === record.id) delivered = null;
    forget(record.id);
    openPushPath(record.path, location(), navigation);
    return record.path;
  }
  function message(event: MessageLike): string | null {
    const here = location();
    if (event.origin && event.origin !== here.origin) return null;
    const data = event.data as { type?: unknown; id?: unknown } | null;
    if (data && typeof data === "object" && data.type === "delivered") {
      const record = pushRecord(data, now());
      if (record && !handled.has(record.id) && (!delivered || record.at >= delivered.at)) delivered = record;
      return null;
    }
    const path = pushOpenPath(data);
    if (!path) return null;
    const id = typeof data?.id === "string" && ID.test(data.id) ? data.id : null;
    const fresh = !id || !handled.has(id);
    if (id) { handled.add(id); if (delivered?.id === id) delivered = null; forget(id); }
    if (fresh) openPushPath(path, here, navigation);
    try { event.ports?.[0]?.postMessage({ type: "opened" }); } catch { /* the worker stopped waiting; the page has moved anyway */ }
    return fresh ? path : null;
  }
  async function run(): Promise<string | null> {
    const at = now();
    const stored = await sources.read().catch(() => null);
    const pending = pushRecord(stored?.pending, at);
    if (pending) {
      if (!handled.has(pending.id)) return open(pending);
      forget(pending.id);
    } else {
      const old = stored?.pending as { id?: unknown } | null | undefined;
      if (old && typeof old.id === "string" && ID.test(old.id)) forget(old.id); // too old or off the list: never opened
    }
    const written = pushRecord(stored?.delivered, at);
    if (written && !handled.has(written.id) && (!delivered || written.at > delivered.at)) delivered = written;
    if (delivered && !pushRecord({ ...delivered, url: delivered.path }, at)) delivered = null;
    const candidate = delivered;
    // Only a notice the device listed when it was shown, and lists no more, counts as tapped.
    if (!candidate || !candidate.listed || handled.has(candidate.id)) return null;
    const ids = await sources.shown(candidate.tag).catch(() => null);
    if (!ids || ids.includes(candidate.id) || delivered?.id !== candidate.id) return null;
    return open(candidate);
  }
  /** Look for a tap to open. Calls made while a look is running share it. */
  function check(): Promise<string | null> {
    if (!checking) checking = run().finally(() => { checking = null; });
    return checking;
  }
  /** Whether a recent notice is still being watched for a tap (the listener keeps looking while the app is shown). */
  function watching() { return Boolean(delivered && !handled.has(delivered.id) && delivered.listed && now() - delivered.at <= PENDING_OPEN_MAX_AGE_MS); }
  return { message, check, watching };
}

type WorkerLike = { postMessage: (message: unknown, transfer: Transferable[]) => void };
type RegistrationLike = { active?: WorkerLike | null; getNotifications?: (options?: { tag?: string }) => Promise<ReadonlyArray<{ data?: unknown }>> };
type ContainerLike = { controller?: WorkerLike | null; getRegistration: (scope?: string) => Promise<RegistrationLike | undefined> };
type StoreLike = { match: (request: string) => Promise<{ json: () => Promise<unknown> } | undefined>; delete: (request: string) => Promise<boolean> };
type CachesLike = { open: (name: string) => Promise<StoreLike> };
type PortLike = { onmessage: ((event: { data: unknown }) => void) | null; close?: () => void };
/** How long the app waits for the worker to answer before relying on Cache Storage alone. */
export const PENDING_QUERY_TIMEOUT_MS = 1000;

/** The app's view of what the worker wrote down. The worker is asked first (its controller, or registration.active when this page
 * is not controlled yet): on iOS a page may not see what the worker has just written to Cache Storage until it reloads. */
export function browserPushOpenSources(container: ContainerLike, caches: CachesLike | undefined, origin: string,
  channel: () => { port1: PortLike; port2: Transferable } = () => new MessageChannel() as unknown as { port1: PortLike; port2: Transferable },
  timeout: (fn: () => void, ms: number) => unknown = setTimeout): PushOpenSources {
  const worker = async () => container.controller ?? (await container.getRegistration("/research").catch(() => undefined))?.active ?? null;
  const key = (name: string) => new URL(name, origin).href;
  async function fromStore() {
    if (!caches) return null;
    const store = await caches.open(PUSH_OPEN_STORE);
    const read = async (name: string) => { const found = await store.match(key(name)); return found ? await found.json().catch(() => null) : null; };
    return { pending: await read(PENDING_OPEN_KEY), delivered: await read(DELIVERED_KEY) };
  }
  async function fromWorker(): Promise<{ pending?: unknown; delivered?: unknown } | null> {
    const target = await worker();
    if (!target) return null;
    return new Promise(resolve => {
      const { port1, port2 } = channel();
      let settled = false;
      const finish = (value: { pending?: unknown; delivered?: unknown } | null) => {
        if (settled) return;
        settled = true; port1.onmessage = null;
        try { port1.close?.(); } catch { /* already closed */ }
        resolve(value);
      };
      timeout(() => finish(null), PENDING_QUERY_TIMEOUT_MS);
      port1.onmessage = event => {
        const data = event.data as { type?: unknown; pending?: unknown; delivered?: unknown } | null;
        if (data?.type === "pending") finish({ pending: data.pending, delivered: data.delivered });
      };
      try { target.postMessage({ type: "pending-query" }, [port2]); } catch { finish(null); }
    });
  }
  return {
    async read() {
      // The worker's answer is authoritative (it is what wrote and cleared the records); the store only stands in when it is silent.
      return await fromWorker().catch(() => null) ?? await fromStore().catch(() => null);
    },
    async clear(id) {
      try { (await worker())?.postMessage({ type: "pending-clear", id }, []); } catch { /* the store is cleared below */ }
      if (!caches) return;
      const store = await caches.open(PUSH_OPEN_STORE);
      for (const name of [PENDING_OPEN_KEY, DELIVERED_KEY]) {
        const found = await store.match(key(name));
        const record = found ? await found.json().catch(() => null) as { id?: unknown } | null : null;
        if (record?.id === id) await store.delete(key(name));
      }
    },
    async shown(tag) {
      const registration = await container.getRegistration("/research");
      if (!registration?.getNotifications) return null;
      const notices = await registration.getNotifications(tag ? { tag } : undefined);
      return notices.map(notice => (notice.data as { id?: unknown } | undefined)?.id).filter((id): id is string => typeof id === "string");
    },
  };
}
