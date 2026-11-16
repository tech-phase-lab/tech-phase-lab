import targets from "./push-targets.json" with { type: "json" };
import { PUSH_SERVER_LOOK_MS, serverNoticeAction, serverNoticeRecord, type PushServerNotices } from "./push-server-notice.ts";

/** Pages a notification tap may open (the same list as public/research-sw.js). */
export const PUSH_OPENABLE: ReadonlySet<string> = new Set(targets.openable);
const FRAGMENT = new RegExp(targets.fragment);

/** Where public/research-sw.js writes a tap down (and the latest notice shown). Keep in step with that file. */
export const PUSH_OPEN_STORE = "tech-phase-push-open";
export const PENDING_OPEN_KEY = "/research-sw/pending-open";
export const DELIVERED_KEY = "/research-sw/delivered";
export const DIAG_KEY = "/research-sw/diagnostic";
/** A tap written down longer ago than this is not opened any more: the person has moved on. */
export const PENDING_OPEN_MAX_AGE_MS = 120_000;
/** Nov 16: the owner's test notice arrived at 10:03 but the app came to the front more than 2 minutes later, so no banner was shown.
 * The latest notice not yet opened or dismissed now gets the banner when the app is shown within 30 minutes of it, */
export const PUSH_BANNER_RECENT_MS = 30 * 60_000;
/** or at any time up to a day while the phone still lists it (it has been neither tapped nor swiped away). */
export const PUSH_BANNER_LISTED_MS = 24 * 3600_000;
/** A notice the worker saw listed right after showing it, gone from the list when the app comes to the front at most this long after
 * it arrived, was tapped: the tap brought the app up (WebKit 282935 never tells the worker). Swiping it away and opening the app within
 * these seconds is the only way to be wrong, so only that case moves the app; any other notice gone from the list gets the banner. */
export const PUSH_TAP_GAP_MS = 10_000;
const ID = /^[A-Za-z0-9-]{1,64}$/;
/** The tag the monitor gives the "send a test notification" notice (scripts/research/web_push.py). Owner, Nov 16: no banner for it. */
export const PUSH_TEST_TAG = "tech-phase-test";

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
/** listed: the worker found the notice in the phone's list right after showing it. test: the test notice (never a banner). */
export type PushRecord = { id: string; path: string; at: number; tag: string; title: string; listed: boolean; test: boolean };
export function pushRecord(value: unknown, now: number, maxAge = PENDING_OPEN_MAX_AGE_MS): PushRecord | null {
  if (!value || typeof value !== "object") return null;
  const { id, url, at, tag, title, listed } = value as { id?: unknown; url?: unknown; at?: unknown; tag?: unknown; title?: unknown; listed?: unknown };
  if (typeof id !== "string" || !ID.test(id) || typeof at !== "number" || !Number.isFinite(at)) return null;
  // A little room for a clock that moved between the worker's write and this read; never older than the limit.
  if (now - at > maxAge || at - now > 10_000) return null;
  const path = pushOpenPath({ type: "open", url });
  if (!path) return null;
  return { id, path, at, tag: typeof tag === "string" ? tag.slice(0, 100) : "",
    title: typeof title === "string" ? title.replace(/[\u0000-\u001f\u007f]+/g, " ").trim().slice(0, 100) : "", listed: listed === true,
    test: tag === PUSH_TEST_TAG };
}

/** The in-app banner for a notice that arrived a moment ago: 「新しい通知：<title>」 with 開く and ✕. */
export type PushBanner = { id: string; path: string; title: string };
/** How long the banner stays before it hides itself. */
export const PUSH_BANNER_MS = 15_000;

