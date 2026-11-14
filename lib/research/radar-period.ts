const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** The quarter the newest results cover, e.g. "7〜9月期" (owner, Nov 14: "2026年9月時点" read as stale in November although it is the latest quarter).
 * A 52/53-week quarter that ends in the first days of a month (Oct 2, Aug 1) belongs to the month before. */
export const quarterOf = (date: string | null, ja: boolean) => {
  const m = date ? /^(\d{4})-(\d{2})-(\d{2})/.exec(date) : null;
  if (!m) return "";
  let end = Number(m[2]) - (Number(m[3]) <= 7 ? 1 : 0);
  if (end < 1) end += 12;
  const start = (end + 9) % 12 + 1;
  return ja ? `${start}〜${end}月期` : `${MONTHS[start - 1]}–${MONTHS[end - 1]} quarter`;
};
