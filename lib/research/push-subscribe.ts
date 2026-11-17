/** Nov 17 (owner's iPhone home-screen app): turning notifications off and straight back on failed on the first tap almost every
 * time and worked on the second. No register request reached the server on the failing tap, so the failure was on the phone, between
 * the tap and the register call: the push subscription itself. On iOS WebKit, PushManager.subscribe() right after
 * PushSubscription.unsubscribe() (and a getSubscription() read in that moment) can reject although the same call works a moment later,
 * and the old code subscribed on the registration returned by register() with no second chance, showing the raw browser message.
 *
 * enablePushDevice() now waits for the ready worker, drops only a subscription that is really stale (another server key, or expired),
 * and retries a transient subscribe or network failure once after PUSH_ENABLE_RETRY_MS. It never asks for permission: that stays in the
 * tap handler. A refusal from the server is not retried. Every failure is reported as a stage and an error name only. */

export const PUSH_ENABLE_RETRY_MS = 800;
export const PUSH_READY_TIMEOUT_MS = 10_000;
/** Where the enable flow failed. */
export const PUSH_ENABLE_STAGES = ["worker", "lookup", "unsubscribe", "subscribe", "register"] as const;
/** Error names worth a log line; anything else is logged as "Other". */
export const PUSH_ENABLE_ERROR_NAMES = ["AbortError", "InvalidStateError", "InvalidAccessError", "NotAllowedError", "NotSupportedError",
  "NetworkError", "SecurityError", "TimeoutError", "TypeError", "UnknownError", "Error", "Other"] as const;
export const PUSH_ENABLE_RETRY = ["ok", "failed", "none"] as const;
export type PushEnableStage = (typeof PUSH_ENABLE_STAGES)[number];
export type PushEnableErrorName = (typeof PUSH_ENABLE_ERROR_NAMES)[number];
/** The whole report: no endpoint, no key, no member, no message text. */
export type PushEnableReport = { stage: PushEnableStage; name: PushEnableErrorName; retry: (typeof PUSH_ENABLE_RETRY)[number];
  retryStage?: PushEnableStage; retryName?: PushEnableErrorName };

export function pushErrorName(error: unknown): PushEnableErrorName {
  const name = error && typeof error === "object" ? (error as { name?: unknown }).name : undefined;
  return typeof name === "string" && (PUSH_ENABLE_ERROR_NAMES as readonly string[]).includes(name) ? name as PushEnableErrorName : "Other";
}

/** A failed enable after its retry (or one that is not worth retrying). `original` keeps the original error for its message. */
export class PushEnableError extends Error {
  readonly stage: PushEnableStage;
  readonly errorName: PushEnableErrorName;
  readonly original: unknown;
  constructor(stage: PushEnableStage, errorName: PushEnableErrorName, original: unknown) {
    super(`push enable failed at ${stage}: ${errorName}`);
    this.name = "PushEnableError"; this.stage = stage; this.errorName = errorName; this.original = original;
  }
}

export type SubscriptionLike = { endpoint?: string; expirationTime?: number | null; options?: { applicationServerKey?: ArrayBuffer | null };
  unsubscribe: () => Promise<boolean> };
export type PushRegistrationLike<S extends SubscriptionLike> = { pushManager: {
  getSubscription: () => Promise<S | null>;
  subscribe: (options: { userVisibleOnly: true; applicationServerKey: Uint8Array<ArrayBuffer> }) => Promise<S>;
} };

/** Stale: made for another server key, or already expired. Unknown key (older browsers) is not stale. */
export function staleSubscription(subscription: SubscriptionLike, key: Uint8Array, now = Date.now()): boolean {
  if (typeof subscription.expirationTime === "number" && subscription.expirationTime <= now) return true;
  const held = subscription.options?.applicationServerKey;
  if (!held) return false;
  const bytes = new Uint8Array(held);
  return bytes.length !== key.length || bytes.some((value, index) => value !== key[index]);
}

/** A server refusal (the request reached the server) is final; a network failure before it (TypeError) never reached it. */
function retryable(stage: PushEnableStage, error: unknown): boolean {
  const name = pushErrorName(error);
  if (name === "NotAllowedError") return false; // permission: a retry cannot change it, and must not ask again
  if (stage === "register") return name === "TypeError";
  return true;
}

