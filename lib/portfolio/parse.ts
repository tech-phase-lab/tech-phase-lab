import type { Holding } from "./calc.ts";

/** What the screenshot reader returns, checked here before anything reaches the screen or storage. The model's answer is never trusted:
 * every number is range-checked, tickers are normalised, duplicates are merged and anything doubtful becomes a warning for the reader to see. */
export type Parsed = { holdings: Holding[]; warnings: string[]; reportedGainUsd: number | null; screenPrices: Record<string, number> };

export const PARSE_PROMPT = `これは日本の証券会社アプリの、米国株の「保有銘柄」画面のスクリーンショットです。画面に見える銘柄の行を、すべて読み取ってください。
JSONだけを返します(説明文や記号は付けません)。形は次のとおりです。
{"holdings":[{"ticker":"NVDA","name":"エヌビディア","shares":10,"avgCostUsd":120.5,"avgCostJpy":null,"currentPriceUsd":130.2}],"reportedGainUsd":1234.56}
決まり:
- ticker は画面のティッカー(英字)。銘柄名が途中で切れていても、そのまま name に入れてよい。
- shares は保有数量(株)。「執行中」の数字は使わない。
- avgCostUsd は平均取得価額(ドル)。画面が円表示で、ドルの値が無いときは null にして、avgCostJpy に円の値を入れる。
- currentPriceUsd は現在値(ドル)。見えなければ null。
- reportedGainUsd は画面の一番上に出ている評価損益(ドル)。見えなければ null。
- 数字のカンマは取り除く。読み取れない行は、推測せずに飛ばす。
- 画面にない銘柄を足さない。`;

const TICKER = /^[A-Z][A-Z0-9.\-]{0,9}$/;
const num = (value: unknown): number | null => typeof value === "number" && Number.isFinite(value) ? value : typeof value === "string" && /^-?\d+(\.\d+)?$/.test(value.replace(/,/g, "").trim()) ? Number(value.replace(/,/g, "").trim()) : null;

/** The model may wrap its JSON in code fences or text; take the first balanced object. */
export function extractJson(text: string): unknown {
  const start = text.indexOf("{");
  if (start < 0) return null;
  let depth = 0, inString = false, escaped = false;
  for (let i = start; i < text.length; i++) {
    const char = text[i];
    if (inString) { if (escaped) escaped = false; else if (char === "\\") escaped = true; else if (char === '"') inString = false; continue; }
    if (char === '"') inString = true;
    else if (char === "{") depth++;
    else if (char === "}" && --depth === 0) { try { return JSON.parse(text.slice(start, i + 1)); } catch { return null; } }
  }
  return null;
}

export function normalizeParsed(raw: unknown): Parsed {
  const warnings: string[] = [];
  const holdings = new Map<string, Holding>();
  const screenPrices: Record<string, number> = {};
  const body = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
  const list = Array.isArray(body.holdings) ? body.holdings.slice(0, 100) : [];
  if (!Array.isArray(body.holdings)) warnings.push("画面から銘柄を読み取れませんでした。");
  for (const item of list) {
    const row = item && typeof item === "object" ? item as Record<string, unknown> : {};
    const ticker = typeof row.ticker === "string" ? row.ticker.trim().toUpperCase() : "";
    const shares = num(row.shares);
    const avg = num(row.avgCostUsd);
    const jpy = num(row.avgCostJpy);
    if (!TICKER.test(ticker)) { warnings.push(`ティッカーを読み取れない行がありました(${String(row.ticker ?? "不明").slice(0, 12)})。`); continue; }
    if (shares === null || !(shares > 0) || shares > 1e9) { warnings.push(`${ticker}: 株数を読み取れなかったため、飛ばしました。`); continue; }
    if (avg === null && jpy !== null) warnings.push(`${ticker}: 平均取得価額が円でしか読み取れませんでした。ドルの値を確認してください。`);
    if (avg === null || !(avg > 0) || avg > 1e7) { warnings.push(`${ticker}: 平均取得価額(ドル)を読み取れなかったため、飛ばしました。`); continue; }
    const name = typeof row.name === "string" && row.name.trim() ? row.name.trim().slice(0, 40) : undefined;
    const fx = jpy !== null && jpy > 0 ? jpy / avg : undefined;
    const price = num(row.currentPriceUsd);
    if (price !== null && price > 0) screenPrices[ticker] = price;
    const existing = holdings.get(ticker);
    if (existing) {
      // The same ticker twice (for example two screens overlapping): keep one, and say so.
      if (existing.shares === shares && existing.avgCostUsd === avg) { warnings.push(`${ticker}: 同じ行が2回ありました。1つにまとめました。`); continue; }
      const total = existing.shares + shares;
      holdings.set(ticker, { ...existing, shares: total, avgCostUsd: (existing.shares * existing.avgCostUsd + shares * avg) / total });
      warnings.push(`${ticker}: 2行ありました。株数を合計して、平均取得価額を平均しました。確認してください。`);
      continue;
    }
    holdings.set(ticker, { ticker, name, shares, avgCostUsd: avg, ...(fx !== undefined && fx > 50 && fx < 400 ? { avgCostFx: fx } : {}) });
  }
  return { holdings: [...holdings.values()], warnings, reportedGainUsd: num(body.reportedGainUsd), screenPrices };
}

/** Cross-check against the profit printed at the top of the screen: a missed or misread row shows up as a gap. */
export function reconcile(parsed: Parsed): string | null {
  if (parsed.reportedGainUsd === null) return null;
  let sum = 0;
  for (const h of parsed.holdings) {
    const price = parsed.screenPrices[h.ticker];
    if (price === undefined) return null;
    sum += (price - h.avgCostUsd) * h.shares;
  }
  const gap = Math.abs(sum - parsed.reportedGainUsd);
  const allowed = Math.max(1, Math.abs(parsed.reportedGainUsd) * 0.005);
  return gap > allowed ? `読み取った銘柄の損益の合計(${Math.round(sum).toLocaleString("en-US")}ドル)が、画面の上に出ている評価損益(${Math.round(parsed.reportedGainUsd).toLocaleString("en-US")}ドル)と合いません。画面に写っていない銘柄があるか、読み間違いがあるかもしれません。` : null;
}
