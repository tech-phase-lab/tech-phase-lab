/** Nov 16 (owner's iPhone: a test notice after 「通知の仕組みを入れ直す」 never arrived and nothing said why): the monitor's last sends, for the
 * owner's panel. Each one is a short hash of the device id, the push service's host name, the HTTP status the push service answered
 * (201 accepted; 400/403/404/410/413 refused), whether the device is still registered, and when. Never an endpoint, a key, a member or
 * the text. The owner's own phone is marked by comparing the same short hash of its current subscription. */

export type PushSend = { at: number; device: string; host: string; status: number; kind: "test" | "notice"; page: string | null;
  ms: number | null; failure: string | null; gone: boolean; registered: boolean | null };

const HOSTS = new Set(["fcm.googleapis.com", "updates.push.services.mozilla.com", "web.push.apple.com", "other", "?"]);
const DEVICE = /^[a-f0-9]{12}$/;
const PAGE = /^\/research(\/[a-z-]{1,40})?(#[a-z0-9-]{1,40})?$/;
const FAILURE = /^[A-Za-z]{1,40}$/;
export const PUSH_SEND_LOG_SIZE = 10;

/** Only well-formed entries with known fields, newest first, at most ten. */
export function cleanPushSendLog(value: unknown): PushSend[] {
  if (!Array.isArray(value)) return [];
  const items: PushSend[] = [];
  for (const raw of value) {
    if (!raw || typeof raw !== "object") continue;
    const item = raw as Record<string, unknown>;
    if (typeof item.at !== "number" || !Number.isFinite(item.at) || typeof item.device !== "string" || !DEVICE.test(item.device)
      || typeof item.host !== "string" || !HOSTS.has(item.host) || typeof item.status !== "number" || !Number.isInteger(item.status)
      || item.status < 0 || item.status > 999) continue;
    items.push({
      at: item.at, device: item.device, host: item.host, status: item.status, kind: item.kind === "test" ? "test" : "notice",
      page: typeof item.page === "string" && PAGE.test(item.page) ? item.page : null,
      ms: typeof item.ms === "number" && Number.isFinite(item.ms) && item.ms >= 0 ? Math.round(item.ms) : null,
      failure: typeof item.failure === "string" && FAILURE.test(item.failure) ? item.failure : null,
      gone: item.gone === true, registered: typeof item.registered === "boolean" ? item.registered : null,
    });
  }
  return items.sort((a, b) => b.at - a.at).slice(0, PUSH_SEND_LOG_SIZE);
}

/** The same short device hash the monitor uses: the first 12 hex characters of SHA-256(endpoint). */
export async function pushDeviceRef(endpoint: string, subtle: Pick<SubtleCrypto, "digest"> = globalThis.crypto.subtle): Promise<string> {
  const digest = new Uint8Array(await subtle.digest("SHA-256", new TextEncoder().encode(endpoint)));
  return Array.from(digest.slice(0, 6), byte => byte.toString(16).padStart(2, "0")).join("");
}

/** What the push service's answer means, in a few words. */
export function pushSendStatusText(item: Pick<PushSend, "status" | "failure">, lang: "ja" | "en"): string {
  const t = (ja: string, en: string) => lang === "ja" ? ja : en;
  const code = item.status;
  if (code === 0) return t(`送信できず（${item.failure ?? "不明"}）`, `not sent (${item.failure ?? "unknown"})`);
  if (code >= 200 && code < 300) return t(`${code} 受付`, `${code} accepted`);
  const meaning: Record<number, [string, string]> = {
    400: ["不正な要求", "bad request"], 403: ["認証エラー", "authentication refused"], 404: ["登録が無効", "subscription not found"],
    410: ["登録が無効（期限切れ）", "subscription gone"], 413: ["内容が大きすぎる", "payload too large"], 429: ["送りすぎ", "rate limited"],
  };
  const words = meaning[code];
  return words ? `${code} ${t(words[0], words[1])}` : `${code} ${t("拒否", "refused")}`;
}

export type PushSendRow = { key: string; time: string; label: string; detail: string; mine: boolean };
export function pushSendRows(items: PushSend[], lang: "ja" | "en", current: string | null): PushSendRow[] {
  const t = (ja: string, en: string) => lang === "ja" ? ja : en;
  return items.map((item, index) => {
    const mine = current !== null && item.device === current;
    const time = new Date(item.at * 1000).toLocaleString(lang === "ja" ? "ja-JP" : "en-US",
      { hour12: false, month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit" });
    const what = item.kind === "test" ? t("テスト通知", "Test") : t("通知", "Notice");
    const device = `${item.device}${mine ? t("（この端末）", " (this device)") : ""}`;
    const registered = item.registered === null ? t("登録：不明", "registration: unknown")
      : item.registered ? t("登録：あり", "still registered") : t("登録：削除済み", "registration removed");
    return { key: `${item.at}-${item.device}-${index}`, time, mine, label: `${what} · ${pushSendStatusText(item, lang)}`,
      detail: [device, item.host, registered, item.ms === null ? null : `${item.ms}ms`].filter(Boolean).join(" · ") };
  });
}
