import { SPLIT_OVERRIDES, etDay, splitFactor, type StockSplit } from "./stock-splits.ts";

/** A price target is a per-share price, so a stock split changes its basis (SNDK 8-for-1 on 2026-11-20).
 *  - "before-split": the action was published before a split that has since taken effect. The card keeps the figures as published and adds
 *    them on today's basis (÷ ratio), so they can be set against today's price.
 *  - "previous-pre-split": published after a split, with an old target that is a pre-split figure ("$1,400 → $180"). This is never read
 *    from the size of the change alone (a real 35% cut after a 2-for-1 must stay a cut): the same firm's earlier target for the ticker,
 *    published before the split, must be that old figure. The old target is then shown ÷ ratio and the change worked out from that. */
export type TargetSplitView = { kind: "before-split" | "previous-pre-split"; previous: number; latest: number; ratio: number; date: string };
type Target = { ticker: string; firm?: string; previous: number; latest: number; publishedAt: string };
const DAY = 86_400_000;
const same = (a: number, b: number) => Math.abs(a - b) <= 0.005 * Math.max(a, b);
export function priceTargetSplitView(item: Target, now = Date.now(), splits: readonly StockSplit[] = SPLIT_OVERRIDES, earlier: readonly Target[] = []): TargetSplitView | null {
  const own = splits.filter(s => s.ticker === item.ticker);
  const published = etDay(item.publishedAt), today = etDay(now);
  if (!own.length || !published || !(item.previous > 0) || !(item.latest > 0)) return null;
  const factor = splitFactor(own, published, today);
  if (factor !== 1) {
    const last = own.filter(s => s.date > published && s.date <= today).at(-1)!;
    return { kind: "before-split", previous: item.previous / factor, latest: item.latest / factor, ratio: factor, date: last.date };
  }
  const recent = own.filter(s => s.date <= published && Date.parse(published) - Date.parse(s.date) <= 60 * DAY).at(-1);
  if (!recent || !item.firm) return null;
  const firm = item.firm.trim().toLowerCase();
  const before = earlier.some(e => e.ticker === item.ticker && e.firm?.trim().toLowerCase() === firm && etDay(e.publishedAt) < recent.date && same(e.latest, item.previous));
  return before ? { kind: "previous-pre-split", previous: item.previous / recent.ratio, latest: item.latest, ratio: recent.ratio, date: recent.date } : null;
}
