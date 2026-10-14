export type InkColor = "red" | "yellow" | "blue";
export type InkKind = "underline" | "highlight" | "box" | "note";
export type InkPart = { block: string; start: number; end: number; quote: string };
export type Annotation = { id: string; kind: InkKind; color: InkColor; parts: InkPart[]; note: string };
export const inkColors = { red: "#ef777f", yellow: "#e9cc61", blue: "#78bafa" } as const;
export const maxAnnotations = 200;

// Include the text in the identity: changed articles never inherit marks at old offsets.
export function textBlockId(path: string, text: string): string {
  let hash = 2166136261;
  for (let i = 0; i < text.length; i++) hash = Math.imul(hash ^ text.charCodeAt(i), 16777619);
  return `${path}:${text.length}:${(hash >>> 0).toString(36)}`;
}
export function parseAnnotations(raw: string): Annotation[] {
  try {
    const value: unknown = JSON.parse(raw);
    if (!Array.isArray(value)) return [];
    const seen = new Set<string>();
    return value.slice(0, maxAnnotations).filter((a): a is Annotation => {
      if (!a || typeof a !== "object" || typeof a.id !== "string" || a.id.length > 100 || seen.has(a.id) ||
          !["underline", "highlight", "box", "note"].includes(a.kind) || !["red", "yellow", "blue"].includes(a.color) ||
          typeof a.note !== "string" || a.note.length > 1000 || !Array.isArray(a.parts) || !a.parts.length || a.parts.length > 100) return false;
      const valid = a.parts.every((p: InkPart) => p && typeof p.block === "string" && p.block.length < 500 &&
        Number.isInteger(p.start) && Number.isInteger(p.end) && p.start >= 0 && p.end > p.start &&
        typeof p.quote === "string" && p.quote.length === p.end - p.start && p.quote.length <= 10000);
      if (valid) seen.add(a.id);
      return valid;
    });
  } catch { return []; }
}
export function matchesPart(text: string, part: InkPart): boolean {
  return text.slice(part.start, part.end) === part.quote && part.end <= text.length;
}
export function markedSegments(text: string, block: string, annotations: Annotation[]) {
  const marks = annotations.flatMap(a => a.parts.filter(p => p.block === block && matchesPart(text, p)).map(p => ({ a, p })));
  const cuts = [...new Set([0, text.length, ...marks.flatMap(({ p }) => [p.start, p.end])])].sort((a, b) => a - b);
  return cuts.slice(0, -1).map((start, i) => ({ text: text.slice(start, cuts[i + 1]), start,
    marks: marks.filter(({ p }) => p.start <= start && p.end >= cuts[i + 1]).map(({ a }) => a) }));
}