export async function enablePushDevice<S extends SubscriptionLike, R>({ prepare, key, register, subscribed = () => {}, wait, report }: {
  /** attempt 1: the registration from register(), its worker active; attempt 2: navigator.serviceWorker.ready. */
  prepare: (attempt: 1 | 2) => Promise<PushRegistrationLike<S>>;
  key: Uint8Array<ArrayBuffer>;
  /** The server call; throw to refuse. */
  register: (subscription: S) => Promise<R>;
  subscribed?: (subscription: S) => void;
  wait: (ms: number) => Promise<void>;
  report: (report: PushEnableReport) => void;
}): Promise<{ subscription: S; result: R; attempts: 1 | 2 }> {
  let first: { stage: PushEnableStage; name: PushEnableErrorName } | null = null;
  for (const attempt of [1, 2] as const) {
    let stage: PushEnableStage = "worker";
    try {
      const registration = await prepare(attempt);
      stage = "lookup";
      let subscription = await registration.pushManager.getSubscription();
      if (subscription && staleSubscription(subscription, key)) {
        stage = "unsubscribe";
        await subscription.unsubscribe();
        subscription = null;
      }
      stage = "subscribe";
      subscription ??= await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
      subscribed(subscription);
      stage = "register";
      const result = await register(subscription);
      if (first) report({ ...first, retry: "ok" });
      return { subscription, result, attempts: attempt };
    } catch (error) {
      const name = pushErrorName(error);
      if (first) { report({ ...first, retry: "failed", retryStage: stage, retryName: name }); throw new PushEnableError(stage, name, error); }
      if (!retryable(stage, error)) {
        // A refusal from the server carries its own message and is not a phone failure: report only phone-side failures.
        if (stage !== "register") report({ stage, name, retry: "none" });
        if (stage === "register") throw error;
        throw new PushEnableError(stage, name, error);
      }
      first = { stage, name };
      await wait(PUSH_ENABLE_RETRY_MS);
    }
  }
  throw new Error("unreachable");
}

/** The ready registration, or a TimeoutError when none becomes active in time. */
export function readyWithin<R>(ready: Promise<R> | undefined, ms = PUSH_READY_TIMEOUT_MS,
  timer: (fn: () => void, ms: number) => unknown = setTimeout): Promise<R> {
  if (!ready) return Promise.reject(Object.assign(new Error("Service worker unavailable"), { name: "InvalidStateError" }));
  return new Promise((resolve, reject) => {
    timer(() => reject(Object.assign(new Error("Service worker timeout"), { name: "TimeoutError" })), ms);
    ready.then(resolve, reject);
  });
}

/** The report as sent and logged, reduced to the known words. null: nothing usable. */
export function cleanPushEnableReport(value: unknown): PushEnableReport | null {
  if (!value || typeof value !== "object") return null;
  const input = value as Record<string, unknown>;
  const pick = <T extends string>(list: readonly T[], item: unknown) => typeof item === "string" && (list as readonly string[]).includes(item) ? item as T : undefined;
  // Any other error name is kept only as "Other": never free text in the log.
  const errorName = (item: unknown) => typeof item === "string" ? pushErrorName({ name: item }) : undefined;
  const stage = pick(PUSH_ENABLE_STAGES, input.stage), name = errorName(input.name), retry = pick(PUSH_ENABLE_RETRY, input.retry);
  if (!stage || !name || !retry) return null;
  const out: PushEnableReport = { stage, name, retry };
  const retryStage = pick(PUSH_ENABLE_STAGES, input.retryStage), retryName = errorName(input.retryName);
  if (retry === "failed" && retryStage && retryName) { out.retryStage = retryStage; out.retryName = retryName; }
  return out;
}

export function pushEnableReportLine(report: PushEnableReport): string {
  const parts = [`stage=${report.stage}`, `name=${report.name}`, `retry=${report.retry}`];
  if (report.retryStage) parts.push(`retryStage=${report.retryStage}`, `retryName=${report.retryName}`);
  return parts.join(" ");
}
