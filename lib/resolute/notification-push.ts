import { createHash } from "node:crypto";
import type { AlertProvider } from "./notification-delivery.ts";
import type { ResolutePushNotice } from "./push-notice.ts";

/** RESOLUTE ③④ のスマホ通知(オーナー 2026-11-17)。
 * 送る相手・時刻・条件は、これまでどおりRESOLUTEの送信処理(notification-delivery.ts)が自分のDBで確かめる。
 * その直後に、Tech Phaseと同じWeb Push(research monitor の POST /internal/resolute/push、専用トークン)へ、
 * その人の端末に送るよう頼む。1台でも受け付けられたら、それを受付の証拠にしてメールは送らない。
 * 端末の登録がない・全部の端末で失敗した・monitor に届かないときは、これまでのメールで送る(取りこぼし防止)。 */
export type PushResult = { devices: number; accepted: number; failed: number };
export type PushSender = {
  send: (input: { userId: string; key: string; notice: ResolutePushNotice }, signal: AbortSignal) => Promise<PushResult>;
  lookup: (input: { userId: string; key: string }, signal: AbortSignal) => Promise<PushResult>;
};

/** The monitor never sees the outbox key itself (it carries the member id); a short hash identifies the notice per device. */
export function pushEvent(key: string): string {
  return createHash("sha256").update(`resolute-push-v1\n${key}`).digest("hex").slice(0, 32);
}

function count(value: unknown): number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && value <= 100 ? value : -1;
}
function parseResult(value: unknown): PushResult {
  const v = value as Record<string, unknown> | null;
  const result = { devices: count(v?.devices), accepted: count(v?.accepted), failed: count(v?.failed) };
  if (!v || v.ok !== true || result.devices < 0 || result.accepted < 0 || result.failed < 0) throw new Error("Invalid push response");
  return result;
}

/** Explicit configuration only: an https monitor origin and a dedicated token (never printed). */
export function createMonitorPushSender(options: { url: string | undefined; token: string | undefined; request?: typeof fetch }): PushSender | undefined {
  if (!options.url || !options.token) return undefined;
  const base = new URL(options.url);
  if (base.protocol !== "https:" || base.username || base.password || base.search || base.hash || options.token.length < 32) {
    throw new Error("Invalid push monitor configuration");
  }
  const target = new URL("/internal/resolute/push", base.origin);
  const request = options.request ?? fetch;
  async function call(body: Record<string, unknown>, signal: AbortSignal) {
    const response = await request(target, { method: "POST", cache: "no-store", redirect: "error", signal,
      headers: { Authorization: `Bearer ${options.token}`, "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(body) });
    if (!response.ok) { await response.body?.cancel(); throw new Error("Push monitor refused"); }
    const text = await response.text();
    if (text.length > 4096) throw new Error("Invalid push response");
    return parseResult(JSON.parse(text));
  }
  return {
    send: ({ userId, key, notice }, signal) => call({ memberId: userId, event: pushEvent(key), title: notice.title, body: notice.body, url: notice.url }, signal),
    lookup: ({ userId, key }, signal) => call({ memberId: userId, event: pushEvent(key), mode: "lookup" }, signal),
  };
}

const RECEIPT_ID = (accepted: number) => `web-push:${accepted}`;

/** The mail provider, with the phone notification tried first. Same provider name, so the outbox reservation, reconciliation and the
 * mail worker's queries stay as they are; a push receipt is told apart by its message id ("web-push:<devices>"). */
export function withPushFirst(mail: AlertProvider, push: PushSender | undefined, userId: string, now: () => Date = () => new Date()): AlertProvider {
  if (!push) return mail;
  return {
    ...mail,
    async send(input, signal) {
      if (input.push) {
        let result: PushResult | null = null;
        try { result = await push.send({ userId, key: input.key, notice: input.push }, AbortSignal.any([signal, AbortSignal.timeout(8_000)])); }
        catch { result = null; }
        if (result && result.accepted > 0) return { key: input.key, messageId: RECEIPT_ID(result.accepted), acceptedAt: now().toISOString() };
      }
      // No device registered, every device failed, or the monitor could not be reached: the email, as before.
      return mail.send(input, signal);
    },
    async lookup(key, signal) {
      try {
        const result = await push.lookup({ userId, key }, AbortSignal.any([signal, AbortSignal.timeout(8_000)]));
        if (result.accepted > 0) return { key, messageId: RECEIPT_ID(result.accepted), acceptedAt: now().toISOString() };
      } catch { /* fall through to the mail provider's own record */ }
      return mail.lookup(key, signal);
    },
  };
}
