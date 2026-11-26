import type { Language } from "./data";
import type { CompanyWireItem } from "./company-wire.ts";
import { tidyJapanese } from "./ja-text.ts";
import { calendarEvents, dateOnlyEarnings } from "./calendar.ts";
import { MARKETING_SHOWCASE_EN, MARKETING_SHOWCASE_JA } from "./marketing-showcase.ts";

/** Company headlines as stories (owner, Oct 17): the same story arrives for several companies and from
 * several publishers, and the lists showed it five times. One story is one row, listing every company it
 * names; headlines that are not news about the company (community posts, "stocks to buy" lists, fund
 * trades) are left out. */
export type WireStory = { id: string; tickers: string[]; title: string; url: string; publisher: string; origin: CompanyWireItem["origin"]; at: string; /** One line of 22 characters or fewer for the news band (Japanese only, when made). */ short?: string; /** The Stock News API's sentiment, when known (topics page). */ sentiment?: CompanyWireItem["sentiment"] };

/** A law firm advertising a shareholder investigation or class action is not news, whatever the firm (owner, Nov 15: 注目トピック showed
 * 「GILT投資家にSBS法律事務所と…詐欺調査参加の機会」). Caught by the firm's name or by the solicitation wording, in English or Japanese;
 * news about a lawsuit itself ("SEC sues …", "Intel shareholders sue after 29% drop") is kept. The same patterns are
 * LAW_FIRM_SOLICITATION in scripts/research/company_wire.py, which drops such headlines before translation; keep the two in step. */
export const LAW_FIRM_SOLICITATION = new RegExp([
  String.raw`\b(?:Rosen Law|Pomerantz|Faruqi|Bragar,? Eagel|Levi (?:&|and) Korsinsky|Bronstein,? Gewirtz|Glancy,? Prongay|Kessler,? Topaz|Robbins Geller`,
  String.raw`|Robbins LLP|Schall Law|Gross Law|Portnoy Law|Kirby McInerney|Howard G\. Smith|Frank R\. Cruz|Bernstein Liebhard|Bernstein Litowitz|Hagens Berman`,
  String.raw`|Block (?:&|and) Leviton|Johnson Fistel|Holzer (?:&|and) Holzer|Edelson Lechtzin|Halper Sadeh|Ademi (?:Firm|LLP|& O)|Monteverde (?:&|and) Associates`,
  String.raw`|Brodsky (?:&|and) Smith|Rigrodsky|Wohl (?:&|and) Fruchter|Kahn,? Swick|Lieff Cabraser|Labaton|Saxena White|Scott\+Scott|Berger Montague`,
  String.raw`|Bleichmar,? Fonti|Lowey Dannenberg|Wolf Haldenstein|Kaskela|Khang (?:&|and) Khang|Grabar Law|Squitieri|DJS Law|SBS (?:Law|Legal))\b`,
  String.raw`|\bwith (?:the )?SBS\b|\b(?:law firm|law offices?)\b.{0,120}\b(?:investors?|shareholders?|stockholders?|investigation|class action)\b`,
  String.raw`|\b(?:investors?|shareholders?|stockholders?|investigation|class action)\b.{0,120}\b(?:law firm|law offices?)\b`,
  String.raw`|\b(?:investors?|shareholders?|stockholders?)\b.{0,100}\b(?:encouraged|urged|reminded|opportunity|have until)\b.{0,40}\bto (?:contact|join|participate|inquire|discuss|learn more|secure|seek)\b`,
  String.raw`|\b(?:encourages?|urges?|reminds?)\b.{0,60}\b(?:investors|shareholders|stockholders)\b.{0,40}\bto (?:contact|join|participate|inquire|discuss|secure counsel|seek)\b`,
  String.raw`|\b(?:encourages?|urges?|reminds?) (?:shareholders|investors|stockholders)\b|\bsecure counsel\b`,
  String.raw`|\bopportunity to (?:join|lead|participate in)\b.{0,80}\b(?:investigation|lawsuit|class action|litigation)\b`,
  String.raw`|\b(?:join|participate in)\b.{0,80}\b(?:fraud investigation|securities (?:class action|lawsuit|litigation|fraud)|class action)\b`,
  String.raw`|\binvestigat(?:ion|ions|es|ing)\b.{0,60}\bon behalf of\b.{0,40}\b(?:investors|shareholders|stockholders)\b`,
  String.raw`|\b(?:class action|lawsuit|lead plaintiff|securities (?:suit|litigation))\b.{0,100}\bdeadline\b|\bdeadline\b.{0,100}\b(?:class action|lawsuit|lead plaintiff)\b`,
  String.raw`|\b(?:deadline|investor|shareholder|stockholder) alert\b|\blead plaintiff\b|\bclass period\b`,
  String.raw`|\b(?:investors?|shareholders?|stockholders?) (?:who|that) (?:lost|suffered|incurred)\b|\b(?:have you|did you) (?:lose|lost|suffer)\b`,
  String.raw`|\b(?:investors?|shareholders?) with (?:substantial |significant )?losses\b`,
  String.raw`|法律事務所|弁護士事務所|ロー・?ファーム|ブロンスタイン|ローゼン法律|ポメランツ|株主に対し.{0,20}(?:調査|問い合わせ)`,
  String.raw`|(?:調査|集団訴訟|訴訟)(?:へ|に)?の?参加|(?:投資家|株主)(?:に|へ)(?:対し(?:て)?)?.{0,20}(?:呼びかけ|呼び掛け|参加を促|連絡を促|問い合わせを)`,
  String.raw`|集団訴訟.{0,30}(?:期限|締め?切|参加|呼びかけ|原告募集|主導)|(?:期限|締め?切り?).{0,20}集団訴訟|株主向け警告|リード原告|主任原告`,
  String.raw`|損失を(?:被った|出した|抱えた|受けた)(?:投資家|株主)`,
].join(""), "i");
export const lawFirmSolicitation = (text: string) => LAW_FIRM_SOLICITATION.test(text);

