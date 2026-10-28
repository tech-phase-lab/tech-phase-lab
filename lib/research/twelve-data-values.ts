// Never coerce null, an empty string or a boolean to zero, nor strip K/M/% suffixes.
export function twelveNumber(x: unknown): number | null {
  if (typeof x === "number") return Number.isFinite(x) ? x : null;
  if (typeof x !== "string" || !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(x.trim())) return null;
  const n = Number(x.trim());
  return Number.isFinite(n) ? n : null;
}
