export type MarketNewsDetail = {
  detailPolicy?: "treasury-performance-period-v1" | "source-summary-v1"; bodyJa?: string; bodyEn?: string;
};

/** Optional source-validated copy, never a body inferred from a headline alone.
 * The backend binds this marker to its current, complete retained original.
 * Recheck the exact public contract on every server/browser/render boundary. */
export function marketNewsDetail(value: Record<string, unknown>): MarketNewsDetail {
  if (value.detailPolicy === "source-summary-v1") return summaryDetail(value);
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

/** Model-written post summary, already checked by the monitor against the full
 * retained post (numbers, direction, negation, names). Here only the public
 * shape is enforced: bounded plain text, Japanese in the Japanese field, and
 * no repeat of the headline. */
function summaryDetail(value: Record<string, unknown>): MarketNewsDetail {
  const ja = value.bodyJa, en = value.bodyEn;
  if (typeof ja !== "string" || typeof en !== "string") return {};
  const plain = (text: string) => text.length >= 10 && text.length <= 1200 && !/[\u0000-\u0008\u000b-\u001f\u007f<>]/.test(text);
  if (!plain(ja) || !plain(en) || !/[\u3040-\u30ff\u4e00-\u9fff]/.test(ja)
    || ja === value.titleJa || en === value.titleEn) return {};
  return { detailPolicy: "source-summary-v1", bodyJa: ja, bodyEn: en };
}