/** Where the app reads what the worker wrote down. Every method may fail; a failure is the same as "nothing written". */
export type PushOpenSources = {
  /** The worker's records: asked of the worker first, then read from Cache Storage. `source` says which answered. */
  read: () => Promise<{ pending?: unknown; delivered?: unknown; diag?: unknown; source?: "worker" | "store" } | null>;
  /** Forget one record (the worker and the store), so it is opened or shown once. */
  clear: (id: string) => Promise<void>;
  /** Ids of the notices with this tag still shown on the device, or null when the device cannot say (step record only). */
  shown: (tag: string) => Promise<string[] | null>;
};
/** The step record (lib/research/push-diagnostic.ts); optional, so the opener works without it. */
export type PushOpenDiagnostics = {
  fromWorker: (value: unknown) => void;
  note: (patch: Record<string, unknown>, id?: string) => void;
};
export type PushOpenerOptions = {
  sources: PushOpenSources;
  location: () => { origin: string; pathname: string; hash: string };
  navigation: PushOpenNavigation;
  /** Show (a notice) or hide (null) the in-app banner. */
  banner?: (notice: PushBanner | null) => void;
  diagnostics?: PushOpenDiagnostics;
  /** Nov 16: the notices the server sent this device (lib/research/push-server-notice.ts). Works on its own when the worker says nothing. */
  server?: PushServerNotices;
  now?: () => number;
};
/** The same notice seen by both the worker and the server: same page and title, sent within a few minutes of each other. */
const SAME_NOTICE_MS = 5 * 60_000;

/** Nov 15 (iPhone home-screen app): a tap must open its page however the app learns of it — the worker's message or the tap the
 * worker wrote down (read when the app is shown again). iOS may never tell the worker about a tap on an app that is already open
 * (WebKit 282935; the owner's iPhone stayed on the home page after #597), so a notice that arrived while the app is shown, or within
 * 30 minutes before it is shown again (or still in the phone's list, up to a day), also gets an in-app banner with an 開く button.
 * A notice gone from the phone's list is taken for a tap only when the worker saw it listed and the app came to the front at most
 * 10 seconds after it arrived (PUSH_TAP_GAP_MS); otherwise it gets the banner, so a swiped-away notice does not move the app by itself.
 * Each notice is opened or shown once. */
