/** Nov 16 (owner's iPhone home-screen app): after #606 a tapped test notice still left the app on home and the step record stayed empty,
 * so the phone was most likely still running an older service worker. The owner's settings page reads what is actually installed
 * (which workers, the version each one answers, permission, display mode, the last push the worker saw) and can install the worker
 * afresh. Owner accounts only (the caller decides). Nothing here leaves the device. */
import { DIAG_KEY, PUSH_OPEN_STORE } from "./push-open.ts";

export const PUSH_SW_URL = "/research-sw.js";
/** The worker covers the whole site (it was always registered with scope "/"); the app looks it up from /research. */
export const PUSH_SW_SCOPE = "/";
/** register() options: the worker script is always fetched from the network when the browser checks for a new version. */
export const PUSH_SW_OPTIONS = { scope: PUSH_SW_SCOPE, updateViaCache: "none" } as const;
export const VERSION_QUERY_TIMEOUT_MS = 1200;
export const ACTIVATE_TIMEOUT_MS = 10_000;

type PortLike = { onmessage: ((event: { data: unknown }) => void) | null; close?: () => void };
type Channel = () => { port1: PortLike; port2: Transferable };
type Timer = (fn: () => void, ms: number) => unknown;
export type WorkerLike = { scriptURL?: string; state?: string; postMessage: (message: unknown, transfer: Transferable[]) => void;
  addEventListener?: (name: "statechange", fn: () => void) => void; removeEventListener?: (name: "statechange", fn: () => void) => void };
export type SubscriptionLike = { endpoint: string; unsubscribe?: () => Promise<boolean> };
export type RegistrationLike = { scope: string; updateViaCache?: string; active?: WorkerLike | null; waiting?: WorkerLike | null;
  installing?: WorkerLike | null; unregister?: () => Promise<boolean>; update?: () => Promise<unknown>; pushManager?: { getSubscription: () => Promise<SubscriptionLike | null> } };
export type ContainerLike = { controller?: WorkerLike | null; getRegistration: (scope?: string) => Promise<RegistrationLike | undefined>;
  getRegistrations?: () => Promise<ReadonlyArray<RegistrationLike>>;
  register?: (url: string, options: typeof PUSH_SW_OPTIONS) => Promise<RegistrationLike> };
type StoreLike = { match: (request: string) => Promise<{ json: () => Promise<unknown> } | undefined> };
type CachesLike = { open: (name: string) => Promise<StoreLike> };

const defaultChannel: Channel = () => new MessageChannel() as unknown as { port1: PortLike; port2: Transferable };

/** Ask one worker its version. null: it did not answer in time (a worker older than 2026-11-16 never answers). */
export function askWorkerVersion(worker: WorkerLike, { channel = defaultChannel, timeout = setTimeout as Timer, ms = VERSION_QUERY_TIMEOUT_MS }:
  { channel?: Channel; timeout?: Timer; ms?: number } = {}): Promise<{ version: string; lastPush: number | null } | null> {
  return new Promise(resolve => {
    let settled = false;
    let port1: PortLike, port2: Transferable;
    try { ({ port1, port2 } = channel()); } catch { resolve(null); return; }
    const finish = (value: { version: string; lastPush: number | null } | null) => {
      if (settled) return;
      settled = true; port1.onmessage = null;
      try { port1.close?.(); } catch { /* already closed */ }
      resolve(value);
    };
    timeout(() => finish(null), ms);
    port1.onmessage = event => {
      const data = event.data as { type?: unknown; version?: unknown; lastPush?: unknown } | null;
      if (data?.type !== "version" || typeof data.version !== "string") return;
      finish({ version: data.version.slice(0, 40), lastPush: typeof data.lastPush === "number" && Number.isFinite(data.lastPush) ? data.lastPush : null });
    };
    try { worker.postMessage({ type: "version-query" }, [port2]); } catch { finish(null); }
  });
}

export type WorkerSlot = "active" | "waiting" | "installing";
/** version: what the worker answered; null: it did not answer (an old version). */
export type WorkerFact = { slot: WorkerSlot; script: string; version: string | null };
export type PushSwFacts = {
  supported: boolean; controlled: boolean; controllerScript: string | null; scope: string | null; updateViaCache: string | null;
  registrations: number | null; workers: WorkerFact[]; permission: string; standalone: boolean | null; lastPush: number | null;
};

/** A script URL as a short path (same-origin), never a full address. */
function scriptPath(url: string | undefined, origin: string): string {
  if (!url) return "?";
  try { const parsed = new URL(url, origin); return parsed.origin === origin ? `${parsed.pathname}${parsed.search}` : parsed.href; } catch { return "?"; }
}

