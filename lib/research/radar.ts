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
export const X_TICKS = [-40, -20, 0, 20, 40, 60] as const;
export const Y_TICKS = [0.25, 0.5, 1, 2, 4] as const;
const X_MIN = X_TICKS[0], X_MAX = X_TICKS[X_TICKS.length - 1], Y_MIN = Y_TICKS[0], Y_MAX = Y_TICKS[Y_TICKS.length - 1];
const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value));
/** 0 (left) to 1 (right). */
export const xPosition = (ocfMargin: number) => (clamp(ocfMargin, X_MIN, X_MAX) - X_MIN) / (X_MAX - X_MIN);
/** 0 (bottom) to 1 (top), on a log scale: every doubling is the same distance. */
export const yPosition = (cover: number) => (Math.log2(clamp(cover, Y_MIN, Y_MAX)) - Math.log2(Y_MIN)) / (Math.log2(Y_MAX) - Math.log2(Y_MIN));
export const isBeyond = (ocfMargin: number, cover: number) => ocfMargin < X_MIN || ocfMargin > X_MAX || cover < Y_MIN || cover > Y_MAX;
/** The real value of a dot that was stopped at the edge, e.g. "◀ -180%" or "80% ▶" (and "▲ 44x" / "▼ 0.1x" for the other axis). */
export function beyondText(ocfMargin: number, cover: number): string {
  const parts: string[] = [];
  const percent = `${Math.abs(ocfMargin) >= 100 ? ocfMargin.toFixed(0) : ocfMargin.toFixed(1)}%`;
  if (ocfMargin < X_MIN) parts.push(`◀ ${percent}`); else if (ocfMargin > X_MAX) parts.push(`${percent} ▶`);
  const times = cover >= 100 ? "100x超" : `${cover >= 10 ? cover.toFixed(0) : cover.toFixed(2)}x`;
  if (cover > Y_MAX) parts.push(`▲ ${times}`); else if (cover < Y_MIN) parts.push(`▼ ${times}`);
  return parts.join(" ");
}

export type Zone = "solid" | "lever" | "guard" | "thin";
export const zoneName: Record<Zone, string> = { solid: "盤石", lever: "借入で攻める", guard: "守りで耐える", thin: "余力が小さい" };
/** Operating cash flow at or above 0% is "earning"; cash covering borrowings and leases at 1x or more is "protected". */
export const zoneOf = (ocfMargin: number, cover: number): Zone => ocfMargin >= 0 ? (cover >= 1 ? "solid" : "lever") : (cover >= 1 ? "guard" : "thin");

export type SizeTier = 1 | 2 | 3;
/** Three sizes by revenue rank inside the genre (smallest third, middle, largest third). */
export function sizeTiers(revenues: Record<string, number>): Record<string, SizeTier> {
  const sorted = Object.entries(revenues).sort((a, b) => a[1] - b[1]);
  const out: Record<string, SizeTier> = {};
  sorted.forEach(([ticker], i) => { out[ticker] = (i * 3 < sorted.length ? 1 : i * 3 < sorted.length * 2 ? 2 : 3) as SizeTier; });
  return out;
}

export type RadarTier = "free" | "pro";
type Point = { ocfMargin: number; cover: number };
export type Tone = "up" | "down" | null;
/** What a FREE visitor receives: where each dot sits, its colour and size. Nothing else.
 * `up` says whether revenue grew against a year earlier (null: no comparison, drawn as a hollow dot);
 * `tone` is the colour of that dot: the year-on-year direction, or failing that the direction since the previous earnings. */
export type RadarDotFree = { ticker: string } & Point & { up: boolean | null; tone: Tone; size: SizeTier };
/** PRO adds the movement from the previous earnings, the numbers behind the dot and the ranking order. */
export type RadarDotPro = RadarDotFree & { fcfMargin: number; growth: number | null; asOf: string; basis: "annual" | "ttm"; previous: (Point & { asOf: string }) | null; rank: number };
export type RadarPayload =
  | { tier: "free"; genre: RadarGenreId; dots: RadarDotFree[] }
  | { tier: "pro"; genre: RadarGenreId; dots: RadarDotPro[]; missing: string[]; asOf: string | null };

const finite = (value: number) => Number.isFinite(value) ? value : 1000; // JSON cannot carry Infinity: 1000x is far beyond the 4x edge
export const rankScore = (point: Point) => xPosition(point.ocfMargin) + yPosition(point.cover);

