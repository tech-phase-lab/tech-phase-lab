import { SPLIT_OVERRIDES, etDay, splitFactor, type StockSplit } from "./stock-splits.ts";

/** A price target is a per-share price, so a stock split changes its basis (SNDK 8-for-1 on 2026-11-20).
 *  - "before-split": the action was published before a split that has since taken effect. The card keeps the figures as published and adds
 *    them on today's basis (÷ ratio), so they can be set against today's price.
 *  - "previous-pre-split": published after a split, but the old target is still the pre-split figure ("$1,400 → $175"): it is a basis
 *    change, not an 87% cut. Read so only within 60 days of the split and only when the two figures are nearer the split ratio apart than
 *    equal (|ln(prev ÷ latest) − ln ratio| < |ln(prev ÷ latest)|). The old target is then shown ÷ ratio and the change worked out from that. */
export type TargetSplitView = { kind: "before-split" | "previous-pre-split"; previous: number; latest: number; ratio: number; date: string };
const DAY = 86_400_000;
export function priceTargetSplitView(item: { ticker: string; previous: number; latest: number; publishedAt: string }, now = Date.now(), splits: readonly StockSplit[] = SPLIT_OVERRIDES): TargetSplitView | null {
  const own = splits.filter(s => s.ticker === item.ticker);
  const published = etDay(item.publishedAt), today = etDay(now);
  if (!own.length || !published || !(item.previous > 0) || !(item.latest > 0)) return null;
  const factor = splitFactor(own, published, today);
  if (factor !== 1) {
    const last = own.filter(s => s.date > published && s.date <= today).at(-1)!;
    return { kind: "before-split", previous: item.previous / factor, latest: item.latest / factor, ratio: factor, date: last.date };
  }
  const recent = own.filter(s => s.date <= published && Date.parse(published) - Date.parse(s.date) <= 60 * DAY).at(-1);
  if (!recent) return null;
  const move = Math.log(item.previous / item.latest);
  if (Math.abs(move - Math.log(recent.ratio)) >= Math.abs(move)) return null;
  return { kind: "previous-pre-split", previous: item.previous / recent.ratio, latest: item.latest, ratio: recent.ratio, date: recent.date };
}