/** What is installed on this device right now, read live from the page. */
export async function readPushSwFacts({ container, caches, origin, permission, standalone, ask = askWorkerVersion }: {
  container: ContainerLike | undefined; caches: CachesLike | undefined; origin: string; permission: string; standalone: boolean | null;
  ask?: (worker: WorkerLike) => Promise<{ version: string; lastPush: number | null } | null>;
}): Promise<PushSwFacts> {
  const facts: PushSwFacts = { supported: Boolean(container), controlled: false, controllerScript: null, scope: null, updateViaCache: null,
    registrations: null, workers: [], permission, standalone, lastPush: null };
  if (container) {
    facts.controlled = Boolean(container.controller);
    facts.controllerScript = container.controller ? scriptPath(container.controller.scriptURL, origin) : null;
    try { facts.registrations = container.getRegistrations ? (await container.getRegistrations()).length : null; } catch { facts.registrations = null; }
    const registration = await container.getRegistration("/research").catch(() => undefined);
    if (registration) {
      facts.scope = scriptPath(registration.scope, origin);
      facts.updateViaCache = registration.updateViaCache ?? null;
      for (const slot of ["active", "waiting", "installing"] as const) {
        const worker = registration[slot];
        if (!worker) continue;
        const answer = await ask(worker).catch(() => null);
        facts.workers.push({ slot, script: scriptPath(worker.scriptURL, origin), version: answer?.version ?? null });
        if (slot === "active" && answer?.lastPush) facts.lastPush = answer.lastPush;
      }
    }
  }
  // An old worker does not answer, but one from 2026-11-15 already wrote the push time to Cache Storage.
  if (facts.lastPush === null && caches) {
    try {
      const found = await (await caches.open(PUSH_OPEN_STORE)).match(new URL(DIAG_KEY, origin).href);
      const record = found ? await found.json() as { push?: unknown } | null : null;
      if (typeof record?.push === "number" && Number.isFinite(record.push)) facts.lastPush = record.push;
    } catch { /* no record */ }
  }
  return facts;
}