/** Market live blogs and wraps, stock-picking lists, explainers and opinion are not news about the company (owner, Nov 20:
 * 「いらないニュース全排除で」 — 速報 showed 「株式市場本日：…（ライブ中継）」, 「TSMCを超えて：注目すべき台湾の小型テクノロジー株3銘柄」,
 * 「サンディスク株が8分割—投資家にとっての意義とは」, 「インテル18A対TSMC N2：チップの主張の読み方」 and
 * 「AnthropicのIPO：その支出約束が…に意味すること」). Only wording that a report of a concrete event (results, guidance, a deal, a
 * launch, a ruling, a rating or target change, a hire, a filing) does not use is listed. LOW_VALUE, LOW_VALUE_SOFT and CONCRETE_EVENT are
 * LOW_VALUE_EN, LOW_VALUE_SOFT_EN and CONCRETE_EVENT_EN in scripts/research/company_wire.py, which drops such headlines before
 * translation; keep them in step (a test compares them). */
export const LOW_VALUE = new RegExp([
  String.raw`\bstock market (?:today|news today|live)\b|\bstocks? (?:today|live)\s*:`,
  String.raw`|^\s*(?:Dow Jones|Nasdaq|S&P 500|Stock|Stocks) futures\s*:|^\s*(?:market (?:open|close)|closing bell|opening bell|morning bid|markets? wrap)\s*:`,
  String.raw`|^\s*beyond [^:]{1,40}:|\b(?:\d{1,2}|two|three|four|five|six|seven|eight|nine|ten)\s+(?:[\w&.'’-]+\s+){0,4}(?:stocks|picks)\s+(?:to|for|that|worth|you|i)\b`,
  String.raw`|\bstocks? to (?:watch|buy|own|hold|consider|avoid|sell)\b|\bstock I.d (?:buy|own|hold)\b`,
  String.raw`|\bis (?:it|now) (?:a|the) (?:good |right |smart )?(?:buy|time to)\b|\bstock a buy\b|\bshould you (?:buy|sell|hold|invest|own|worry|be worried|panic|consider)\b`,
  String.raw`|\b(?:buy|sell|hold),? (?:or|and) (?:sell|hold|buy)\b|^\s*(?:prediction|opinion|analysis|commentary|explainer|my take)\s*:|\bbreakingviews\b`,
  String.raw`|^\s*dear\b|\bbetter buy\s*:|\b(?:no-brainer|screaming buy|millionaire|passive income)\b`,
  String.raw`|[.?!]\s+here.s (?:what(?! (?:really |actually )?(?:went wrong|happened|caused|we know|changed)\b)|how)\b`,
  String.raw`|\s[-–—]\s+(?:here.s (?:why|what happened)|should you (?:buy|sell)|time to (?:buy|sell))\b|\bshares gap (?:up|down)\b`,
  String.raw`|\((?:NASDAQ|NYSE|NYSEAMERICAN|AMEX|NYSEARCA):[A-Z.]+\).{0,80}\s[-–—]\s+what.s next\b`,
  String.raw`|\bGF (?:Score|Value|Rating)\b`,
  String.raw`|^\s*(?:what\b.{0,40}\bmeans?\s+(?:for|to)|what to know|how to (?:read|play|think about|invest|buy|trade|value))\b`,
  // Owner, Nov 24 (ハイテク速報「こういうニュースはいらない」): chart-of-the-day market recaps, options-chain and quote pages, social posts
  // ("@NVIDIAAI"), podcasts and webinars, stock price predictions and "I'd buy" pieces, and how-to tips.
  String.raw`|\bcharts? of the (?:day|week)\b|\btoday.s charts?\b|\bstocks that explain today.s market\b`,
  String.raw`|\boptions? chains?\b|\boptions spot-on\b|\b[A-Z]{1,6}\d{6}[CP]\d{8}\b|\b(?:interactive stock|seasonal returns) chart\b`,
  String.raw`|\bstock price,? news,? quote\b|\bquote (?:&|and) history\b|\bstock forum (?:&|and) discussion\b|\bquotes,? (?:&|and) charts\b`,
  String.raw`|(?:^|[\s(\[])@[A-Za-z_][A-Za-z0-9_]{2,}|\bpodcast\b|\bwebinar\b|\bfireside chat\b|\bepisode \d+\b`,
  String.raw`|\bstock (?:price )?(?:prediction|forecast)\b|\bI.d (?:still |also |happily |gladly )?(?:buy|sell|hold|own)\b|\bdeserves? (?:your )?attention\b|\bbargain buys?\b|^\s*(?:opinion|social buzz)\s*[:|]`,
  String.raw`|^\s*don.t (?:worry|panic|forget)\b|\btips (?:and|&) tricks\b|\bhere.s how to\b|\bstep[- ]by[- ]step\b`,
  // Owner, Nov 26 (速報 showed 「あなたのブースが待っています」：Denny'sがエヌビディアCEOジェンセン・フアンを歓迎): a restaurant or consumer brand's
  // stunt that merely names another company's CEO is not company news.
  String.raw`|\b(?:Denny.s|McDonald.s|Wendy.s|Burger King|Taco Bell|KFC|Starbucks|Chipotle|Domino.s|Pizza Hut|Subway|Popeyes|Krispy Kreme|Dunkin|IHOP|Waffle House`,
  String.raw`|Applebee.s|Chick-fil-A|In-N-Out|Shake Shack|Panda Express|diner|restaurant chain|fast[- ]food chain|(?:burger|pizza|coffee|donut|doughnut) chain)\b`,
  String.raw`.{0,60}\b(?:welcome[sd]?|congratulate[sd]?|celebrate[sd]?|honou?r(?:s|ed)?|salute[sd]?|toast(?:s|ed)?|troll(?:s|ed)?|roast(?:s|ed)?|thank(?:s|ed)?`,
  String.raw`|invite[sd]?|pays? tribute|shouts? out|gives?|offers?)\b(?! (?:its |a |the )?new (?:CEO|chief))`,
  String.raw`.{0,100}\b(?:CEO|founder|co-founder|chief executive|billionaire)\b`,
].join(""), "i");
/** Nov 20 review: explainers, "- live", "here's the" and bull/bear-case wording drop a headline only when it reports no concrete event
 * (CONCRETE_EVENT: a company that launches, names, invests, buys, wins, raises, cuts, reports, files, sues, surges ..., or a price target or
 * rating change), so "AMD launches MI400: what it means for Nvidia" and "Intel names new CEO - live" are kept. LOW_VALUE drops anywhere. */
