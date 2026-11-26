import subjects from "./company-subjects.json" with { type: "json" };

/** Owner, Nov 26 (「エヌビディア、ロンドンのキングスクロス拠点を拡大へ」 was listed under GOOGL): a company feed's search hit can be a story
 * about another company that only mentions this one in the article (the Google News query for GOOGL is "Alphabet Google"; King's Cross
 * is where Google's London offices are). A headline filed under a company is left out of that company when it names another company of
 * the roster and none of this company's names; it stays under the company it names. The names are lib/research/company-subjects.json,
 * read by scripts/research/company_wire.py too (off_subject), matched case-sensitively as whole words. Only rows from the search feeds
 * (Google News, Yahoo) are judged: the Stock News API files a story under the companies it is about. */
const SEARCH_FEEDS = new Set(["gnews", "yahoo"]);
const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const pattern = (names: readonly string[]) => new RegExp(`(?<![A-Za-z0-9])(?:${names.map(escape).join("|")})(?![A-Za-z0-9])`);
const OWN = new Map(Object.entries(subjects as Record<string, string[]>).map(([ticker, names]) => [ticker, pattern(names)]));
const OTHERS = new Map([...OWN.keys()].map(ticker => {
  const own = new Set((subjects as Record<string, string[]>)[ticker]);
  return [ticker, pattern(Object.values(subjects as Record<string, string[]>).flat().filter(name => !own.has(name)))];
}));
export function offSubject(ticker: string, title: string, source?: string) {
  if (!source || !SEARCH_FEEDS.has(source)) return false;
  const own = OWN.get(ticker);
  return !!own && !own.test(title) && OTHERS.get(ticker)!.test(title);
}
