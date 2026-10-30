import type { RadarFacts } from "./radar-facts.ts";

/** Genres the Financial Radar can show. Tickers are listed in the order they are drawn. */
export const radarGenres = [
  { id: "ai-cloud", ja: "AIクラウド", en: "AI Cloud", tickers: ["CRWV", "NBIS", "IREN", "APLD", "CIFR", "WULF", "CORZ", "ORCL"] },
  { id: "semis", ja: "半導体", en: "Semiconductors", tickers: ["NVDA", "AMD", "INTC", "QCOM", "AMAT", "LRCX"] },
  { id: "memory", ja: "メモリ", en: "Memory", tickers: ["MU", "SNDK", "WDC", "STX", "RMBS", "P"] },
  { id: "network", ja: "通信", en: "Networking", tickers: ["ANET", "MRVL", "CRDO", "APH", "ALAB", "CSCO"] },
  { id: "photonics", ja: "光・フォトニクス", en: "Optical & Photonics", tickers: ["AAOI", "COHR", "LITE", "CIEN", "GLW", "AVGO", "FN"] },
  { id: "software", ja: "ソフトウェア", en: "Software", tickers: ["MSFT", "NOW", "CRM", "ADBE", "PLTR", "SNOW"] },
  { id: "power", ja: "電力・設備", en: "Power & Infrastructure", tickers: ["VST", "CEG", "GEV", "BE", "VRT", "ETN", "PWR", "OKLO"] },
  { id: "cyber", ja: "サイバーセキュリティ", en: "Cybersecurity", tickers: ["CRWD", "PANW", "ZS", "FTNT", "NET", "S", "OKTA"] },
] as const;
export type RadarGenreId = typeof radarGenres[number]["id"];
export const radarGenre = (id: string | null) => radarGenres.find(genre => genre.id === id);
/** Where a moved company's stored row may still sit, newest first: its figures do not depend on the genre, so they are read from there until the new genre has its own. */
export const formerGenres: Record<string, RadarGenreId[]> = {
  MRVL: ["semis"], AVGO: ["network", "semis"], MU: ["semis"], ORCL: ["software"],
  AAOI: ["network"], COHR: ["network"], LITE: ["network"],
};

// ---- scales: evenly spaced ticks, values beyond the range stop at the edge ----
export const X_TICKS = [-40, -20, 0, 20, 40, 60] as const;
export const Y_TICKS = [0.1, 0.25, 0.5, 1, 2, 4, 10] as const;
const X_MIN = X_TICKS[0], X_MAX = X_TICKS[X_TICKS.length - 1], Y_MIN = Y_TICKS[0], Y_MAX = Y_TICKS[Y_TICKS.length - 1];
const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value));
/** 0 (left) to 1 (right). */
export const xPosition = (ocfMargin: number) => (clamp(ocfMargin, X_MIN, X_MAX) - X_MIN) / (X_MAX - X_MIN);
/** 0 (bottom) to 1 (top), on a log scale: every doubling is the same distance. */
export const yPosition = (cover: number) => (Math.log2(clamp(cover, Y_MIN, Y_MAX)) - Math.log2(Y_MIN)) / (Math.log2(Y_MAX) - Math.log2(Y_MIN));
export const isBeyond = (ocfMargin: number, cover: number) => ocfMargin < X_MIN || ocfMargin > X_MAX || cover < Y_MIN || cover > Y_MAX;
/** The real value of a dot that was stopped at the edge, e.g. "◀ -180%" or "80% ▶" (and "▲ 44x" / "▼ 0.1x" for the other axis). */
export function beyondText(ocfMargin: number, cover: number, noRevenue = false): string {
  const parts: string[] = [];
  const percent = `${Math.abs(ocfMargin) >= 100 ? ocfMargin.toFixed(0) : ocfMargin.toFixed(1)}%`;
  if (noRevenue) parts.push("◀ 売上なし");
  else if (ocfMargin < X_MIN) parts.push(`◀ ${percent}`); else if (ocfMargin > X_MAX) parts.push(`${percent} ▶`);
  const times = cover >= 100 ? "100x超" : `${cover >= 10 ? cover.toFixed(0) : cover.toFixed(2)}x`;
  if (cover > Y_MAX) parts.push(`▲ ${times}`); else if (cover < Y_MIN) parts.push(`▼ ${times}`);
  return parts.join(" ");
}

