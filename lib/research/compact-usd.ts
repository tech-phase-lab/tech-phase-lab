// Deterministic compact USD formatting. Intl's compact notation differs between the
// server's ICU (Node) and the browser's ICU ("$659.50億" vs "$659.5億"), which broke
// hydration on the Capital Map. This formatter gives identical output everywhere.
const trim = (value: number) => {
  const fixed = value.toFixed(2);
  return fixed.endsWith(".00") ? fixed.slice(0, -3) : fixed.endsWith("0") ? fixed.slice(0, -1) : fixed;
};

const jaUnits: [number, string][] = [[1e12, "兆"], [1e8, "億"], [1e4, "万"]];
const enUnits: [number, string][] = [[1e12, "T"], [1e9, "B"], [1e6, "M"], [1e3, "K"]];

export function compactUsd(value: number, lang: "ja" | "en"): string {
  if (!Number.isFinite(value)) return "—";
  const sign = value < 0 ? "-" : "";
  const abs = Math.abs(value);
  const units = lang === "ja" ? jaUnits : enUnits;
  for (const [size, suffix] of units) {
    if (Number((abs / size).toFixed(2)) >= 1) return `${sign}$${trim(abs / size)}${suffix}`;
  }
  return `${sign}$${trim(abs)}`;
}
