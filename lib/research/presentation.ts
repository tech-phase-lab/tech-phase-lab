import type { Language } from "./data";
import type { Metric } from "./quality";

export function valueLabel(metric: Metric) {
  if (metric.unit === "percent") return `${metric.value.toFixed(1)}%`;
  if (metric.unit === "GW") return `${metric.value} GW`;
  if (metric.unit === "million") return `${metric.value < 0 ? "-" : ""}$${Math.abs(metric.value).toLocaleString("en-US", { maximumFractionDigits: 1 })}M`;
  return `$${metric.value.toFixed(2)}`;
}
export function dateLabel(value: string, lang: Language) {
  return new Intl.DateTimeFormat(lang === "ja" ? "ja-JP" : "en-US", { year: "numeric", month: "short", day: "numeric", timeZone: "UTC" }).format(new Date(`${value}T00:00:00Z`));
}