export function createPushOpener({ sources, location, navigation, banner = () => {}, diagnostics, server, now = Date.now }: PushOpenerOptions) {
  const handled = new Set<string>();
  // Ids of notices the server reported (they are marked opened or dismissed on the server, not in the worker's store).
  const fromServer = new Set<string>();
  let latestServer: PushRecord | null = null;
  let serverAskedAt: number | null = null;
  let serverDue = true;
  let delivered: PushRecord | null = null;
  let showing: PushRecord | null = null;
  let checking: Promise<string | null> | null = null;
  // When the app last came to the front (from the background, or launched); the listener says so.
  let foregroundAt: number | null = null;
  const note = (patch: Record<string, unknown>, id?: string) => { try { diagnostics?.note(patch, id); } catch { /* the record is best effort */ } };
  const forget = (id: string) => { void sources.clear(id).catch(() => { /* written down again only by a new notice */ }); };
  const same = (a: PushRecord, b: PushRecord) => a.path === b.path && a.title === b.title && Math.abs(a.at - b.at) <= SAME_NOTICE_MS;
  function tellServer(id: string, state: "opened" | "dismissed") {
    if (!server || !fromServer.has(id)) return;
    void server.mark(id, state).catch(() => { /* not marked: offered again at most until it is 30 minutes old */ });
  }
  /** Close a notice where it was written down, and its twin: the worker's record of a notice and the server's are the same notice. */
  function settle(record: PushRecord, state: "opened" | "dismissed" | "timeout") {
    if (fromServer.has(record.id)) {
      if (state !== "timeout") tellServer(record.id, state);
      if (delivered && delivered.id !== record.id && !handled.has(delivered.id) && same(delivered, record)) {
        handled.add(delivered.id);
        forget(delivered.id);
        delivered = null;
      }
      return;
    }
    forget(record.id);
    const twin = latestServer;
    if (twin && twin.id !== record.id && !handled.has(twin.id) && same(twin, record)) {
      handled.add(twin.id);
      if (state !== "timeout") tellServer(twin.id, state);
    }
  }
  function hide(id?: string) {
    if (!showing || (id !== undefined && showing.id !== id)) return;
    showing = null;
    banner(null);
  }
  function show(record: PushRecord) {
    // Owner, Nov 16: the banner is for real notices only; a test notice is never shown here (a tap on it still opens its page).
    if (record.test || handled.has(record.id) || showing?.id === record.id) return;
    showing = record;
    note({ banner: now() }, record.id);
    banner({ id: record.id, path: record.path, title: record.title });
  }
  function open(record: PushRecord, via: "pending" | "banner" | "gone-after-tap" | "server-tap") {
    if (handled.has(record.id)) return null;
    handled.add(record.id);
    if (delivered?.id === record.id) delivered = null;
    hide(record.id);
    settle(record, "opened");
    openPushPath(record.path, location(), navigation);
    note({ navigated: now(), via }, record.id);
    return record.path;
  }
  function message(event: MessageLike): string | null {
    const here = location();
    if (event.origin && event.origin !== here.origin) return null;
    const data = event.data as { type?: unknown; id?: unknown } | null;
    if (data && typeof data === "object" && data.type === "delivered") {
      serverDue = true;
      const record = pushRecord(data, now());
      if (record && !handled.has(record.id) && (!delivered || record.at >= delivered.at)) { delivered = record; show(record); }
      return null;
    }
    const path = pushOpenPath(data);
    if (!path) return null;
    const id = typeof data?.id === "string" && ID.test(data.id) ? data.id : null;
    const fresh = !id || !handled.has(id);
    if (id) { handled.add(id); if (delivered?.id === id) delivered = null; hide(id); forget(id); }
    if (fresh) { openPushPath(path, here, navigation); if (id) note({ navigated: now(), via: "worker-message" }, id); }
    // The server's record of the same notice (same page, sent a moment ago) is opened too.
    const twin = latestServer;
    if (fresh && twin && !handled.has(twin.id) && twin.path === path && Math.abs(now() - twin.at) <= SAME_NOTICE_MS) {
      handled.add(twin.id); hide(twin.id); tellServer(twin.id, "opened");
    }
    try { event.ports?.[0]?.postMessage({ type: "opened" }); } catch { /* the worker stopped waiting; the page has moved anyway */ }
    return fresh ? path : null;
  }
  /** The server's newest notice for this device: asked on every return to the front, and otherwise at most every 10 seconds. */
  async function askServer(at: number) {
    if (!server || (!serverDue && serverAskedAt !== null && at - serverAskedAt < PUSH_SERVER_LOOK_MS)) return;
    serverDue = false; serverAskedAt = at;
    const record = serverNoticeRecord(await server.recent().catch(() => null), now());
    if (!record) return;
    fromServer.add(record.id);
    if (handled.has(record.id) || latestServer?.id === record.id) return;
    latestServer = { id: record.id, path: record.path, at: record.at, tag: record.test ? PUSH_TEST_TAG : "", title: record.title, listed: false,
      test: record.test };
    note({ server: now() }, record.id);
  }
  async function run(): Promise<string | null> {
    const at = now();
    const [stored] = await Promise.all([sources.read().catch(() => null), askServer(at).catch(() => { /* same as no notice */ })]);
    if (stored?.diag) { try { diagnostics?.fromWorker(stored.diag); } catch { /* best effort */ } }
    note(stored?.source === "worker" ? { query: at } : stored?.source === "store" ? { queryTimeout: at, store: at } : { queryTimeout: at });
    const pending = pushRecord(stored?.pending, at);
    if (pending) {
      note({ pending: at }, pending.id);
      if (!handled.has(pending.id)) return open(pending, "pending");
      forget(pending.id);
    } else {
      const old = stored?.pending as { id?: unknown } | null | undefined;
      if (old && typeof old.id === "string" && ID.test(old.id)) forget(old.id); // too old or off the list: never opened
    }
    const written = pushRecord(stored?.delivered, at, PUSH_BANNER_LISTED_MS);
    if (written && !handled.has(written.id) && (!delivered || written.at > delivered.at)) delivered = written;
    if (delivered && !pushRecord({ ...delivered, url: delivered.path }, at, PUSH_BANNER_LISTED_MS)) { if (showing?.id === delivered.id) hide(); delivered = null; }
    // Nov 16: the server's record of a notice it sent this device, which works without the worker. The app came to the front within
    // 15 seconds of the send (PUSH_SERVER_TAP_MS): a tap brought it up, so its page opens. Otherwise the banner, unless the banner
    // already shows the worker's record of the same notice. A test notice opens the same way but never gets the banner.
    const sent = latestServer;
    if (sent && !handled.has(sent.id) && at - sent.at <= PUSH_BANNER_RECENT_MS) {
      if (serverNoticeAction(sent, foregroundAt) === "open") return open(sent, "server-tap");
      if (!sent.test) {
        if (!showing || (showing.id !== sent.id && !same(showing, sent))) show(sent);
        return null;
      }
    }
    const candidate = delivered;
    if (!candidate || handled.has(candidate.id)) return null;
    const ids = await sources.shown(candidate.tag).catch(() => null);
    const listed = ids ? ids.includes(candidate.id) : null;
    note({ stillListed: listed }, candidate.id);
    if (delivered?.id !== candidate.id || handled.has(candidate.id)) return null;
    // Gone from the list, seen listed by the worker when shown, and the app came to the front within 10 seconds of the notice: a tap.
    if (listed === false && candidate.listed && foregroundAt !== null && foregroundAt >= candidate.at && foregroundAt - candidate.at <= PUSH_TAP_GAP_MS) {
      return open(candidate, "gone-after-tap");
    }
    if (listed === true || at - candidate.at <= PUSH_BANNER_RECENT_MS) show(candidate);
    return null;
  }
  /** Look for a tap to open (or a new notice to show). Calls made while a look is running share it. */
  function check(): Promise<string | null> {
    if (!checking) checking = run().finally(() => { checking = null; });
    return checking;
  }
  /** 開く on the banner: go to the notice's page. */
  function openBanner(): string | null {
    if (!showing) return null;
    const record = showing;
    note({ bannerOpen: now() }, record.id);
    return open(record, "banner");
  }
  /** ✕ (or the 15-second timer): hide the banner and do not show this notice again. */
  function dismissBanner(reason: "close" | "timeout" = "close") {
    if (!showing) return;
    const record = showing;
    handled.add(record.id);
    if (delivered?.id === record.id) delivered = null;
    note(reason === "close" ? { bannerClose: now() } : { bannerTimeout: now() }, record.id);
    // ✕ marks the server's notice dismissed; the 15-second timer only hides it here (offered again until it is 30 minutes old).
    settle(record, reason === "close" ? "dismissed" : "timeout");
    hide(record.id);
  }
  /** The app came to the front (or was launched) at this time; the listener calls it before the looks that follow. */
  function foreground(at: number = now()) { foregroundAt = at; }
  return { message, check, openBanner, dismissBanner, foreground, banner:() => showing && { id: showing.id, path: showing.path, title: showing.title } };
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
    return { pending: await read(PENDING_OPEN_KEY), delivered: await read(DELIVERED_KEY), diag: await read(DIAG_KEY), source: "store" as const };
  }
  type Read = { pending?: unknown; delivered?: unknown; diag?: unknown; source: "worker" | "store" };
  async function fromWorker(): Promise<Read | null> {
    const target = await worker();
    if (!target) return null;
    return new Promise(resolve => {
      const { port1, port2 } = channel();
      let settled = false;
      const finish = (value: Read | null) => {
        if (settled) return;
        settled = true; port1.onmessage = null;
        try { port1.close?.(); } catch { /* already closed */ }
        resolve(value);
      };
      timeout(() => finish(null), PENDING_QUERY_TIMEOUT_MS);
      port1.onmessage = event => {
        const data = event.data as { type?: unknown; pending?: unknown; delivered?: unknown; diag?: unknown } | null;
        if (data?.type === "pending") finish({ pending: data.pending, delivered: data.delivered, diag: data.diag, source: "worker" });
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
