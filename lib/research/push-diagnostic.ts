/** Nov 15 (iPhone home-screen app): a tapped notice still left the owner on the home page, and nothing said which step failed.
 * The service worker (public/research-sw.js) and the app (PushOpenListener) note the steps that happened for the latest notice, with
 * times and the worker's VERSION; the owner's app sends that record to POST /api/research/notifications {action:"diagnostic"}, which
 * logs one `[push-diag]` line. A record holds only times, yes/no answers, short fixed words, the worker version and a random per-notice
 * id: never a title, a page address, a member, a subscription or a key. */

/** Steps noted with the time they happened (epoch ms). */
export const PUSH_DIAG_TIMES = [
  // Service worker (written to Cache Storage, read back by the app)
  "push", "shown", "click",
  // App
  "foreground", "query", "queryTimeout", "store", "server", "pending", "banner", "bannerOpen", "bannerClose", "bannerTimeout", "navigated",
] as const;
/** Yes/no answers (null: the device could not say). */
export const PUSH_DIAG_FLAGS = ["listApi", "listed", "stillListed", "controlled", "standalone"] as const;
/** How the app moved to the notice's page. */
export const PUSH_DIAG_VIA = ["worker-message", "pending", "banner", "gone-after-tap", "server-tap"] as const;

type Time = (typeof PUSH_DIAG_TIMES)[number];
type Flag = (typeof PUSH_DIAG_FLAGS)[number];
export type PushDiagnostic = { v: string; id: string; via?: (typeof PUSH_DIAG_VIA)[number] }
  & Partial<Record<Time, number>> & Partial<Record<Flag, boolean | null>>;

const ID = /^[A-Za-z0-9-]{1,64}$/;
const VERSION = /^[A-Za-z0-9.-]{1,40}$/;

/** A record reduced to the known fields with the right kinds of value, or null when it has no usable id. Anything else is dropped. */
export function cleanPushDiagnostic(value: unknown): PushDiagnostic | null {
  if (!value || typeof value !== "object") return null;
  const input = value as Record<string, unknown>;
  if (typeof input.id !== "string" || !ID.test(input.id)) return null;
  const out: PushDiagnostic = { v: typeof input.v === "string" && VERSION.test(input.v) ? input.v : "unknown", id: input.id };
  for (const key of PUSH_DIAG_TIMES) {
    const time = input[key];
    // Epoch ms between 2020 and 2100: never a free-form number that could carry something else.
    if (typeof time === "number" && Number.isInteger(time) && time > 1_577_836_800_000 && time < 4_102_444_800_000) out[key] = time;
  }
  for (const key of PUSH_DIAG_FLAGS) {
    const flag = input[key];
    if (flag === true || flag === false || flag === null) out[key] = flag;
  }
  if (typeof input.via === "string" && (PUSH_DIAG_VIA as readonly string[]).includes(input.via)) out.via = input.via as PushDiagnostic["via"];
  return out;
}

/** The one log line: fixed field order, times as seconds after the push (or after the first time noted) so it reads at a glance. */
export function pushDiagnosticLine(record: PushDiagnostic): string {
  const start = record.push ?? Math.min(...PUSH_DIAG_TIMES.map(key => record[key] ?? Infinity));
  const parts = [`v=${record.v}`, `id=${record.id}`];
  if (Number.isFinite(start)) parts.push(`at=${new Date(start).toISOString()}`);
  for (const key of PUSH_DIAG_TIMES) {
    const time = record[key];
    if (time !== undefined) parts.push(`${key}=+${((time - start) / 1000).toFixed(1)}s`);
  }
  for (const key of PUSH_DIAG_FLAGS) if (record[key] !== undefined) parts.push(`${key}=${record[key] === null ? "unknown" : record[key] ? "yes" : "no"}`);
  if (record.via) parts.push(`via=${record.via}`);
  return parts.join(" ");
}

/** What makes a record worth sending again: everything but the time of the last look at the app (a look alone changes nothing). */
export function pushDiagnosticSignature(record: PushDiagnostic): string {
  const { foreground: _foreground, ...rest } = record;
  void _foreground;
  return JSON.stringify(rest);
}
/** Only a record about a notice from the last 10 minutes is sent (an old one is not repeated on every look). */
export function recentPushDiagnostic(record: PushDiagnostic, now: number): boolean {
  const times = PUSH_DIAG_TIMES.filter(key => key !== "foreground").map(key => record[key]).filter((time): time is number => time !== undefined);
  return times.length > 0 && now - Math.max(...times) < 10 * 60_000;
}

/** Per-account limit for the diagnostic log (in memory, per server instance): enough for a few tests, never a flood. */
export const PUSH_DIAG_LIMIT = 30;
export const PUSH_DIAG_WINDOW_MS = 10 * 60_000;
export function createPushDiagnosticLimiter(limit = PUSH_DIAG_LIMIT, windowMs = PUSH_DIAG_WINDOW_MS) {
  const seen = new Map<string, number[]>();
  return (key: string, now: number) => {
    const recent = (seen.get(key) ?? []).filter(at => now - at < windowMs);
    if (recent.length >= limit) { seen.set(key, recent); return false; }
    recent.push(now);
    seen.set(key, recent);
    if (seen.size > 100) for (const [other, times] of seen) if (!times.some(at => now - at < windowMs)) seen.delete(other);
    return true;
  };
}

/** Where the app keeps the latest record on this device (the owner's settings page shows it). */
export const PUSH_DIAG_STORAGE_KEY = "tech-phase:push-diagnostic:v1";
export const PUSH_DIAG_EVENT = "tech-phase:push-diagnostic";

type StorageLike = { getItem: (key: string) => string | null; setItem: (key: string, value: string) => void };

