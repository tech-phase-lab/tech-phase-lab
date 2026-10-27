import type { RadarFacts } from "./radar-facts.ts";

/** Genres the Financial Radar can show. Tickers are listed in the order they are drawn. */
export const radarGenres = [
  { id: "ai-cloud", ja: "AIクラウド", tickers: ["CRWV", "NBIS", "IREN", "APLD", "CIFR", "WULF", "CORZ"] },
  { id: "semis", ja: "半導体", tickers: ["NVDA", "AMD", "AVGO", "MU", "QCOM", "INTC", "MRVL"] },
  { id: "network", ja: "通信・光", tickers: ["ANET", "LITE", "COHR", "CRDO", "ALAB", "AAOI"] },
  { id: "software", ja: "ソフトウェア", tickers: ["MSFT", "ORCL", "NOW", "CRM", "ADBE", "PLTR", "SNOW"] },
  { id: "power", ja: "電力・設備", tickers: ["VST", "CEG", "GEV", "BE", "VRT"] },
] as const;
export type RadarGenreId = typeof radarGenres[number]["id"];
export const radarGenre = (id: string | null) => radarGenres.find(genre => genre.id === id);

// ---- scales: evenly spaced ticks, values beyond the range stop at the edge ----
export const X_TICKS = [-20, 0, 20, 40, 60] as const;
export const Y_TICKS = [0.25, 0.5, 1, 2, 4] as const;
const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value));
/** 0 (left) to 1 (right). */
export const xPosition = (fcfMargin: number) => (clamp(fcfMargin, X_TICKS[0], X_TICKS[4]) - X_TICKS[0]) / (X_TICKS[4] - X_TICKS[0]);
/** 0 (bottom) to 1 (top), on a log scale: every doubling is the same distance. */
export const yPosition = (cover: number) => (Math.log2(clamp(cover, Y_TICKS[0], Y_TICKS[4])) - Math.log2(Y_TICKS[0])) / (Math.log2(Y_TICKS[4]) - Math.log2(Y_TICKS[0]));
export const isBeyond = (fcfMargin: number, cover: number) => fcfMargin < X_TICKS[0] || fcfMargin > X_TICKS[4] || cover < Y_TICKS[0] || cover > Y_TICKS[4];

export type Zone = "solid" | "lever" | "guard" | "thin";
export const zoneName: Record<Zone, string> = { solid: "盤石", lever: "借入で攻める", guard: "守りで耐える", thin: "余力が小さい" };
/** Free cash flow at or above 0% is "earning"; cash covering borrowings and leases at 1x or more is "protected". */
export const zoneOf = (fcfMargin: number, cover: number): Zone => fcfMargin >= 0 ? (cover >= 1 ? "solid" : "lever") : (cover >= 1 ? "guard" : "thin");

export type SizeTier = 1 | 2 | 3;
/** Three sizes by revenue rank inside the genre (smallest third, middle, largest third). */
export function sizeTiers(revenues: Record<string, number>): Record<string, SizeTier> {
  const sorted = Object.entries(revenues).sort((a, b) => a[1] - b[1]);
  const out: Record<string, SizeTier> = {};
  sorted.forEach(([ticker], i) => { out[ticker] = (i * 3 < sorted.length ? 1 : i * 3 < sorted.length * 2 ? 2 : 3) as SizeTier; });
  return out;
}

export type RadarTier = "free" | "pro";
type Point = { fcfMargin: number; cover: number };
/** What a FREE visitor receives: where each dot sits, its colour and size. Nothing else. */
export type RadarDotFree = { ticker: string } & Point & { up: boolean | null; size: SizeTier };
/** PRO adds the movement from the previous earnings, the numbers behind the dot and the ranking order. */
export type RadarDotPro = RadarDotFree & { growth: number | null; asOf: string; basis: "annual" | "ttm"; previous: (Point & { asOf: string }) | null; rank: number };
export type RadarPayload =
  | { tier: "free"; genre: RadarGenreId; dots: RadarDotFree[] }
  | { tier: "pro"; genre: RadarGenreId; dots: RadarDotPro[]; missing: string[]; asOf: string | null };

const finite = (value: number) => Number.isFinite(value) ? value : 1000; // JSON cannot carry Infinity: 1000x is far beyond the 4x edge
export const rankScore = (point: Point) => xPosition(point.fcfMargin) + yPosition(point.cover);