export type FactRow = { label: string; value: string };
export function pushSwFactRows(facts: PushSwFacts, lang: "ja" | "en"): FactRow[] {
  const t = (ja: string, en: string) => lang === "ja" ? ja : en;
  const yes = (flag: boolean | null) => flag === null ? t("不明", "unknown") : flag ? t("はい", "yes") : t("いいえ", "no");
  if (!facts.supported) return [{ label: t("サービスワーカー", "Service worker"), value: t("このブラウザでは使えません", "Not available in this browser") }];
  const slot = (name: WorkerSlot) => {
    const worker = facts.workers.find(item => item.slot === name);
    if (!worker) return t("なし", "none");
    return `${worker.script} · ${worker.version ?? t("古い版（応答なし）", "old version (no answer)")}`;
  };
  const permission = { granted: t("許可", "granted"), denied: t("拒否", "denied"), default: t("未選択", "not asked") }[facts.permission as "granted"]
    ?? t("非対応", "unsupported");
  const time = facts.lastPush === null ? t("記録なし", "none recorded")
    : new Date(facts.lastPush).toLocaleString(lang === "ja" ? "ja-JP" : "en-US", { hour12: false, month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit" });
  return [
    { label: t("このページをワーカーが管理", "Page controlled by a worker"), value: facts.controlled ? `${t("はい", "yes")} · ${facts.controllerScript}` : t("いいえ", "no") },
    { label: t("登録の範囲", "Registration scope"), value: facts.scope ?? t("登録なし", "not registered") },
    { label: t("動作中のワーカー", "Active worker"), value: slot("active") },
    { label: t("待機中のワーカー", "Waiting worker"), value: slot("waiting") },
    { label: t("インストール中のワーカー", "Installing worker"), value: slot("installing") },
    { label: t("更新の取得方法", "Update fetch (updateViaCache)"), value: facts.updateViaCache ?? "?" },
    { label: t("この端末の登録の数", "Registrations on this device"), value: facts.registrations === null ? "?" : String(facts.registrations) },
    { label: t("通知の許可", "Notification permission"), value: permission },
    { label: t("ホーム画面のアプリとして起動", "Opened as the home-screen app"), value: yes(facts.standalone) },
    { label: t("ワーカーが最後に通知を受信", "Last push the worker saw"), value: time },
  ];
}

/** Whether a registration is the push worker's: it covers /research, or it runs research-sw.js. */
export function isPushRegistration(registration: RegistrationLike, origin: string): boolean {
  try {
    const path = new URL(registration.scope, origin).pathname;
    if ("/research".startsWith(path) || path.startsWith("/research")) return true;
  } catch { /* fall through to the script */ }
  return [registration.active, registration.waiting, registration.installing]
    .some(worker => worker?.scriptURL !== undefined && scriptPath(worker.scriptURL, origin).split("?")[0] === PUSH_SW_URL);
}

function activated(registration: RegistrationLike, timeout: Timer, ms: number): Promise<void> {
  if (registration.active && !registration.installing && !registration.waiting) return Promise.resolve();
  const worker = registration.installing || registration.waiting;
  if (!worker) return registration.active ? Promise.resolve() : Promise.reject(new Error("no-worker"));
  return new Promise((resolve, reject) => {
    let done = false;
    const changed = () => {
      if (done) return;
      if (worker.state === "activated") { done = true; worker.removeEventListener?.("statechange", changed); resolve(); }
      else if (worker.state === "redundant") { done = true; worker.removeEventListener?.("statechange", changed); reject(new Error("redundant")); }
    };
    timeout(() => { if (done) return; done = true; worker.removeEventListener?.("statechange", changed); reject(new Error("timeout")); }, ms);
    worker.addEventListener?.("statechange", changed);
    changed();
  });
}

export type ReinstallStep = "list" | "unregister" | "register" | "activate" | "subscribe";
export type ReinstallResult = { ok: boolean; failedAt?: ReinstallStep; removed: number; hadSubscription: boolean; registered: boolean;
  keptPreferences: boolean; updateViaCache: string | null };

/** Owner button 「通知の仕組みを入れ直す」: unregister every push-worker registration, register research-sw.js again (never from the
 * HTTP cache), wait until it is active, then subscribe and save this device again through the existing API (`resubscribe`, which gets
 * the previous subscription so the server-side device and its choices can be carried over). */
export async function reinstallPushWorker({ container, origin, resubscribe, timeout = setTimeout as Timer, ms = ACTIVATE_TIMEOUT_MS }: {
  container: ContainerLike; origin: string;
  resubscribe: (registration: RegistrationLike, previous: SubscriptionLike | null) => Promise<{ registered: boolean; keptPreferences?: boolean }>;
  timeout?: Timer; ms?: number;
}): Promise<ReinstallResult> {
  const result: ReinstallResult = { ok: false, removed: 0, hadSubscription: false, registered: false, keptPreferences: false, updateViaCache: null };
  let step: ReinstallStep = "list";
  try {
    const all = container.getRegistrations ? await container.getRegistrations() : [await container.getRegistration("/research")].filter(Boolean) as RegistrationLike[];
    const targets = all.filter(registration => isPushRegistration(registration, origin));
    let previous: SubscriptionLike | null = null;
    for (const registration of targets) {
      if (previous) break;
      try { previous = await registration.pushManager?.getSubscription() ?? null; } catch { previous = null; }
    }
    result.hadSubscription = previous !== null;
    step = "unregister";
    for (const registration of targets) if (await registration.unregister?.()) result.removed++;
    step = "register";
    if (!container.register) throw new Error("no-register");
    const registration = await container.register(PUSH_SW_URL, PUSH_SW_OPTIONS);
    result.updateViaCache = registration.updateViaCache ?? null;
    step = "activate";
    await activated(registration, timeout, ms);
    step = "subscribe";
    const saved = await resubscribe(registration, previous);
    result.registered = saved.registered;
    result.keptPreferences = saved.keptPreferences === true;
    result.ok = saved.registered;
    if (!saved.registered) result.failedAt = "subscribe";
  } catch {
    result.failedAt = step;
  }
  return result;
}

/** On launch and when the app is shown again (PushOpenListener, at most every 10 minutes): ask the browser for a newer worker. A
 * registration made before Nov 16 (updateViaCache "imports") is registered again with updateViaCache "none", which also checks for a new
 * version; one already on "none" is just updated. A device without the worker gets none (it is installed only when notifications are on). */
export async function refreshPushWorker(container: ContainerLike): Promise<"none" | "re-registered" | "updated"> {
  const registration = await container.getRegistration("/research");
  if (!registration) return "none";
  if (registration.updateViaCache !== PUSH_SW_OPTIONS.updateViaCache && container.register) {
    await container.register(PUSH_SW_URL, PUSH_SW_OPTIONS);
    return "re-registered";
  }
  await registration.update?.();
  return "updated";
}

export function reinstallMessage(result: ReinstallResult, lang: "ja" | "en"): string {
  const t = (ja: string, en: string) => lang === "ja" ? ja : en;
  if (result.ok) return t(`入れ直しました（古い登録 ${result.removed} 件を削除、通知の登録を保存${result.keptPreferences ? "、届く内容の設定を引き継ぎ" : ""}）。テスト通知で確かめてください。`,
    `Reinstalled (${result.removed} old registration(s) removed, this device saved${result.keptPreferences ? ", your choices carried over" : ""}). Send a test notification to check.`);
  const step = { list: t("登録の確認", "listing registrations"), unregister: t("古い登録の削除", "removing old registrations"),
    register: t("ワーカーの登録", "registering the worker"), activate: t("ワーカーの起動", "activating the worker"),
    subscribe: t("通知の登録の保存", "saving this device") }[result.failedAt ?? "subscribe"];
  return t(`入れ直しに失敗しました（${step}）。アプリを閉じて開き直してから、もう一度お試しください。`,
    `Reinstall failed (${step}). Close and reopen the app, then try again.`);
}