export function readPushDiagnostic(storage: StorageLike | null): PushDiagnostic | null {
  try { return cleanPushDiagnostic(JSON.parse(storage?.getItem(PUSH_DIAG_STORAGE_KEY) ?? "null")); } catch { return null; }
}

/** The app's side of the record. `note` adds steps for a notice id; a record for a newer notice replaces the old one. */
export function createPushDiagnostics({ storage, changed = () => {} }:
  { storage: StorageLike | null; changed?: (record: PushDiagnostic) => void }) {
  let record = readPushDiagnostic(storage);
  function save() {
    if (!record) return;
    try { storage?.setItem(PUSH_DIAG_STORAGE_KEY, JSON.stringify(record)); } catch { /* storage blocked: the record still reaches the log */ }
    changed(record);
  }
  /** Merge the worker's record (Cache Storage). A different id means a newer notice: start again from it. */
  function fromWorker(value: unknown) {
    const worker = cleanPushDiagnostic(value);
    if (!worker) return;
    if (!record || record.id !== worker.id) {
      // Only move to a notice pushed after the one held (an old record read late must not replace a newer one).
      if (record?.push && worker.push && worker.push < record.push) return;
      record = worker;
    } else record = { ...record, ...worker };
    save();
  }
  /** Note a step of the app's for the notice `id` (the current one when omitted). Times keep the first moment, flags the latest. */
  function note(patch: Partial<PushDiagnostic>, id?: string) {
    if (id && (!record || record.id !== id)) {
      if (!ID.test(id)) return;
      record = { v: record?.v ?? "unknown", id };
    }
    if (!record) return;
    // A look at the app long after the notice says nothing about that notice.
    if (!id && !recentPushDiagnostic(record, Date.now())) return;
    const next: PushDiagnostic = { ...record };
    for (const [key, value] of Object.entries(patch) as [keyof PushDiagnostic, unknown][]) {
      if (key === "id" || key === "v") continue;
      if ((PUSH_DIAG_TIMES as readonly string[]).includes(key) && key !== "foreground" && next[key] !== undefined) continue;
      (next as Record<string, unknown>)[key] = value;
    }
    record = cleanPushDiagnostic(next) ?? record;
    save();
  }
  return { fromWorker, note, current: () => record };
}

export type PushDiagnosticRow = { label: string; value: string };
/** The steps of the latest notice, in the order they can happen, as label/value rows (nothing for a step that did not happen). */
export function pushDiagnosticRows(record: PushDiagnostic, lang: "ja" | "en"): PushDiagnosticRow[] {
  const t = (ja: string, en: string) => lang === "ja" ? ja : en;
  const start = record.push ?? record.click ?? record.banner ?? record.foreground;
  const time = (at: number | undefined) => at === undefined ? undefined
    : `${new Date(at).toLocaleTimeString(lang === "ja" ? "ja-JP" : "en-US", { hour12: false })}${start !== undefined && at !== start ? ` (+${((at - start) / 1000).toFixed(1)}s)` : ""}`;
  const yes = (flag: boolean | null | undefined) => flag === undefined ? undefined : flag === null ? t("不明", "unknown") : flag ? t("はい", "yes") : t("いいえ", "no");
  const via = { "worker-message": t("ワーカーからの依頼", "worker message"), pending: t("記録したタップ", "written tap"), banner: t("アプリ内の通知", "in-app banner"),
    "gone-after-tap": t("一覧から消えた直後に起動（タップとみなす）", "gone from the list just before the app came up (taken as a tap)"),
    "server-tap": t("送信から15秒以内に起動（タップとみなす）", "app came up within 15 s of the send (taken as a tap)") };
  const rows: [string, string | undefined][] = [
    [t("ワーカーの版", "Worker version"), record.v],
    [t("通知の番号（ランダム）", "Notice id (random)"), record.id],
    [t("通知を受信", "Push received"), time(record.push)],
    [t("通知を表示", "Notification shown"), time(record.shown)],
    [t("通知一覧を読めるか", "Can list notifications"), yes(record.listApi)],
    [t("表示直後に一覧にあったか", "Listed after showing"), yes(record.listed)],
    [t("タップがワーカーに届いた", "Tap reached the worker"), time(record.click) ?? t("届いていません", "not received")],
    [t("アプリが前面に来た（最新）", "App came to the front (latest)"), time(record.foreground)],
    [t("ワーカーが問い合わせに応答", "Worker answered the app"), time(record.query)],
    [t("ワーカーが応答しなかった", "Worker did not answer"), time(record.queryTimeout)],
    [t("前面に来た時も一覧にあったか", "Still listed when the app came back"), yes(record.stillListed)],
    [t("サーバーの記録で通知を見つけた", "Notice found in the server's record"), time(record.server)],
    [t("記録したタップを見つけた", "Written tap found"), time(record.pending)],
    [t("アプリ内の通知を表示", "In-app banner shown"), time(record.banner)],
    [t("「開く」を押した", "Open pressed"), time(record.bannerOpen)],
    [t("✕で閉じた", "Dismissed"), time(record.bannerClose)],
    [t("15秒で自動で閉じた", "Hidden after 15 s"), time(record.bannerTimeout)],
    [t("通知のページへ移動", "Moved to the notice's page"), record.navigated === undefined ? undefined : `${time(record.navigated)}${record.via ? ` · ${via[record.via]}` : ""}`],
    [t("ワーカーの管理下のページ", "Page controlled by the worker"), yes(record.controlled)],
    [t("ホーム画面のアプリ", "Home-screen app"), yes(record.standalone)],
  ];
  return rows.filter((row): row is [string, string] => row[1] !== undefined).map(([label, value]) => ({ label, value }));
}
