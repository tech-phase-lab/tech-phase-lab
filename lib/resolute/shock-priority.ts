/** Must-capture topics of the Shock Gauge candidates (owner, Nov 27). A headline about any of these always reaches the day's
 * candidates when it is in the edition window: no headline screen drops it (downside words, relevance, a bare price move, a short
 * text, the per-group intake cut), and it is ranked above the other stories of its group (market-wide first). The edition's own
 * "that day only" checks still apply (window, multi-day recaps, a headline % that is not the session's move, one story per event).
 * Order = priority. Plain regular expressions only. */
export type PriorityTopic = { key: string; ja: string; pattern: RegExp };
export const PRIORITY_TOPICS: readonly PriorityTopic[] = [
  { key: 'crash', ja: '急落・暴落', pattern: /\b(?:plung\w*|crash\w*|sell-?offs?|selloffs?|routs?|tumbl\w*|nosediv\w*|freefall)\b|急落|暴落|急反落|大暴落/i },
  { key: 'recession', ja: '恐慌・リセッション', pattern: /\b(?:depression|recessions?|recessionary|panic\w*)\b|世界恐慌|恐慌|リセッション|景気後退/i },
  { key: 'downgrade', ja: '格下げ', pattern: /\b(?:downgrad\w*|cut to (?:sell|underperform|underweight|neutral|hold|junk)|creditwatch negative|outlook (?:to )?negative|negative outlook)\b|格下げ|格付け.*引き下げ|見通し.*ネガティブ/i },
  { key: 'resign', ja: '辞任・退任', pattern: /\b(?:resign\w*|step(?:s|ping)? down|stepped down|ousted|ouster|exits?|departure|depart\w*|fired|retir\w+)\b(?=.*\b(?:CEO|CFO|COO|chair\w*|chief|president|founder)\b)|\b(?:CEO|CFO|COO|chair\w*|chief executive|chief financial officer|president|founder)\b.*\b(?:resign\w*|step(?:s|ping)? down|stepped down|ousted|ouster|exits?|departure|to leave|leaves|fired|retir\w+)\b|辞任|退任|解任/i },
  { key: 'tariff', ja: '関税', pattern: /\b(?:tariffs?|duties|trade war)\b|関税|貿易戦争/i },
  { key: 'retaliation', ja: '報復', pattern: /\b(?:retaliat\w*|countermeasures?)\b|報復|対抗措置/i },
  { key: 'hormuz', ja: 'ホルムズ海峡', pattern: /\b(?:Strait of Hormuz|Hormuz)\b|\bIran\w*\b.*\b(?:shipping|tankers?|strait)\b|ホルムズ/i },
  { key: 'rates', ja: '金利', pattern: /\b(?:interest rates?|rate (?:hikes?|cuts?|increase|decision)|Fed|Federal Reserve|FOMC|Powell|Treasury yields?|bond yields?|BOJ|Bank of Japan)\b|金利|利上げ|利下げ|FRB|日銀|米国債利回り/i },
  { key: 'oil', ja: '原油', pattern: /\b(?:oil|crude|OPEC\+?|Brent|WTI)\b|原油|石油輸出国機構/i },
];
/** The must-capture topics a headline is about, in priority order (empty when none). */
export function priorityTopics(title: string): PriorityTopic[] {
  const t = typeof title === 'string' ? title.normalize('NFKC') : '';
  return PRIORITY_TOPICS.filter(p => p.pattern.test(t));
}
/** The headline's best priority rank (0 = the first topic), or null when it is about none of them. */
export function priorityRank(title: string): number | null {
  const found = priorityTopics(title);
  return found.length ? PRIORITY_TOPICS.indexOf(found[0]) : null;
}
