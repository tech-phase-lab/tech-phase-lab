/** Money in the earnings deep dive (決算の深掘り). Amounts arrive in millions of the issuer's own currency; non-USD issuers keep their
 * currency (TSM: TWD, ASML: EUR, SKHY: KRW). Japanese units follow the site (lib/research/company-watch.ts watchMetricValue):
 * 億ドル, 億ユーロ, 兆ウォン; the New Taiwan dollar is 億台湾ドル. USD output is the same as MU's deep dive has always shown. */
export type DiveCurrency = "USD" | "EUR" | "TWD" | "KRW";
export const DIVE_CURRENCIES: readonly DiveCurrency[] = ["USD", "EUR", "TWD", "KRW"];
type Lang = "ja" | "en";

const trim = (value: number, places: number) => { const text = value.toFixed(places); return text.includes(".") ? text.replace(/0+$/, "").replace(/\.$/, "") : text; };
const group = (text: string) => { const [whole, fraction] = text.split("."); return whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",") + (fraction ? `.${fraction}` : ""); };

/** The scale of the chart, the outlook range and the revenue tile: 億 (10^8) for USD/EUR/TWD, 兆 (10^12) for KRW in Japanese;
 * billions for USD/EUR/TWD and trillions for KRW in English. */
const UNIT: Record<DiveCurrency, { ja: string; jaDivisor: number; en: string; enDivisor: number; enSuffix: string }> = {
  USD: { ja: "億ドル", jaDivisor: 100, en: "$", enDivisor: 1000, enSuffix: "B" },
  EUR: { ja: "億ユーロ", jaDivisor: 100, en: "€", enDivisor: 1000, enSuffix: "B" },
  TWD: { ja: "億台湾ドル", jaDivisor: 100, en: "NT$", enDivisor: 1000, enSuffix: "B" },
  KRW: { ja: "兆ウォン", jaDivisor: 1_000_000, en: "₩", enDivisor: 1_000_000, enSuffix: "T" },
};
const PER_SHARE: Record<DiveCurrency, { ja: string; en: string; places: number }> = {
  USD: { ja: "ドル", en: "$", places: 2 }, EUR: { ja: "ユーロ", en: "€", places: 2 }, TWD: { ja: "台湾ドル", en: "NT$", places: 2 }, KRW: { ja: "ウォン", en: "₩", places: 0 },
};

/** The number alone in the scale unit ("1,131.3" 億ドル, "24.45" 兆ウォン). */
export function diveScaled(million: number, currency: DiveCurrency, lang: Lang, places = 2): string {
  const unit = UNIT[currency];
  // Japanese drops trailing zeros (113.15億ドル, 5.8億ドル); English keeps the fixed places ($11.30B), as MU's dive always has.
  return lang === "ja" ? group(trim(million / unit.jaDivisor, places)) : group((million / unit.enDivisor).toFixed(places));
}
/** The scale unit for a caption: "億ドル", "$B", "₩T". */
export function diveUnit(currency: DiveCurrency, lang: Lang): string {
  const unit = UNIT[currency];
  return lang === "ja" ? unit.ja : `${unit.en}${unit.enSuffix}`;
}
/** An amount with its unit: "5.82億ドル", "$582.3M" (under a billion in English), "€9.33B", "24.45兆ウォン", "₩24.45T". */
export function diveMoney(million: number, currency: DiveCurrency, lang: Lang): string {
  const unit = UNIT[currency], sign = million < 0 ? "−" : "", abs = Math.abs(million);
  if (lang === "ja") return `${sign}${diveScaled(abs, currency, lang)}${unit.ja}`;
  if (currency !== "KRW" && abs < 1000) return `${sign}${unit.en}${group(trim(abs, 1))}M`;
  return `${sign}${unit.en}${diveScaled(abs, currency, lang)}${unit.enSuffix}`;
}
/** A per-share amount: "1.23ドル" / "$1.23", "2,345ウォン" / "₩2,345". */
export function divePerShare(value: number, currency: DiveCurrency, lang: Lang): string {
  const unit = PER_SHARE[currency], sign = value < 0 ? "−" : "", text = group(Math.abs(value).toFixed(unit.places));
  return lang === "ja" ? `${sign}${text}${unit.ja}` : `${sign}${unit.en}${text}`;
}
