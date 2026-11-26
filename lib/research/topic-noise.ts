import providers from "./providers.json" with { type: "json" };
import calendar from "./calendar-coverage.json" with { type: "json" };
import { THEME_TICKERS } from "./theme-definitions.ts";

/** 注目トピック's own noise rules (owner, Nov 26: 「関係のない記事は、あなたのほうで消してほしい」). The shared rules (LOW_VALUE in
 * wire-stories.ts, and MARKETING_SHOWCASE when it lands) already apply to every list; these drop, from the topics page only, the
 * routine notices that carry no market-moving fact:
 * - conference attendance ("X to Present at the UBS Global Technology Conference", "X to Participate in Upcoming Investor Conferences");
 * - earnings dates without results ("X to Report Third Quarter 2026 Results on December 3", "X Announces Timing of Q3 Results"), except
 *   for a covered company;
 * - stock-option grants; small-cap financings (private placements, unit and flow-through offerings, warrants, with their extensions and
 *   amendments) and OTC moves (a covered company's financing is kept);
 * - (owner, Nov 26) a single mining or exploration company's notice, and anything from the small-cap press-release wires (Newsfile,
 *   ACCESS Newswire, TheNewswire) that names no covered company;
 * - exchange deficiency notices (kept for a covered company);
 * - TV clips, opinion pieces and panel talk ("Where the market may be mispricing risk most", "Former Tesla engineer says ...");
 * - promotions, events and awards ("Partner of the Year", "Holiday Magic", "Announces Converge 2026: ...");
 * - options listed on ETFs.
 * Results themselves ("X Reports Third Quarter 2026 Results") are never matched. All patterns read the English headline. */

/** The companies the site covers (owner, Nov 26: the monitored companies and the earnings-calendar names in providers.json and
 * calendar-coverage.json, and the Theme Ranking members): their news is kept. */
export const COVERED = new Set<string>([...(providers as { ticker: string }[]).map(provider => provider.ticker),
  ...(calendar as { ticker: string }[]).map(entry => entry.ticker), ...THEME_TICKERS]);

const CONFERENCE = new RegExp([
  String.raw`\b(?:to|will) (?:present|participate|speak|attend|ring|host (?:a )?fireside chat)\b.{0,100}\b(?:conferences?|summit|forum|symposium|investor (?:day|meetings?|events?)|events?)\b`,
  String.raw`|\b(?:announces?|confirms?) (?:its )?(?:participation|attendance|presentation) (?:at|in)\b`,
  String.raw`|\bparticipat(?:e|es|ion) (?:at|in) (?:the )?(?:upcoming )?(?:investor |industry )?(?:conferences?|events?|summits?)\b`,
  String.raw`|\bpresent(?:s|ing)? at (?:the )?(?:upcoming )?(?:[\w&'’.-]+ ){0,8}(?:conference|summit|forum)\b|\bupcoming (?:investor )?conferences?\b`,
].join(""), "i");
const EARNINGS_DATE = new RegExp([
  String.raw`\b(?:to|will) (?:report|announce|release|host|hold)\b.{0,100}\b(?:results|earnings)\b`,
  String.raw`|\b(?:announces?|sets?|schedules?|confirms?) (?:the )?(?:timing|date|dates|release date) (?:of|for)\b.{0,80}\b(?:results|earnings)\b`,
  String.raw`|\b(?:earnings|conference) call (?:date|schedule|details)\b|\b(?:results|earnings) release date\b`,
].join(""), "i");
const OPTION_GRANT = /\b(?:grants?|granted|grant of|issuance of)\b.{0,40}\b(?:stock options|incentive (?:stock )?options|options to purchase|RSUs|restricted (?:stock|share) units|DSUs|deferred share units)\b|\b(?:stock option|equity incentive|inducement) grants?\b/i;
const SMALL_FINANCING = new RegExp([
  String.raw`\bprivate placement\b|\bregistered direct offering\b|\bnon-brokered\b|\bbrokered (?:private|offering|financing)\b|\bflow[- ]through\b|\bFT offering\b`,
  String.raw`|\bunit offering\b|\btranche\b|\bwarrants?\b|\bshares[- ]for[- ]debt\b|\bwarrant (?:exercise|incentive)\b|\bat-the-market\b|\bATM (?:program|offering)\b`,
  String.raw`|\bOTCQ[XB]\b|\bupgrades? to (?:the )?OTC\b|\bbegins? trading on (?:the )?OTC\b`,
].join(""), "i");
const DEFICIENCY = new RegExp([
  String.raw`\b(?:nasdaq|nyse)\b.{0,60}\b(?:notice|notification|deficiency|delisting|minimum bid|listing extension|non-?compliance)\b`,
  String.raw`|\bminimum bid price\b|\bregain(?:s|ed)? compliance\b|\blisting (?:deficiency|extension)\b|\btransfer to (?:the )?nasdaq capital market\b`,
].join(""), "i");
const TV_PUBLISHER = /markets and finance|\btelevision\b|\bTV\b|youtube|podcast/i;
const TALK = new RegExp([
  String.raw`\|\s*(?:closing bell|bloomberg[\w\s]*|squawk[\w\s]*|mad money|power lunch|fast money|worldwide exchange|surveillance|the close|open interest`,
  String.raw`|wall street week|balance of power|money movers|halftime report)\s*$`,
  String.raw`|\b(?:former|ex-)[\w\s-]{0,40}\b(?:engineers?|executives?|execs?|employees?|ceos?|officials?|traders?) (?:says|say|warns?|thinks?|believes?|predicts?)\b`,
  String.raw`|\bwhere (?:the )?markets? (?:may|might|could|is|are)\b|\b(?:fund|money|portfolio) managers? (?:say|see|warn|discuss|weigh)\b|\bstrategists? (?:say|see|warn)\b|\bpanel (?:discussion|talk)\b|\bpanelists?\b`,
].join(""), "i");
const PROMO = new RegExp([
  String.raw`\b(?:partner|company|employer|vendor|supplier|retailer|brand|innovator) of the year\b`,
  String.raw`|\b(?:wins?|won|receives?|received|earns?|earned|honou?red with|takes home)\b.{0,60}\bawards?\b|\bawards?\b.{0,20}\b(?:winners?|finalists?|recipients?)\b`,
  String.raw`|\bholiday magic\b|\bplayland\b|\bpop-?up\b|\bsweepstakes\b|\bgiveaway\b`,
].join(""), "i");
/** An event announced by name and year ("Globant announces Converge 2026: an edition about ..."); case matters here. */
const EVENT = /\b[Aa]nnounces [A-Z][\w.]+ 20\d\d\s*[:–—-]/;
const DEAL = /\bcontracts?\b|\border\b|[$€£¥]\s?\d|\b\d[\d,.]*\s?(?:million|billion|mln|bln|bn)\b/i;
const ETF_OPTIONS = /\boptions? (?:now )?(?:available|listed|launch(?:es|ed)?|begins? trading)\b.{0,100}\bETFs?\b|\bETFs?\b.{0,60}\boptions? (?:now )?(?:available|listed)\b/i;