/** Builds the response for one genre. Only a PRO payload ever contains the previous earnings, the numbers or the ranking. */
export function buildRadar(genre: RadarGenreId, entries: { ticker: string; facts: RadarFacts }[], tier: RadarTier): RadarPayload {
  const ready = entries.flatMap(entry => entry.facts.latest ? [{ ticker: entry.ticker, latest: entry.facts.latest, previous: entry.facts.previous }] : []);
  const sizes = sizeTiers(Object.fromEntries(ready.map(entry => [entry.ticker, entry.latest.revenue])));
  const base = ready.map(entry => ({
    ticker: entry.ticker, fcfMargin: entry.latest.fcfMargin, cover: finite(entry.latest.cover),
    up: entry.latest.revenueGrowth === null ? null : entry.latest.revenueGrowth >= 0, size: sizes[entry.ticker],
  }));
  if (tier === "free") return { tier, genre, dots: base };
  const order = [...ready].sort((a, b) => rankScore({ fcfMargin: b.latest.fcfMargin, cover: finite(b.latest.cover) }) - rankScore({ fcfMargin: a.latest.fcfMargin, cover: finite(a.latest.cover) })).map(entry => entry.ticker);
  const dots: RadarDotPro[] = ready.map((entry, i) => ({
    ...base[i], growth: entry.latest.revenueGrowth, asOf: entry.latest.end, basis: entry.latest.basis,
    previous: entry.previous ? { fcfMargin: entry.previous.fcfMargin, cover: finite(entry.previous.cover), asOf: entry.previous.end } : null,
    rank: order.indexOf(entry.ticker) + 1,
  }));
  const asOf = ready.map(entry => entry.latest.end).sort().at(-1) ?? null;
  return { tier, genre, dots, missing: entries.filter(entry => !entry.facts.latest).map(entry => entry.ticker), asOf };
}

/** "up" when the new value is higher than the previous earnings, "down" when lower, null when unchanged or unknown. */
export function arrow(now: number, before: number | undefined): "up" | "down" | null {
  if (before === undefined || !Number.isFinite(now) || !Number.isFinite(before)) return null;
  const change = now - before;
  const tolerance = Math.max(Math.abs(before), 1) * 0.005;
  return change > tolerance ? "up" : change < -tolerance ? "down" : null;
}

// ---- ticker labels that never sit on each other ----
export type LabelBox = { x: number; y: number; w: number; h: number };
export type LabelInput = { id: string; x: number; y: number; r: number; w: number };
const overlaps = (a: LabelBox, b: LabelBox, gap = 1.5) => a.x < b.x + b.w + gap && b.x < a.x + a.w + gap && a.y < b.y + b.h + gap && b.y < a.y + a.h + gap;
const hitsDot = (box: LabelBox, dot: { x: number; y: number; r: number }) => {
  const nx = clamp(dot.x, box.x, box.x + box.w), ny = clamp(dot.y, box.y, box.y + box.h);
  return (nx - dot.x) ** 2 + (ny - dot.y) ** 2 < (dot.r + 1.5) ** 2;
};
/** Puts each label beside its dot, and moves it to another side when it would cover another label or dot, or leave the plot. */
export function placeLabels(inputs: LabelInput[], bounds: { left: number; top: number; right: number; bottom: number }, height = 11, avoid: LabelBox[] = []): Record<string, LabelBox> {
  const placed: Record<string, LabelBox> = {};
  const boxes: LabelBox[] = [...avoid];
  // Crowded dots first, so that they get the first pick of free space.
  const crowd = (input: LabelInput) => inputs.filter(other => other !== input && Math.hypot(other.x - input.x, other.y - input.y) < 40).length;
  for (const input of [...inputs].sort((a, b) => crowd(b) - crowd(a))) {
    const { x, y, r, w } = input, h = height, g = 3;
    const candidates: LabelBox[] = [
      { x: x + r + g, y: y - h / 2, w, h }, { x: x - r - g - w, y: y - h / 2, w, h },
      { x: x - w / 2, y: y - r - g - h, w, h }, { x: x - w / 2, y: y + r + g, w, h },
      { x: x + r + g, y: y - r - g - h, w, h }, { x: x + r + g, y: y + r + g, w, h },
      { x: x - r - g - w, y: y - r - g - h, w, h }, { x: x - r - g - w, y: y + r + g, w, h },
      { x: x + r + g, y: y - h / 2 - 14, w, h }, { x: x + r + g, y: y - h / 2 + 14, w, h },
      { x: x - r - g - w, y: y - h / 2 - 14, w, h }, { x: x - r - g - w, y: y - h / 2 + 14, w, h },
      { x: x + r + g, y: y - h / 2 - 28, w, h }, { x: x + r + g, y: y - h / 2 + 28, w, h },
      { x: x + r + g + 18, y: y - h / 2 - 14, w, h }, { x: x + r + g + 18, y: y - h / 2 + 14, w, h },
      { x: x - r - g - w, y: y - h / 2 - 28, w, h }, { x: x - r - g - w, y: y - h / 2 + 28, w, h },
    ];
    const inside = (box: LabelBox) => box.x >= bounds.left && box.y >= bounds.top && box.x + box.w <= bounds.right && box.y + box.h <= bounds.bottom;
    const clear = (box: LabelBox) => !boxes.some(other => overlaps(box, other)) && !inputs.some(dot => hitsDot(box, dot));
    const fit = (box: LabelBox): LabelBox => ({ ...box, x: clamp(box.x, bounds.left, bounds.right - box.w), y: clamp(box.y, bounds.top, bounds.bottom - box.h) });
    // The first side that is free; when none is, the side (pulled back into the plot) that covers the least.
    const free = candidates.find(box => inside(box) && clear(box));
    const cost = (box: LabelBox) => boxes.filter(other => overlaps(box, other)).length * 10 + inputs.filter(dot => hitsDot(box, dot)).length * 10 + Math.abs(box.x - (x + r)) / 100;
    const fitted = free ?? candidates.map(fit).reduce((best, box) => cost(box) < cost(best) ? box : best);
    placed[input.id] = fitted; boxes.push(fitted);
  }
  return placed;
}
