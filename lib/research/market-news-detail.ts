export type MarketNewsDetail = {
  detailPolicy?: "treasury-performance-period-v1"; bodyJa?: string; bodyEn?: string;
};

/** Optional source-validated copy, never a body inferred from a headline alone.
 * The backend binds this marker to its current, complete retained original.
 * Recheck the exact public contract on every server/browser/render boundary. */
export function marketNewsDetail(value: Record<string, unknown>): MarketNewsDetail {
  if (value.detailPolicy !== "treasury-performance-period-v1"
    || value.topic !== "government-bonds" || typeof value.url !== "string"
    || !/^https:\/\/x\.com\/Barchart\/status\/\d+$/i.test(value.url)
    || typeof value.titleEn !== "string") return {};
  const years = /^U\.S\. Treasuries suffer their worst (\d+)-year period in history$/.exec(value.titleEn)?.[1];
  if (!years || value.titleJa !== `米国債、${years}年間の成績が史上最悪に`) return {};
  const bodyJa = `Barchartは、米国債の${years}年間の成績が史上最悪になったと伝えた。ここでの「${years}年」は成績を測る期間であり、国債の満期を示すものではない。投稿本文には具体的な騰落率や計算方法は記されていない。`;
  const bodyEn = `Barchart reported that U.S. Treasuries had suffered their worst ${years}-year period in history. Here, ${years} years refers to the performance measurement period, not bond maturity. The post text does not give a specific percentage change or calculation method.`;
  return value.bodyJa === bodyJa && value.bodyEn === bodyEn
    ? { detailPolicy: "treasury-performance-period-v1", bodyJa, bodyEn } : {};
}