const PRESS_WIRE = /business ?wire|pr ?newswire|globe ?news ?wire/i;
/** Press-release wires that carry mostly small-cap releases. */
const SMALL_WIRE = /newsfile|access ?(?:news)?wire|thenewswire/i;
/** A mining or exploration company's own notice: the company named as a miner, or drilling, assays and resource estimates. */
const MINING = new RegExp([
  String.raw`\b(?:gold|silver|copper|lithium|uranium|nickel|zinc|cobalt|graphite|rare earths?|antimony|tungsten|vanadium|platinum|palladium|mining|minerals|metals|exploration|resources?)`,
  String.raw` (?:corp\.?|corporation|inc\.?|ltd\.?|limited|plc|mines|mining)\b`,
  String.raw`|\bdrill(?:ing|s)? (?:results|program(?:me)?|holes?|intercepts?)\b|\bassays?\b|\bg\/t\b|\bmineral (?:resources?|reserves?|claims?|propert(?:y|ies)|exploration)\b`,
  String.raw`|\bpreliminary economic assessment\b|\bfeasibility study\b|\bexploration (?:program|project|permit|update)\b`,
].join(""), "i");

export type TopicNoise = "small-wire" | "mining" | "conference" | "earnings-date" | "option-grant" | "small-financing" | "deficiency" | "talk" | "promo" | "etf-options";

/** Why a headline is not a topic, or null. ``tickers`` are the companies it is filed under; a covered one keeps its earnings dates,
 * financing and listing news. */
export function topicNoise(titleEn: string, publisher: string, tickers: readonly string[]): TopicNoise | null {
  const title = titleEn ?? "";
  const covered = tickers.some(ticker => COVERED.has(ticker));
  if (CONFERENCE.test(title)) return "conference";
  if (!covered && EARNINGS_DATE.test(title)) return "earnings-date";
  if (OPTION_GRANT.test(title)) return "option-grant";
  if (!covered && SMALL_FINANCING.test(title)) return "small-financing";
  if (!covered && DEFICIENCY.test(title)) return "deficiency";
  // A news outlet's market story under MKT ("Gold hits a record") is market-wide, not a miner's notice.
  const marketStory = tickers.every(ticker => ticker === "MKT") && !PRESS_WIRE.test(publisher ?? "") && !SMALL_WIRE.test(publisher ?? "");
  if (!covered && !marketStory && MINING.test(title)) return "mining";
  if (!covered && SMALL_WIRE.test(publisher ?? "")) return "small-wire";
  if (TV_PUBLISHER.test(publisher ?? "") || TALK.test(title)) return "talk";
  // A contract award or a deal with a figure is news, not a prize ("Lockheed wins $1.2 billion Army contract award").
  if ((PROMO.test(title) || EVENT.test(title)) && !DEAL.test(title)) return "promo";
  if (ETF_OPTIONS.test(title)) return "etf-options";
  return null;
}