/** Builds the response for one genre. Only a PRO payload ever contains the previous earnings, the numbers or the ranking. */
export function buildRadar(genre: RadarGenreId, entries: { ticker: string; facts: RadarFacts }[], tier: RadarTier): RadarPayload {
  const ready = entries.flatMap(entry => entry.facts.latest ? [{ ticker: entry.ticker, latest: entry.facts.latest, previous: entry.facts.previous }] : []);
  const sizes = sizeTiers(Object.fromEntries(ready.map(entry => [entry.ticker, entry.latest.revenue])));
  const base = ready.map(entry => {
    const growth = entry.latest.revenueGrowth;
    const sinceBefore = entry.previous && entry.previous.revenue > 0 ? Math.sign(entry.latest.revenue - entry.previous.revenue) : 0;
    const tone: Tone = growth !== null ? (growth >= 0 ? "up" : "down") : sinceBefore > 0 ? "up" : sinceBefore < 0 ? "down" : null;
    return { ticker: entry.ticker, ocfMargin: entry.latest.ocfMargin, cover: finite(entry.latest.cover), up: growth === null ? null : growth >= 0, tone, size: sizes[entry.ticker] };
  });
  if (tier === "free") return { tier, genre, dots: base };
  const score = (entry: typeof ready[number]) => rankScore({ ocfMargin: entry.latest.ocfMargin, cover: finite(entry.latest.cover) });
  const order = [...ready].sort((a, b) => score(b) - score(a)).map(entry => entry.ticker);
  const dots: RadarDotPro[] = ready.map((entry, i) => ({
    ...base[i], fcfMargin: entry.latest.fcfMargin, growth: entry.latest.revenueGrowth, asOf: entry.latest.end, basis: entry.latest.basis,
    previous: entry.previous ? { ocfMargin: entry.previous.ocfMargin, cover: finite(entry.previous.cover), asOf: entry.previous.end } : null,
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

// ---- ticker labels: always beside their own dot, moved up or down (with a thin line back to the dot) when crowded ----
export type LabelBox = { x: number; y: number; w: number; h: number };
export type LabelInput = { id: string; x: number; y: number; r: number; w: number };
export type PlacedLabel = LabelBox & { shifted: boolean; /** Where the thin line meets the label, when shifted. */ anchor: { x: number; y: number } };
const overlaps = (a: LabelBox, b: LabelBox, gap = 1.5) => a.x < b.x + b.w + gap && b.x < a.x + a.w + gap && a.y < b.y + b.h + gap && b.y < a.y + a.h + gap;
const hitsDot = (box: LabelBox, dot: { x: number; y: number; r: number }) => {
  const nx = clamp(dot.x, box.x, box.x + box.w), ny = clamp(dot.y, box.y, box.y + box.h);
  return (nx - dot.x) ** 2 + (ny - dot.y) ** 2 < (dot.r + 1.5) ** 2;
};
/** Each label sits at the side of its own dot (right first, left when there is no room). When it would cover another label,
 * dot or zone name it is moved up or down in steps and joined to its dot by a thin line. */
export function placeLabels(inputs: LabelInput[], bounds: { left: number; top: number; right: number; bottom: number }, height = 11, avoid: LabelBox[] = []): Record<string, PlacedLabel> {
  const placed: Record<string, PlacedLabel> = {};
  const boxes: LabelBox[] = [...avoid];
  const crowd = (input: LabelInput) => inputs.filter(other => other !== input && Math.hypot(other.x - input.x, other.y - input.y) < 40).length;
  const steps = [0, -1, 1, -2, 2, -3, 3, -4, 4, -5, 5];
  for (const input of [...inputs].sort((a, b) => crowd(b) - crowd(a))) {
    const { x, y, r, w } = input, h = height, g = 3, lift = h + 1;
    const candidates = steps.flatMap(step => [
      { box: { x: x + r + g + (step ? 6 : 0), y: y - h / 2 + step * lift, w, h }, step },
      { box: { x: x - r - g - (step ? 6 : 0) - w, y: y - h / 2 + step * lift, w, h }, step },
    ]);
    const inside = (box: LabelBox) => box.x >= bounds.left && box.y >= bounds.top && box.x + box.w <= bounds.right && box.y + box.h <= bounds.bottom;
    const clear = (box: LabelBox) => !boxes.some(other => overlaps(box, other)) && !inputs.some(dot => hitsDot(box, dot));
    const fit = (box: LabelBox): LabelBox => ({ ...box, x: clamp(box.x, bounds.left, bounds.right - box.w), y: clamp(box.y, bounds.top, bounds.bottom - box.h) });
    const cost = (box: LabelBox) => boxes.filter(other => overlaps(box, other)).length * 10 + inputs.filter(dot => hitsDot(box, dot)).length * 10;
    const free = candidates.find(candidate => inside(candidate.box) && clear(candidate.box));
    const choice = free ?? candidates.map(candidate => ({ ...candidate, box: fit(candidate.box) })).reduce((best, candidate) => cost(candidate.box) < cost(best.box) ? candidate : best);
    const box = choice.box;
    const shifted = Math.abs(box.y + h / 2 - y) > 1;
    const anchor = { x: box.x + box.w / 2 < x ? box.x + box.w : box.x, y: box.y + h / 2 };
    placed[input.id] = { ...box, shifted, anchor }; boxes.push(box);
  }
  return placed;
}
