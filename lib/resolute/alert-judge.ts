// RESOLUTE ③ 終値アラートの判定(純粋関数)
// 入力は「ユーザーの計画」と「終値データ」。通知の文面は含めず、中身(データ)だけを返す。
// 時刻・休場日の判断はここでは行わない。データ提供元の確定フラグ(isFinal)で判断する。

export interface WatchItem {
  symbol: string;
  referencePrice: number; // 計画で決めた基準価格(高値など)
  lines: number[]; // 基準からの下落率(%)の買い増しライン。例: [10, 20, 30]
  surgeCapPct?: number; // 基準からの上昇率(%)がここに達したら知らせる(任意)
  /** ユーザー設定: 価格がいったんラインの上に戻ってから、また下回ったときに再通知するか。
   *  初期値は false(再通知しない)。※初期値はオーナー確認待ち */
  renotifyAfterRecovery?: boolean;
}

export interface Close {
  symbol: string;
  date: string; // 米国市場の営業日 YYYY-MM-DD
  close: number;
  isFinal: boolean; // 提供元が終値を確定済みとしているか
}

/** すでに通知した内容。同じ内容を毎日送らないために保存する。 */
export interface NotifiedState {
  [symbol: string]: { lines: number[]; surge: boolean };
}

export type EventKind = 'line_reached' | 'surge_cap';

export interface AlertEvent {
  kind: EventKind;
  symbol: string;
  date: string;
  close: number;
  referencePrice: number;
  dropPct?: number; // 小数1桁に切り捨て
  risePct?: number;
  newLines?: number[]; // 今回新しく到達したライン(浅い順)
}

export interface JudgeResult {
  events: AlertEvent[];
  skipped: { symbol: string; reason: 'not_final' | 'no_close' | 'invalid_input' }[];
  nextState: NotifiedState; // 送信が成功したあとで保存する
}

const floor1 = (n: number) => Math.floor(n * 10 + 1e-9) / 10;

/**
 * 判定する。返す nextState は「送信が受け付けられた(queued)」ときだけ保存すること。
 * 送信側が重複(duplicate)を返した場合は保存しない。保存すると、送られていない通知が
 * 「通知済み」になり、二度と届かなくなる。保存しなかった分は、翌営業日に判定し直される。
 */
export function judge(items: WatchItem[], closes: Close[], state: NotifiedState): JudgeResult {
  const events: AlertEvent[] = [];
  const skipped: JudgeResult['skipped'] = [];
  const nextState: NotifiedState = JSON.parse(JSON.stringify(state));

  for (const it of items) {
    const c = closes.find((x) => x.symbol === it.symbol);
    if (!c) {
      skipped.push({ symbol: it.symbol, reason: 'no_close' });
      continue;
    }
    if (!c.isFinal) {
      skipped.push({ symbol: it.symbol, reason: 'not_final' });
      continue;
    }
    if (!Number.isFinite(it.referencePrice) || it.referencePrice <= 0 || !Number.isFinite(c.close) || c.close <= 0) {
      skipped.push({ symbol: it.symbol, reason: 'invalid_input' });
      continue;
    }
    const prev = nextState[it.symbol] ?? { lines: [], surge: false };
    const changePct = ((c.close - it.referencePrice) / it.referencePrice) * 100;

    // 下落ライン
    const dropPct = -changePct;
    const validLines = [...new Set(it.lines.filter((l) => Number.isFinite(l) && l > 0))].sort((a, b) => a - b);
    const reached = validLines.filter((l) => dropPct >= l - 1e-9);
    const newLines = reached.filter((l) => !prev.lines.includes(l));
    if (newLines.length > 0) {
      events.push({
        kind: 'line_reached',
        symbol: it.symbol,
        date: c.date,
        close: c.close,
        referencePrice: it.referencePrice,
        dropPct: floor1(dropPct),
        newLines,
      });
      prev.lines = [...prev.lines, ...newLines];
    }
    // 設定がオンのときだけ: 価格が戻ってラインより上に出たら、そのラインを再び通知対象に戻す
    if (it.renotifyAfterRecovery === true) {
      prev.lines = prev.lines.filter((l) => dropPct >= l - 1e-9);
    }

    // 急騰
    if (it.surgeCapPct !== undefined) {
      const surged = changePct >= it.surgeCapPct - 1e-9;
      if (surged && !prev.surge) {
        events.push({
          kind: 'surge_cap',
          symbol: it.symbol,
          date: c.date,
          close: c.close,
          referencePrice: it.referencePrice,
          risePct: floor1(changePct),
        });
      }
      prev.surge = surged;
    }
    nextState[it.symbol] = prev;
  }
  return { events, skipped, nextState };
}

export interface DigestInput {
  userId: string;
  date: string;
  locale: 'ja' | 'en';
  events: AlertEvent[];
}

export interface Digest {
  clerkUserId: string;
  kind: EventKind;
  locale: 'ja' | 'en';
  idempotencyKey: string;
  payload: { date: string; items: AlertEvent[] };
}

/** 1人1日1通にまとめる。該当がなければ null。 */
export function buildDigest(input: DigestInput): Digest | null {
  if (input.events.length === 0) return null;
  const kind: EventKind = input.events.some((e) => e.kind === 'line_reached') ? 'line_reached' : 'surge_cap';
  const items = [...input.events].sort(
    (a, b) => (a.kind === b.kind ? a.symbol.localeCompare(b.symbol) : a.kind === 'line_reached' ? -1 : 1),
  );
  return {
    clerkUserId: input.userId,
    kind,
    locale: input.locale,
    idempotencyKey: `${input.userId}:${input.date}:alerts`,
    payload: { date: input.date, items },
  };
}