/** Which edges a dot was stopped at, for the small arrows on its rim. */
export const beyondDirections = (ocfMargin: number, cover: number) => ({ left: ocfMargin < X_MIN, right: ocfMargin > X_MAX, up: cover > Y_MAX, down: cover < Y_MIN });

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
export type RadarDotFree = { ticker: string } & Point & { up: boolean | null; tone: Tone; size: SizeTier; /** No revenue: earning power cannot be calculated; the dot sits at the left edge. */ noRevenue?: boolean };
/** PRO adds the movement from the previous earnings, the numbers behind the dot and the ranking order. */
export type RadarDotPro = RadarDotFree & { fcfMargin: number; growth: number | null; asOf: string; basis: "annual" | "ttm"; previous: (Point & { asOf: string }) | null;
  /** Position in the ranking; null for a dot that needs checking (not ranked). */
  rank: number | null;
  /** Fitness score out of 100 (average of the two chart points). */
  score: number;
  /** Earning power above 100% usually comes from customers paying in advance, not from the business: it is flagged and left out of the ranking. */
  review: boolean };
/** Operating cash flow above this share of revenue is flagged for checking. */
export const REVIEW_ABOVE = 100;
export type RadarPayload =
  | { tier: "free"; genre: RadarGenreId; dots: RadarDotFree[] }
  | { tier: "pro"; genre: RadarGenreId; dots: RadarDotPro[]; missing: string[]; asOf: string | null };

const finite = (value: number) => Number.isFinite(value) ? value : 1000; // JSON cannot carry Infinity: 1000x is far beyond the 10x edge
/** The two chart positions as points out of 100: earning power on its -40%..60% axis, staying power on the 0.1x..10x log axis. */
export const earningScore = (ocfMargin: number) => xPosition(ocfMargin) * 100;
export const stayingScore = (cover: number) => yPosition(cover) * 100;
/** Fitness score: the average of the two chart points. */
export const fitnessScore = (ocfMargin: number, cover: number) => (earningScore(ocfMargin) + stayingScore(cover)) / 2;
/** Order inside a genre: the higher fitness score first; on a tie the stronger staying power goes first. */
export function rankByScore(points: { ticker: string; ocfMargin: number; cover: number }[]): string[] {
  return [...points].sort((a, b) => fitnessScore(b.ocfMargin, b.cover) - fitnessScore(a.ocfMargin, a.cover) || stayingScore(b.cover) - stayingScore(a.cover)).map(point => point.ticker);
}