export const LOW_VALUE_SOFT = new RegExp([
  String.raw`[(\[]\s*live(?: updates?| coverage| blog)?\s*[)\]]|\blive (?:updates|coverage|blog)\b|[-–—:|]\s*(?:business |markets? |stock market )?live\s*$`,
  String.raw`|\bwhat\b.{0,40}\bmeans?\s+(?:for|to)\b`,
  String.raw`|\bhere.s (?:what(?! (?:really |actually )?(?:went wrong|happened|caused|we know|changed)\b)|how|the(?! (?:full |complete )?(?:statement|letter|memo|text|transcript|filing)\b))\b`,
  String.raw`|\bwhat (?:you|investors|shareholders|traders|buyers) (?:need|should|must|ought|have) to know\b|\bwhat to know\b|\beverything (?:you|investors) need to know\b`,
  String.raw`|\bhow to (?:read|play|think about|invest(?: in)?|buy|trade|value|approach|navigate|position)\b`,
  String.raw`|\b(?:bull|bear) case\b|\s[-–—]\s+what.s next\b`,
  // Owner, Nov 24: "what changed / what's behind" teasers ("ASML Stock What Changed After Nvidia CEO Return"), interviews and Windows
  // interface trivia ("… vertical taskbars …"), unless a concrete event is reported.
  String.raw`|\bwhat(?:.s| has)? changed\b|\bwhat.s (?:behind|going on|driving)\b|\bwhat (?:sent|lifted|drove|pushed)\b`,
  String.raw`|\binterview with\b|\binterview\s*[:|]|\|\s*interview\b|\bsits down with\b|\bin conversation with\b|\bchats with\b`,
  String.raw`|\b(?:vertical )?taskbars?\b|\bstart menu\b|\bfile explorer\b|\bcontext menu\b|\bsnipping tool\b|\bwallpapers?\b|\bdark mode\b`,
  // Owner, Nov 26 (速報 showed 「中国関連企業幹部とエヌビディアのもう一つの関係」): "another connection" / "X's other relationship" teasers
  // name no fact, and nor does celebrity trivia (leather jackets, autographs, selfies), unless a concrete event is reported.
  String.raw`|\b(?:another|(?:the|his|her|its|their) other|one more|(?:a |the )?(?:hidden|secret|little-known|unexpected|surprising|curious|strange|odd))\s+`,
  String.raw`(?:[\w'’-]+\s+){0,2}(?:connections?|links?|ties|relationships?|side)\b|.s other (?:[\w'’-]+ )?(?:connections?|links?|ties|relationships?)\b`,
  String.raw`|\b(?:leather jackets?|autographs?|selfies?)\b`,
].join(""), "i");
export const CONCRETE_EVENT = new RegExp([
  String.raw`\b(?!(?:How|Time|What|Why|When|Where|Who|Here|Stock|Stocks|Shares|Has|Have|Had|Is|Are|Was|Were|Be|It|I|You|We|They|He|She)\b)[A-Z][\w&.'’-]*\s+(?:to\s+|will\s+)?(?:[Ll]aunch(?:es|ed)?|[Nn]ames|[Nn]amed|[Ii]nvest(?:s|ed)?|[Bb]uys|[Bb]uy|[Bb]ought|[Aa]cquires?|[Aa]cquired`,
  String.raw`|[Ww]ins|[Ww]in|[Ww]on|[Rr]aises|[Rr]aised|[Cc]uts|[Cc]ut|[Ll]owers|[Ll]owered|[Uu]pgrades|[Uu]pgraded|[Dd]owngrades|[Dd]owngraded`,
  String.raw`|[Rr]eports|[Rr]eported|[Bb]eats|[Mm]isses|[Mm]issed|[Aa]nnounces|[Aa]nnounced|[Ff]iles|[Ff]iled|[Aa]pproves|[Aa]pproved|[Bb]ans|[Bb]anned`,
  String.raw`|[Ss]ues|[Ss]ued|[Aa]grees|[Aa]greed|[Ss]urges|[Ss]urged|[Pp]lunges|[Pp]lunged)\b`,
  String.raw`|\b(?:[Pp]rice [Tt]arget|[Tt]arget [Pp]rice|PT)\b|\b(?:[Uu]pgrade[sd]?|[Dd]owngrade[sd]?)\b`,
].join(""));
/** The same kinds of headline in Japanese, for a translated title whose English wording differs (owner, Nov 20). */
const LOW_VALUE_JA = /株式市場(?:本日|今日)|(?:本日|今日)の株式市場|[(（]\s*ライブ(?:中継|更新|ブログ)?\s*[)）]|ライブ(?:中継|更新|ブログ)\s*$|注目すべき.{0,30}(?:銘柄|株)|買うべき.{0,20}(?:銘柄|株)|(?:銘柄|株)\d+選|(?:意味|意義)(?:とは|するもの)|(?:意味|意義)すること\s*$|の読み方|知っておくべき(?:こと|点)|投資家が知るべき|(?:にとっての意味|に与える影響とは|が意味すること|は何を意味|にとって何を意味)\s*$|オプション[・･]?チェーン|(?:本日|今日)のチャート|ポッドキャスト|ウェビナー|何が変わった|タスクバー|(?:^|[\s。、])@[A-Za-z_][A-Za-z0-9_]{2,}|もう一つの(?:関係|つながり|繋がり|接点|顔|側面)|(?:意外|隠れた|知られざる|秘密)(?:な|の)?(?:関係|つながり|繋がり|接点)|(?:デニーズ|Denny.s|マクドナルド|ウェンディーズ|バーガーキング|タコベル|ケンタッキー|KFC|スターバックス|チポトレ|ドミノ[・･]?ピザ|ピザハット|ダイナー|レストランチェーン|ファストフード)(?:が|は).{0,40}(?:CEO|創業者).{0,30}(?:歓迎|祝福|祝|称え|たたえ|感謝|招待)|革ジャン|レザージャケット|自撮り/; // @handles: teasers whose answer is in an article we do not carry (owner, Oct 26); もう一つの関係 teasers, brand stunts naming a CEO and celebrity trivia (owner, Nov 26)
/** GuruFocus templates ("GF Score", "GF Value"), as they were translated (owner, Nov 21). */
const GF_TEMPLATE_JA = /GF\s?(?:評価|スコア|バリュー|レーティング)/;
const lowValueEn = (text: string) => LOW_VALUE.test(text) || ((LOW_VALUE_SOFT.test(text) || MARKETING_SHOWCASE_EN.test(text)) && !CONCRETE_EVENT.test(text));
/** ``english`` is the English headline of a translated ``text``: a Japanese explainer phrase is not dropped when the English one reports an event. */
export const lowValue = (text: string, english = text) => lowValueEn(text) || GF_TEMPLATE_JA.test(text) || ((LOW_VALUE_JA.test(text) || MARKETING_SHOWCASE_JA.test(text)) && !CONCRETE_EVENT.test(english));

