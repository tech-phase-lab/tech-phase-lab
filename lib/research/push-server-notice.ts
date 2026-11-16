import targets from "./push-targets.json" with { type: "json" };

/** Nov 16 (owner's iPhone, 15:31 and 15:33 JST): Apple's push service accepted two test notices (201), yet the service worker wrote
 * nothing down and a tap left the app on the home page. The monitor now writes every accepted notice down per device
 * (scripts/research/web_push.py, push_notices), and the app asks for the newest one when it comes to the front
 * (POST /api/research/notifications {action:"recent-notice"}), so the in-app banner works without the service worker. */

/** The app came to the front at most this long after the server sent the notice to this device: taken as a tap, the page opens
 * directly. Later than that (or while the app was already shown) the banner 「新しい通知：<title>」 is shown instead. */
export const PUSH_SERVER_TAP_MS = 15_000;
/** The server offers a notice for this long after sending it (scripts/research/web_push.py NOTICE_RECENT_SECONDS). */
export const PUSH_SERVER_RECENT_MS = 30 * 60_000;
/** While the app stays in front, the server is asked again at most this often (a new look after coming to the front always asks). */
export const PUSH_SERVER_LOOK_MS = 10_000;
export const PUSH_NOTICE_ACTIONS = ["recent-notice", "notice-opened", "notice-dismissed", "notice-status"] as const;

const NOTICE_ID = /^[a-f0-9]{32}$/;
const OPENABLE: ReadonlySet<string> = new Set(targets.openable);
const FRAGMENT = new RegExp(targets.fragment);
/** A page on the notification list (the same rule as pushOpenPath in ./push-open, which imports this file). */
function openablePage(value: string): string | null {
  if (value.length > 200 || !value.startsWith("/") || value.startsWith("//") || /[\\\s]/.test(value)) return null;
  const hash = value.indexOf("#");
  const path = hash < 0 ? value : value.slice(0, hash);
  const fragment = hash < 0 ? "" : value.slice(hash);
  return OPENABLE.has(path) && (!fragment || FRAGMENT.test(fragment)) ? path + fragment : null;
}
const KIND = /^[a-z-]{1,40}$/;
const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);

/** One notice as the monitor reports it (times in the monitor's seconds; ageMs is how long ago it was sent, by the monitor's clock). */
export type PushServerNotice = { id: string; kind: string; page: string; title: string; sentAt: number; ageMs: number;
  state: "new" | "opened" | "dismissed"; openedAt: number | null; dismissedAt: number | null };

/** Known fields only, with a page on the notification list: nothing else from the monitor reaches the page. */
export function cleanPushServerNotice(value: unknown): PushServerNotice | null {
  if (!value || typeof value !== "object") return null;
  const item = value as Record<string, unknown>;
  if (typeof item.id !== "string" || !NOTICE_ID.test(item.id) || typeof item.page !== "string" || typeof item.title !== "string"
    || !finite(item.sentAt) || !finite(item.ageMs) || item.ageMs < 0) return null;
  const page = openablePage(item.page);
  const title = item.title.replace(/[\u0000-\u001f\u007f]+/g, " ").trim().slice(0, 100);
  if (!page || !title) return null;
  const state = item.state === "opened" || item.state === "dismissed" ? item.state : "new";
  return { id: item.id, kind: typeof item.kind === "string" && KIND.test(item.kind) ? item.kind : "research", page, title,
    sentAt: item.sentAt, ageMs: Math.round(item.ageMs), state,
    openedAt: finite(item.openedAt) ? item.openedAt : null, dismissedAt: finite(item.dismissedAt) ? item.dismissedAt : null };
}

/** The notice placed on this device's clock: sent `ageMs` before the answer arrived (so a phone clock that is off does not matter). */
export type PushServerRecord = { id: string; path: string; title: string; at: number };
export function serverNoticeRecord(notice: PushServerNotice | null, receivedAt: number): PushServerRecord | null {
  if (!notice || notice.state !== "new" || notice.ageMs > PUSH_SERVER_RECENT_MS) return null;
  return { id: notice.id, path: notice.page, title: notice.title, at: receivedAt - notice.ageMs };
}

/** "open" when the app came to the front within PUSH_SERVER_TAP_MS after the notice was sent (a tap brought it up); "banner" otherwise
 * (the app was already shown when it arrived, or was opened later). */
export function serverNoticeAction(record: Pick<PushServerRecord, "at">, foregroundAt: number | null): "open" | "banner" {
  return foregroundAt !== null && foregroundAt >= record.at && foregroundAt - record.at <= PUSH_SERVER_TAP_MS ? "open" : "banner";
}

/** Where the opener asks the server. Every method may fail; a failure is the same as "no notice". */
export type PushServerNotices = {
  recent: () => Promise<PushServerNotice | null>;
  mark: (id: string, state: "opened" | "dismissed") => Promise<void>;
};

type SubscriptionLike = { toJSON: () => unknown };
type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

/** The browser's way: this device's current push subscription (none: nothing is asked) and the signed-in member's cookie. */
export function browserPushServerNotices(subscription: () => Promise<SubscriptionLike | null | undefined>, fetcher: FetchLike = fetch): PushServerNotices {
  async function ask(body: Record<string, unknown>) {
    const current = await subscription().catch(() => null);
    if (!current) return null;
    const response = await fetcher("/api/research/notifications", { method: "POST", credentials: "same-origin", cache: "no-store",
      headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...body, subscription: current.toJSON() }), signal: AbortSignal.timeout(8000) });
    if (!response.ok) return null;
    return await response.json().catch(() => null) as { ok?: unknown; notice?: unknown } | null;
  }
  return {
    async recent() {
      const result = await ask({ action: "recent-notice" });
      return result?.ok === true ? cleanPushServerNotice(result.notice) : null;
    },
    async mark(id, state) {
      if (!NOTICE_ID.test(id)) return;
      await ask({ action: state === "opened" ? "notice-opened" : "notice-dismissed", noticeId: id });
    },
  };
}

/** The owner's panel: the newest notice the server sent this device, and whether it was opened or dismissed. */
export function pushServerNoticeRows(notice: PushServerNotice | null, lang: "ja" | "en"): { label: string; value: string }[] {
  const t = (ja: string, en: string) => lang === "ja" ? ja : en;
  if (!notice) return [{ label: t("サーバーの通知（この端末）", "Server notice (this device)"), value: t("記録なし（7日以内）", "none in the last 7 days") }];
  const time = (seconds: number) => new Date(seconds * 1000).toLocaleString(lang === "ja" ? "ja-JP" : "en-US",
    { hour12: false, month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit" });
  const state = notice.state === "opened" ? `${t("開いた", "opened")} ${time(notice.openedAt ?? notice.sentAt)}`
    : notice.state === "dismissed" ? `${t("閉じた（✕）", "dismissed (✕)")} ${time(notice.dismissedAt ?? notice.sentAt)}`
    : notice.ageMs <= PUSH_SERVER_RECENT_MS ? t("未読（アプリを開くとバナーを表示）", "not opened yet (the app shows the banner)")
    : t("未読（30分を過ぎたため表示しません）", "not opened (older than 30 minutes, not shown)");
  return [
    { label: t("サーバーが送った通知", "Notice the server sent"), value: `${notice.title} · ${notice.page}` },
    { label: t("送信時刻", "Sent at"), value: time(notice.sentAt) },
    { label: t("状態", "State"), value: state },
  ];
}