/** Builds the response for one genre. Only a PRO payload ever contains the previous earnings, the numbers or the ranking. */
export function buildRadar(genre: RadarGenreId, entries: { ticker: string; facts: RadarFacts }[], tier: RadarTier): RadarPayload {
  const ready = entries.flatMap(entry => entry.facts.latest ? [{ ticker: entry.ticker, latest: entry.facts.latest, previous: entry.facts.previous }] : []);
  const sizes = sizeTiers(Object.fromEntries(ready.map(entry => [entry.ticker, entry.latest.revenue])));
  const base = ready.map(entry => {
    const growth = entry.latest.revenueGrowth;
    const sinceBefore = entry.previous && entry.previous.revenue > 0 ? Math.sign(entry.latest.revenue - entry.previous.revenue) : 0;
    const tone: Tone = growth !== null ? (growth >= 0 ? "up" : "down") : sinceBefore > 0 ? "up" : sinceBefore < 0 ? "down" : null;
    return { ticker: entry.ticker, ocfMargin: entry.latest.ocfMargin, cover: finite(entry.latest.cover), up: growth === null ? null : growth >= 0, tone, size: sizes[entry.ticker], ...(entry.latest.noRevenue ? { noRevenue: true } : {}) };
  });
  if (tier === "free") return { tier, genre, dots: base };
  const flagged = (entry: typeof ready[number]) => entry.latest.ocfMargin > REVIEW_ABOVE || entry.latest.noRevenue === true;
  const order = rankByScore(ready.filter(entry => !flagged(entry)).map(entry => ({ ticker: entry.ticker, ocfMargin: entry.latest.ocfMargin, cover: finite(entry.latest.cover) })));
  const dots: RadarDotPro[] = ready.map((entry, i) => ({
    ...base[i], fcfMargin: entry.latest.fcfMargin, growth: entry.latest.revenueGrowth, asOf: entry.latest.end, basis: entry.latest.basis,
    previous: entry.previous && !entry.latest.noRevenue ? { ocfMargin: entry.previous.ocfMargin, cover: finite(entry.previous.cover), asOf: entry.previous.end } : null,
    score: fitnessScore(entry.latest.ocfMargin, finite(entry.latest.cover)), rank: flagged(entry) ? null : order.indexOf(entry.ticker) + 1, review: flagged(entry),
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

/** When the previous earnings fall outside the chart, no dotted line is drawn; the value is written beside the name instead ("前回 49x"). */
export function previousBeyondText(previous: { ocfMargin: number; cover: number } | null): string {
  if (!previous || !isBeyond(previous.ocfMargin, previous.cover)) return "";
  const parts: string[] = [];
  if (previous.ocfMargin < X_MIN || previous.ocfMargin > X_MAX) parts.push(`${Math.abs(previous.ocfMargin) >= 100 ? previous.ocfMargin.toFixed(0) : previous.ocfMargin.toFixed(1)}%`);
  if (previous.cover < Y_MIN || previous.cover > Y_MAX) parts.push(previous.cover >= 100 ? "100x超" : `${previous.cover >= 10 ? previous.cover.toFixed(0) : previous.cover.toFixed(2)}x`);
  return `前回 ${parts.join(" ")}`;
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
const nearestOn = (box: LabelBox, dot: { x: number; y: number }) => ({ x: clamp(dot.x, box.x, box.x + box.w), y: clamp(dot.y, box.y, box.y + box.h) });
type Segment = { x1: number; y1: number; x2: number; y2: number };
const cross = (a: Segment, b: Segment) => {
  const d = (p: Segment, x: number, y: number) => (p.x2 - p.x1) * (y - p.y1) - (p.y2 - p.y1) * (x - p.x1);
  return d(a, b.x1, b.y1) * d(a, b.x2, b.y2) < 0 && d(b, a.x1, a.y1) * d(b, a.x2, a.y2) < 0;
};
const nearSegment = (segment: Segment, dot: { x: number; y: number }, within: number) => {
  const dx = segment.x2 - segment.x1, dy = segment.y2 - segment.y1, length = dx * dx + dy * dy || 1;
  const t = clamp(((dot.x - segment.x1) * dx + (dot.y - segment.y1) * dy) / length, 0, 1);
  return Math.hypot(segment.x1 + t * dx - dot.x, segment.y1 + t * dy - dot.y) < within;
};
/** Each label sits at the side of its own dot (right first, left when there is no room). When that would cover another label,
 * dot or zone name, the place is chosen around the dot (beside, above, below, further out) as the one that stays clear of other
 * labels and dots, stays closest to its dot and crosses no other line; a thin line joins it to its dot. */
export function placeLabels(inputs: LabelInput[], bounds: { left: number; top: number; right: number; bottom: number }, height = 11, avoid: LabelBox[] = [], first: string | null = null): Record<string, PlacedLabel> {
  const placed: Record<string, PlacedLabel> = {};
  const boxes: LabelBox[] = [...avoid];
  const lines: { id: string; segment: Segment }[] = [];
  const crowd = (input: LabelInput) => inputs.filter(other => other !== input && Math.hypot(other.x - input.x, other.y - input.y) < 40).length;
  const steps = [0, -1, 1, -2, 2, -3, 3, -4, 4, -5, 5, -6, 6, -7, 7, -8, 8];
  for (const input of [...inputs].sort((a, b) => Number(b.id === first) - Number(a.id === first) || crowd(b) - crowd(a))) {
    const { x, y, r, w } = input, h = height, g = 3, lift = h + 1;
    const candidates: LabelBox[] = steps.flatMap(step => [
      { x: x + r + g + (step ? 6 : 0), y: y - h / 2 + step * lift, w, h },
      { x: x - r - g - (step ? 6 : 0) - w, y: y - h / 2 + step * lift, w, h },
    ]);
    // Above and below the dot, a little to either side, and further out.
    for (const reach of [1, 2, 3, 4]) for (const shift of [0, -0.5, 0.5, -1, 1]) for (const way of [-1, 1]) {
      candidates.push({ x: x - w / 2 + shift * w * 0.6, y: way < 0 ? y - r - g - reach * lift : y + r + g + (reach - 1) * lift, w, h });
    }
    const inside = (box: LabelBox) => box.x >= bounds.left && box.y >= bounds.top && box.x + box.w <= bounds.right && box.y + box.h <= bounds.bottom;
    const fit = (box: LabelBox): LabelBox => ({ ...box, x: clamp(box.x, bounds.left, bounds.right - box.w), y: clamp(box.y, bounds.top, bounds.bottom - box.h) });
    const cost = (raw: LabelBox) => {
      const box = fit(raw), near = nearestOn(box, input), segment: Segment = { x1: x, y1: y, x2: near.x, y2: near.y };
      const covered = boxes.filter(other => overlaps(box, other)).length + inputs.filter(dot => hitsDot(box, dot)).length;
      const lineHits = lines.filter(line => cross(segment, line.segment)).length;
      const dotsOnLine = inputs.filter(dot => dot !== input && Math.hypot(near.x - x, near.y - y) > r + g + 2 && nearSegment(segment, dot, dot.r + 1)).length;
      return covered * 1000 + (inside(raw) ? 0 : 40) + lineHits * 120 + dotsOnLine * 80 + Math.hypot(near.x - x, near.y - y);
    };
    const best = candidates.reduce((chosen, candidate) => cost(candidate) < cost(chosen) ? candidate : chosen);
    const box = fit(best), near = nearestOn(box, input);
    const gap = Math.hypot(near.x - x, near.y - y);
    const shifted = gap > r + g + 2.5 || Math.abs(box.y + h / 2 - y) > h;
    const anchor = shifted ? near : { x: box.x + box.w / 2 < x ? box.x + box.w : box.x, y: box.y + h / 2 };
    placed[input.id] = { ...box, shifted, anchor }; boxes.push(box);
    if (shifted) lines.push({ id: input.id, segment: { x1: x, y1: y, x2: anchor.x, y2: anchor.y } });
  }
  return placed;
}

// ---- dots stopped at the edge: spread so that each stays visible ----
export type EdgeDot = { id: string; x: number; y: number; r: number; edgeX: boolean; edgeY: boolean };
/** Dots that were stopped at an edge of the plot can land on top of each other. They are nudged along the edge until each one
 * shows; dots inside the plot keep their exact place. */
export function spreadEdgeDots(dots: EdgeDot[], bounds: { left: number; top: number; right: number; bottom: number }): Record<string, { x: number; y: number }> {
  const at = Object.fromEntries(dots.map(dot => [dot.id, { x: dot.x, y: dot.y }]));
  const movable = (dot: EdgeDot) => dot.edgeX || dot.edgeY;
  for (let pass = 0; pass < 80; pass++) {
    let moved = false;
    for (let i = 0; i < dots.length; i++) for (let j = i + 1; j < dots.length; j++) {
      const a = dots[i], b = dots[j];
      if (!movable(a) && !movable(b)) continue;
      const pa = at[a.id], pb = at[b.id], need = a.r + b.r + 1.5, distance = Math.hypot(pb.x - pa.x, pb.y - pa.y);
      if (distance >= need) continue;
      const gap = (need - distance + 0.05) / (movable(a) && movable(b) ? 2 : 1);
      // A dot on a left/right edge slides up or down; one only on a top/bottom edge slides sideways.
      const push = (dot: EdgeDot, point: { x: number; y: number }, other: { x: number; y: number }, toward: number) => {
        if (dot.edgeX) { const sign = point.y === other.y ? toward : Math.sign(point.y - other.y); point.y = clamp(point.y + sign * gap, bounds.top + dot.r, bounds.bottom - dot.r); }
        else { const sign = point.x === other.x ? toward : Math.sign(point.x - other.x); point.x = clamp(point.x + sign * gap, bounds.left + dot.r, bounds.right - dot.r); }
      };
      if (movable(a)) push(a, pa, pb, -1);
      if (movable(b)) push(b, pb, pa, 1);
      moved = true;
    }
    if (!moved) break;
  }
  return at;
}