const NOT_NEWS = [
  /\$[^$\n]{1,80}\([A-Z.]{1,8}\.US\)\$/,                       // community posts: $NVIDIA (NVDA.US)$
  /\bNet ETF (?:Buying|Selling)\b|\bETFs? Are (?:Buying|Selling)\b|^Lobbying Update\b/i,
  /\b(?:ETF|Trust|Fund)\b.{0,60}\b(?:Buys|Sells|Bought|Sold)\b.{0,60}\bon\b/i,
  /\bZacks (?:Analyst Blog|Investment Ideas)\b|\bTake five\b|\blifetime access\b|\bfor one \$\d+ payment\b|\bBC-Most Active\b/i,
  /\bForecast\s+[—–-]\s+Price Target\b|\bPrediction for 20\d\d\b/i,
  /\b\d+ (?:Top |Best )?(?:AI |Tech |Dividend |Growth )?Stocks? (?:to Buy|You Can)\b|\bBest .{0,24}Stocks? to Buy\b|\bBetter (?:AI |Tech )?Stock:|\bToo Late to Buy\b|\bBuy Now and Hold\b|\bShould You Buy\b|\bDon.t miss\b/i,
  /\bETFs?\b.{0,50}\b(?:buy|buys|smartest|best)\b|\b(?:buy|buys)\b.{0,30}\bETFs?\b|\b(?:if|when) (?:you|the stock market).{0,40}(?:\$1,?000\b|\bcrash|\bplunge)|\bhistory shows\b/i, // "buy these ETFs" advice: no detail to open
  /\bDisney\b.{0,40}\bCharacter\.AI\b/i,
  /株式市場の暴落.{0,20}ETF|ETFを買い|ETFが最も賢い|ディズニー.{0,10}Character\.AI/,
  /\bhere.s why\b|\bthis is why\b|\bthe (?:real |main |simple |surprising )?reasons? (?:why|that|behind)\b|\b(?:and )?why\b.{0,80}\b(?:reasons?)\b/i, // teasers whose answer is not in the headline
  /\?\s*$/, // a headline that asks a question has no fact in it
  /[？?]\s*$/,
  /^why\b/i, // "Why …" headlines give the reason only in the article
  /^なぜ|のか$|でしょうか$|だろうか$/,
  /理由$|その理由|理由とは|なぜ.{0,40}[？?]$/,
  /\bbuying opportunit(?:y|ies)\b|\bbuy the dip\b|\btime to buy\b|買いの機会|買い時|買い場|押し目買い/i, // opinion pieces that argue for buying carry no news fact
  /逃した[?？]|見逃さない(?:よう|で)|お気に入りの恐竜/,
  /\bweek in review\b|\bweekly (?:news )?(?:roundup|digest|recap|wrap)\b|\bthis week(?:['’]s)? (?:top|key|main|biggest|major)\b|\bwhat happened this week\b|今週の(?:主な)?(?:動向|ニュース|まとめ)|週間(?:まとめ|ニュース|動向)/i, // weekly digests read as a teaser for a longer piece
  /(?:\b(?:EUR|GBP|CHF)\s?\d[\d.,]*|\d[\d.,]*\s?(?:EUR|GBP|CHF)\b|(?:ユーロ|ポンド)\s?\d[\d.,]*).{0,12}(?:で取引|\btrad)|\btrad\w*\b.{0,24}\b(?:EUR|GBP|CHF)\s?\d/i, // a foreign-currency quote, not news
  LAW_FIRM_SOLICITATION, // law-firm solicitations (owner, Oct 26; any firm or wording, Nov 15)
  /\b(?:tracking|following|eyeing)\b.{0,50}\bearnings\b|決算を追う|ウォール街が(?:ラリー|反発|続伸|下落|急落)|\bWall Street (?:rallies|rally mode|slides|falls|climbs|stabili[sz]es)\b/i, // other companies' earnings round-ups and market-wide wraps
  /\bearnings preview\b|\b(?:Q[1-4]|quarter(?:ly)?) (?:earnings )?preview\b|\bwhat to (?:expect|watch)\b|\bwhat (?:investors )?should (?:you )?expect\b|\bkey things to watch\b|\b(?:set|slated|scheduled) to (?:report|release|announce)\b.{0,60}\btomorrow\b|\b(?:reports?|releases?) (?:Q[1-4]|\w+ quarter) (?:results|earnings) tomorrow\b|決算[：:].{0,30}(?:注目点|注目すべき点|何を期待|期待すべき|予想される)|決算.{0,40}(?:注目点|注目すべき点|期待すべきか|予想される内容)\s*$|が明日.{0,24}(?:決算|結果)を?発表|決算(?:報告)?プレビュー|^注目の決算[：:]/i, // earnings previews and "what to expect" teasers (owner, Oct 27)
  /^\s*How\s+\S|(?:方法|やり方)(?:とは)?[。！?？]?\s*$/i, // "How X did Y" explainers ("…した方法"), not news (owner, Oct 28)
  /\bCVE-\d{4}-\d{4,}\b|\bCVSS\s?\d/i, // vulnerability database entries, not company news (owner, Oct 27)
  /(?:^|\s)(?:Form|Filing)\s+(?:6-K|8-K|10-Q|10-K|20-F|40-F)(?:\/A)?\b|(?:の|^)フォーム\s?(?:6-K|8-K|10-Q|10-K|20-F|40-F)(?:\/A)?(?![A-Za-z0-9])/i, // a bare SEC form notice ("… Form 6-K: October 28", "…のフォーム10-Q（9月30日分）"), not news (owner, Oct 28)
  /\bweekend trading\b|\bin (?:after|pre)-?(?:hours|market) trading\b.{0,20}\b(?:euros?|yen|pounds?)\b|\btrades? (?:at|for) [\d.,]+ (?:euros?|yen|pounds?)\b|週末取引|[\d.,]+\s?(?:ユーロ|ポンド)で取引/i, // price quotes in a foreign currency while the U.S. market is shut (owner, Oct 26)
  /決算説明会(?:で|での)(?:述べたこと|発言内容|の発言(?:内容|要旨)?|語ったこと|話したこと)|決算説明会の(?:書き起こし|トランスクリプト)|\bearnings call transcript\b|\bwhat\b.{0,60}\b(?:said|says|told)\b.{0,40}\b(?:earnings call|conference call)\b|\b(?:Q[1-4]|(?:first|second|third|fourth) quarter) (?:20\d\d )?earnings call (?:highlights|takeaways)\b/i, // call transcripts, mostly of other companies tagged to a watched one (owner, Oct 31)
  /(?:大きく|最も|大幅に)動いた(?:株式|株|銘柄)|\b(?:biggest|big|top) (?:stock )?(?:movers|moves)\b|\bstocks? (?:making|that made)\b.{0,30}\b(?:moves?|midday|premarket)\b|\b(?:midday|pre-?market|after-?hours) movers\b/i, // "stocks that moved most" roundups that merely list the company (owner, Oct 31)
  /\b[A-Z]{2,8}[:：]\d{2,6}\b/, // a stock-data page title carrying an exchange code ("… – BSESOF:1170")
  /(?:総資産|総負債|株主資本|\bTotal (?:Assets|Liabilities)|\bShareholders.? Equity)\s*[–—-]\s*\S/i, // financial-data pages, not news (owner, Oct 31)
  /シマンテック(?:の)?(?:脅威|保護)|\bSymantec (?:Protection|Threat|Security) (?:Bulletin|Intelligence|Report|Research)|\bProtection Bulletin\b/i, // vendor threat bulletins (owner, Oct 31)
  /唯一の疑問|疑問に答えられ|\b(?:only|one) (?:big |key |real )?question\b.{0,40}\b(?:investors?|unanswered|remains)\b|\b(?:doesn.t|does not|fail(?:s|ed)? to) answer\b.{0,40}\bquestion\b/i, // a teaser whose answer is not in the headline (owner, Oct 31)
  /(?:が|は|も|両社が|それぞれが).{0,40}(?:語った|述べた|話した|明かした)(?:内容|こと)[。.]?\s*(?:[(（][A-Z.]{1,6}\s*[:：]\s*[A-Za-z]{2,10}[)）])?\s*$|\bwhat\b.{0,60}\b(?:both|each|they|he|she)\b.{0,30}\b(?:said|says|told)\b|^\s*what\b.{0,60}\b(?:said|says|told)\b/i, // "what X said" summaries: no fact in the headline (owner, Oct 31)
  /【\s*20\d\d(?:年)?\s*】\s*$|\[\s*20\d\d\s*\]\s*$/, // a search-engine year tag glued on the end ("…チップ【2026年】")
  /Windows\s?1[01]\b.{0,60}(?:クラッシュダンプ|ブルースクリーン|ショートカット|隠し機能|長押し)|(?:電源ボタン|長押し).{0,40}Windows|\b(?:crash dumps?|blue screen|BSOD|keyboard shortcuts?)\b/i, // PC how-to trivia, not company news (owner, Oct 31)
  /(?:雇用統計|雇用情勢|非農業部門|消費者物価|\bCPI\b|\bFOMC\b).{0,14}(?:発表予定|公表予定|発表へ|控え|待ち)|来週.{0,10}(?:雇用統計|消費者物価|\bCPI\b|\bFOMC\b)|\b(?:jobs report|nonfarm payrolls?|CPI report|FOMC (?:meeting|decision))\b.{0,30}\b(?:next week|due|scheduled|ahead)\b|\b(?:next|this) week\b.{0,30}\b(?:jobs report|nonfarm payrolls?|CPI|FOMC)\b/i, // market-wide data calendar teasers, not company news (owner, Nov 2)
  /動画を(?:公開|投稿|アップロード|配信)|\b(?:publish(?:es|ed)?|post(?:s|ed)?|upload(?:s|ed)?|releases?)\s+(?:a |new |an )?(?:promo(?:tional)? )?videos?\b/i, // a company video, not news (owner, Nov 2)
  /真の(?:答え|理由|原因|狙い|価値)|\bthe (?:true|real) (?:answer|story)\b/i, // a teaser whose answer is not in the headline (owner, Nov 2)
  /\b(?:IDBI Capital|Motilal Oswal|ICICI Securities|Kotak Securities|Axis Securities|Nirmal Bang|Anand Rathi|HDFC Securities|Sharekhan|Emkay Global|Prabhudas Lilladher|Navin Fluorine|GE Vernova T&D India)\b|IDBIキャピタル|モティラル・オスワル|ICICIセキュリティーズ|コタック証券|ナビンフルオライド|(?:修正|改定)目標株価をチェック|\bcheck (?:out )?(?:the )?(?:revised|updated) target price\b/i, // Indian-market broker target pages, not news about the US company (owner, Nov 2)
  /(?:^|\s)#[A-Za-z0-9_]{3,}\s*$/, // a social-media hashtag glued on the end: promotional text, not a headline (owner, Nov 2)
];
/** Owner, Nov 24 (ハイテク速報「こういうニュースはいらない」): Google News rows from social media and personal newsletters, opinion and
 * prediction mills and consumer how-to blogs, and a link from any feed to GuruFocus, a social-media post or an options-chain page, are not
 * company news. The same lists are GNEWS_DROP_PUBLISHERS and NOISE_URL_PATTERN in scripts/research/company_wire.py, which drops such rows
 * before translation; keep them in step (a test compares them). Publishers are compared like publisher_key there (no case, spaces,
 * punctuation or leading "The"). */
export const NOISE_PUBLISHERS = [
  "The Motley Fool", "Simply Wall St", "Trefis", "TradingKey", "Admirals", "Zacks Investment Research", "InvestorPlace",
  "Insider Monkey", "GuruFocus", "GuruFocus.com",
  "LinkedIn", "X", "X.com", "Twitter", "Facebook", "Instagram", "Threads", "YouTube", "TikTok", "Reddit",
  "Substack", "Medium",
  "24/7 Wall St.", "Kalkine", "Kalkine Media", "kalkine.ca", "kalkine.com", "Blockchain News", "TradingNEWS",
  "Windows Central", "Windows Latest", "Neowin", "How-To Geek", "MakeUseOf", "XDA Developers", "XDA", "Android Authority",
  "Android Police", "Search Engine Roundtable", "Lifehacker", "gHacks", "Laptop Mag", "Tom's Guide", "Pureinfotech",
];
export const NOISE_URL = new RegExp([
  String.raw`^https?://(?:[\w-]+\.)*(?:gurufocus\.com|linkedin\.com|x\.com|twitter\.com|facebook\.com|instagram\.com|threads\.net`,
  String.raw`|tiktok\.com|reddit\.com)(?:[:/?#]|$)`,
  String.raw`|^https?://[^/?#]+/(?:[^?#]*/)?(?:options|option-chain|options-chain|option-chains)(?:[/?#]|$)`,
].join(""), "i");
const publisherKey = (name: string) => name.toLowerCase().replace(/\((?:video|articles)\)/g, "").replace(/^\W*the\s+/, "").replace(/[^a-z0-9]+/g, "");
const NOISE_PUBLISHER_KEYS = new Set(NOISE_PUBLISHERS.map(publisherKey));
/** A row whose outlet or link marks it as not news (above). Only Google News rows are judged by outlet; any row by its link. */
export const noiseSource = (item: Pick<CompanyWireItem, "publisher" | "url" | "source">) =>
  NOISE_URL.test(item.url) || (item.source === "gnews" && NOISE_PUBLISHER_KEYS.has(publisherKey(item.publisher)));

/** A press-release label glued onto the headline ("2026年10月25日｜… ｜NYSE:BE｜プレスリリース") is not part of it (owner, Oct 26). */
export function cleanTitle(title: string) {
  return title.replace(/\s*[(（]\s*[A-Z.]{1,6}\s*[:：]\s*(?:NYSE|NASDAQ|Nasdaq|AMEX|NYSEARCA|OTC)\s*[)）]\s*$/, "").replace(/\s*[(（]\s*(?:NYSE|NASDAQ|Nasdaq(?:GS|GM|CM)?|AMEX|NYSEARCA|NYSEAMERICAN|NYSEAM|NYSEMKT|OTC(?:QX|QB)?)\s*[:：]\s*[A-Z.]{1,6}\s*[)）]/g, "").replace(/^\s*(?:20\d\d年\d{1,2}月\d{1,2}日|[A-Z][a-z]{2,8}\.? \d{1,2}, 20\d\d)\s*[|｜]\s*/, "")
    .replace(/\s*[|｜]\s*(?:NYSE|NASDAQ|Nasdaq(?:GS|GM|CM)?|AMEX)\s*[:：]\s*[A-Z.]{1,6}\s*(?:[|｜]\s*(?:プレスリリース|Press Release))?\s*$/, "")
    .replace(/\s*[|｜]\s*(?:プレスリリース|Press Release)\s*$/, "").replace(/\s*[：:]\s*(?:レポート|報道|report)\s*$/i, "")
    // The wire service's name tacked on the end ("…で上昇（Investing.comより）") is not part of the headline (owner, Oct 28).
    .replace(/\s*[(（]\s*(?:Investing\.com|Reuters|Bloomberg|MarketWatch|Benzinga|Yahoo Finance|Seeking Alpha|The Motley Fool|TipRanks|Barron['’]?s|ロイター|ブルームバーグ|インベスティング[・･]?ドットコム|ヤフー[・･]?ファイナンス|マーケットウォッチ|ベンジンガ|シーキング[・･]?アルファ|モトリーフール|ティップランクス)\s*(?:より|による|報道|via)?\s*[)）]\s*$/i, "")
    // "…の作業を停止：ブルームバーグ" - the outlet after a colon or dash is not part of the headline either (owner, Nov 5).
    .replace(/\s*[：:\-–—|｜]\s*(?:ブルームバーグ|Bloomberg(?:\.com)?|ロイター|Reuters|ウォール[・･]?ストリート[・･]?ジャーナル|WSJ|CNBC|ブルームバーグ・ニュース)\s*(?:報道|より|による)?\s*$/i, "")
    .replace(/\s*[-–—|｜]\s*(?:Investing\.com|Yahoo Finance|MarketWatch|Benzinga|Seeking Alpha|TipRanks)(?:\s*(?:Japan|日本))?\s*$/i, "")
    // A translated outlet name left on the end ("…82万9,255ドル 投資.com報") is not part of the headline either (owner, Nov 5).
    // Investing.com's name comes out as "投資.com"; other outlets are cut only with the "報" that marks the attribution.
    .replace(/\s*[-–—|｜]?\s*(?:投資\.com|投資ドットコム|Investing\.com|インベスティング[・･.]?(?:ドット)?com)\s*(?:報|が報じた|の報道|報道|より)?\s*$/i, "")
    .replace(/\s*[-–—|｜]?\s*(?:ロイター|ブルームバーグ|マーケットウォッチ|ベンジンガ|ヤフー[・･]?ファイナンス|シーキング[・･]?アルファ|モトリーフール|ティップランクス|バロンズ)\s*報\s*$/, "").trim();
}
/** News filed by the market rather than by a company (the Stock News API's general market feed) is stored under MKT (owner, Nov 10). */
export const tickerLabel = (ticker: string, ja: boolean) => ticker === "MKT" ? (ja ? "市場" : "Market") : ticker;
export const isNotNews = (text: string, english = text) => NOT_NEWS.some(pattern => pattern.test(text)) || lowValue(text, english);

/** "X reports third-quarter results" read days after the release is an old story (owner, Oct 26: ASML, 12 days late).
 * Only a headline that announces results is judged, and only against a release date we know for that company. */
const RESULTS_HEADLINE = /\b(?:reports?|announces?|posts?|releases?|delivers?|publishes?)\b.{0,50}\b(?:Q[1-4]|first|second|third|fourth|quarter\w*|fiscal)\b.{0,40}\b(?:results?|earnings)\b|決算(?:を)?発表|決算発表/i;
const STALE_AFTER_MS = 3 * 24 * 3_600_000;
const releaseTimes = new Map<string, number[]>();
for (const event of calendarEvents) if (event.kind === "earnings" && event.ticker) releaseTimes.set(event.ticker, [...(releaseTimes.get(event.ticker) ?? []), Date.parse(event.startsAt)]);
for (const event of dateOnlyEarnings) if (event.ticker) releaseTimes.set(event.ticker, [...(releaseTimes.get(event.ticker) ?? []), Date.parse(`${event.date}T00:00:00Z`)]);
export function staleResults(ticker: string, title: string, publishedAt: string) {
  if (!RESULTS_HEADLINE.test(title)) return false;
  const at = Date.parse(publishedAt);
  const before = (releaseTimes.get(ticker) ?? []).filter(time => time <= at);
  // A release at most three days old, or one we have no date for, is kept.
  return before.length > 0 && at - Math.max(...before) > STALE_AFTER_MS;
}

const STOPWORDS = new Set("the and for with from that this its are was has have will into over after than more new how why what stock stocks shares share inc corp says say said amid about could would just now out up down".split(" "));
const words = (title: string) => new Set((title.toLowerCase().match(/[a-z0-9$.]+/g) ?? []).filter(word => word.length > 2 && !STOPWORDS.has(word)));
const normalized = (title: string) => title.normalize("NFKC").toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, "");
const SAME_STORY = 0.5, WINDOW_MS = 24 * 3_600_000;
function similar(a: Set<string>, b: Set<string>) {
  if (a.size < 3 || b.size < 3) return false;
  let shared = 0;
  for (const word of a) if (b.has(word)) shared++;
  return shared / (a.size + b.size - shared) >= SAME_STORY;
}

// The home screen asks for the same stories on every render (a clock tick, a poll, a page turn): the answer for the same
// feed object, language and company set is kept, so the screen does the filtering and grouping once (owner, Oct 28: slow home).
const memo = new WeakMap<object, Map<string, WireStory[]>>();
const watchedIds = new WeakMap<object, number>();
let watchedCounter = 0;
export function wireStories(wire: Record<string, CompanyWireItem[]>, lang: Language, watched?: ReadonlySet<string>): WireStory[] {
  let byFeed = memo.get(wire);
  if (!byFeed) { byFeed = new Map(); memo.set(wire, byFeed); }
  let watchedId = 0;
  if (watched) { watchedId = watchedIds.get(watched) ?? ++watchedCounter; watchedIds.set(watched, watchedId); }
  const key = `${lang}:${watchedId}:${watched?.size ?? -1}`;
  let stories = byFeed.get(key);
  if (!stories) { stories = buildWireStories(wire, lang, watched); byFeed.set(key, stories); }
  return stories;
}

/** One company headline that may be shown: its ticker, the row and its title in the page's language (cleaned), oldest first.
 * Headlines that are not news, or stale results, are left out. Shared by the story grouping below and the topics page. */
export type StoryCandidate = { ticker: string; item: CompanyWireItem; title: string };
export function storyCandidates(wire: Record<string, CompanyWireItem[]>, lang: Language, watched?: ReadonlySet<string>): StoryCandidate[] {
  const ja = lang === "ja";
  return Object.entries(wire).flatMap(([ticker, list]) => watched && !watched.has(ticker) ? [] : list.flatMap(item => {
    const title = ja ? (item.titleJa && tidyJapanese(cleanTitle(item.titleJa))) : cleanTitle(item.titleEn);
    return title && !noiseSource(item) && !isNotNews(item.titleEn) && !isNotNews(title, item.titleEn) && !staleResults(ticker, item.titleEn, item.publishedAt) && !staleResults(ticker, title, item.publishedAt) ? [{ ticker, item, title }] : [];
  })).sort((a, b) => Date.parse(a.item.publishedAt) - Date.parse(b.item.publishedAt));
}
/** One broker's action named in a headline (owner, Nov 20: 「MRVLは同じの2つある」 — "Stifel maintains Marvell Technology at Buy, lowers price
 * target to $280 from $370" and "Stifel cuts Marvell stock price target on deal concerns to $280" are one action): the broker and its new
 * price target, or its new rating, else null. The same rule is analyst_action in scripts/research/company_wire.py, which translates only
 * the first copy. */
const BROKER = new RegExp(String.raw`\b(Stifel|Morgan Stanley|Goldman(?: Sachs)?|J\.?P\.? ?Morgan|BofA(?: Securities)?|Bank of America|Citi(?:group)?|Wells Fargo|Barclays|UBS`
  + String.raw`|Deutsche Bank|Jefferies|Bernstein|Evercore(?: ISI)?|Mizuho|Needham|Piper Sandler|Raymond James|KeyBanc|Truist|Oppenheimer`
  + String.raw`|Cantor(?: Fitzgerald)?|Wedbush|TD Cowen|Cowen|Baird|BMO(?: Capital)?|RBC(?: Capital)?|Rosenblatt|Benchmark|Loop Capital|Melius`
  + String.raw`|HSBC|Macquarie|Nomura|Susquehanna|Wolfe(?: Research)?|Northland|Craig-Hallum|Roth(?: Capital| MKM)?|Canaccord(?: Genuity)?`
  + String.raw`|D\.?A\.? Davidson|B\.? Riley|Guggenheim|Seaport|Arete|New Street|Redburn|CLSA|Daiwa|BNP Paribas|Exane|Argus|CFRA|KGI`
  + String.raw`|Citizens JMP|JMP|Lake Street|Ladenburg|H\.?C\.? Wainwright|Telsey|Summit Insights|Tigress|Morningstar)\b`);
const BROKER_ALIASES: Record<string, string> = { bankofamerica: "bofa", bofasecurities: "bofa", goldmansachs: "goldman", citigroup: "citi", evercoreisi: "evercore",
  cantorfitzgerald: "cantor", bmocapital: "bmo", rbccapital: "rbc", tdcowen: "cowen", wolferesearch: "wolfe", rothcapital: "roth", rothmkm: "roth",
  canaccordgenuity: "canaccord", citizensjmp: "jmp" };
const TARGET_WORDS = /\b(?:price target|target price|price objective|PT)\b/i;
const NEW_TARGET = /\bto \$\s?(\d[\d,]*(?:\.\d+)?)/;
const ANY_TARGET = /(?<!from )\$\s?(\d[\d,]*(?:\.\d+)?)(?![.,]?\d)(?!\s?(?:billion|million|trillion|bn|m|b|t)\b)/i;
const RATING_CHANGE = /\b(?:upgrade[sd]?|downgrade[sd]?|initiate[sd]?|start(?:s|ed)?|resume[sd]?|reinstate[sd]?)\b.{0,80}?\b(?:to|at|with)\s+(?:an? )?(strong buy|buy|outperform|overweight|accumulate|add|neutral|hold|equal[- ]weight|market perform|sector perform|peer perform|in[- ]line|underperform|underweight|reduce|sell)\b/i;
export function analystActions(title: string): string[] {
  const broker = BROKER.exec(title ?? "");
  if (!broker) return [];
  const plain = broker[1].toLowerCase().replace(/[^a-z0-9]/g, "");
  const firm = BROKER_ALIASES[plain] ?? plain;
  const keys: string[] = [];
  if (TARGET_WORDS.test(title)) {
    const value = NEW_TARGET.exec(title) ?? ANY_TARGET.exec(title);
    if (value) keys.push(`${firm}|pt|${Number(value[1].replace(/,/g, ""))}`);
  }
  const rating = RATING_CHANGE.exec(title);
  if (rating) keys.push(`${firm}|rating|${rating[1].toLowerCase().replace(/[- ]/g, "")}`);
  return keys;
}

/** The grouping rule of the stories: the same headline, or English headlines sharing half their words, within 24 hours. */
export const storyKey = normalized;
export const storyWords = words;
export const similarStory = similar;
export const STORY_WINDOW_MS = WINDOW_MS;

function buildWireStories(wire: Record<string, CompanyWireItem[]>, lang: Language, watched?: ReadonlySet<string>): WireStory[] {
  const ja = lang === "ja";
  const items = storyCandidates(wire, lang, watched);
  type Cluster = { key: string; words: Set<string>; first: number; tickers: string[]; best: (typeof items)[number]; actions: Set<string> };
  const clusters: Cluster[] = [];
  for (const entry of items) {
    const at = Date.parse(entry.item.publishedAt), key = normalized(entry.title), tokens = words(entry.item.titleEn);
    // The same broker action for the same company from another outlet joins the first report (owner, Nov 20).
    const actions = analystActions(entry.item.titleEn).map(found => `${entry.ticker}|${found}`);
    // Two broker actions that read alike ("Stifel cuts Marvell price target to $280" / "Needham cuts …") are two stories.
    const plain = new Set(actions.map(action => action.slice(action.indexOf("|") + 1)));
    const otherAction = (c: Cluster) => plain.size > 0 && c.actions.size > 0 && ![...c.actions].some(action => plain.has(action.slice(action.indexOf("|") + 1)));
    const cluster = clusters.find(c => at - c.first <= WINDOW_MS && (actions.some(action => c.actions.has(action)) || ((c.key === key || similar(c.words, tokens)) && !otherAction(c))));
    if (!cluster) { clusters.push({ key, words: tokens, first: at, tickers: [entry.ticker], best: entry, actions: new Set(actions) }); continue; }
    for (const action of actions) cluster.actions.add(action);
    if (!cluster.tickers.includes(entry.ticker)) cluster.tickers.push(entry.ticker);
    // The company's own wire text wins over a third party's rewording of it.
    if (entry.item.origin === "wire" && cluster.best.item.origin !== "wire") cluster.best = entry;
  }
  return clusters.map(({ tickers, best, first }) => ({
    id: best.item.id, tickers: [...tickers].sort(), title: best.title, url: best.item.url, publisher: best.item.publisher,
    origin: best.item.origin, at: new Date(first).toISOString(), short: ja ? best.item.shortJa ?? undefined : undefined,
    ...(best.item.sentiment ? { sentiment: best.item.sentiment } : {}),
  })).sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
}
