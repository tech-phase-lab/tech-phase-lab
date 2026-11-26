/** A contributor's own rating call is an opinion piece, not news (owner, Nov 26: 銘柄手帳 and 速報 showed the NBIS row
 * 「ネビウスの設備投資は誤解されていたので買いだ」, from the Seeking Alpha contributor article "Nebius' CapEx Was Misread, So I'm Buying").
 * Matched: a rating tag ending the headline (": Buy", ": Strong Buy", ": Sell", ": Strong Sell", ": Hold", ": Upgrade To Buy"),
 * "(Rating Upgrade)" / "(Rating Downgrade)" / "(Double Upgrade)" tags, "… Is A Strong Buy", "I Think It's a Buy", and the author's first-person
 * buying, selling or stance ("So I'm Buying", "Why I Sold", "Why I'm Extremely Bullish").
 * A ticker tag ("(NASDAQ:NBIS)", "(NBIS)") or " - Seeking Alpha" may follow. A brokerage's rating or price-target change is news and is kept:
 * the caller skips any headline that names a known broker (BROKER in wire-stories.ts). CONTRIBUTOR_OPINION_EN is
 * CONTRIBUTOR_OPINION_EN in scripts/research/company_wire.py, which drops such headlines before translation; keep the two in step (a test
 * compares them). */
export const CONTRIBUTOR_OPINION_EN = new RegExp([
  String.raw`(?::\s*(?:(?:upgrad(?:e|ed|ing)|downgrad(?:e|ed|ing)|reiterat(?:e|ed|ing)|maintain(?:ed|ing)?)\s+(?:to\s+|at\s+|as\s+)?(?:an?\s+)?)?`,
  String.raw`(?:(?:strong|speculative)\s+)?(?:buy|sell|hold)(?:\s+rating)?\s*[.!]?`,
  String.raw`|\((?:rating\s+|double\s+)?(?:upgrade|downgrade|reiteration|reiterated)\))`,
  String.raw`\s*(?:\((?:(?:NASDAQ|NYSE|NYSEARCA|NYSEAMERICAN|AMEX|OTC[A-Z]*|TSX|TSXV|LSE)\s*:\s*)?[A-Z.]{1,8}\)\s*)?(?:[-–—|]\s*Seeking Alpha\s*)?$`,
  String.raw`|(?:^|[,;:.!]\s+|\b(?:so|and|but|why|how)\s+)I.m\s+(?:(?:still|now|also|finally|happily|aggressively|cautiously|not|done|\w+ly)\s+)?`,
  String.raw`(?:buying|selling|adding|accumulating|loading up|doubling down|a buyer|a seller|staying long|staying away|bullish|bearish)\b`,
  String.raw`|(?:^|\b(?:why|so|and|but)\s+)I\s+(?:just\s+|finally\s+)?(?:bought|sold|added|doubled down)\b`,
  String.raw`|\bI (?:think|believe) (?:it.s|it is|this is|they.re|they are) an? (?:strong )?(?:buy|sell)\b|\bis an? strong (?:buy|sell)\b`,
].join(""), "i");
