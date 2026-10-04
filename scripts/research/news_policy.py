"""Editorial eligibility for public company updates; acquisition stays private."""
import re

PROMOTION = re.compile(
    r'\b(?:webinars?|workshops?|courses?|bootcamps?|masterclasses?|tutorials?|'
    r'hiring|careers?|job openings?|giveaways?)\b|'
    r'\b(?:join us|register (?:now|today|here)|sign up (?:now|today|here))\b|'
    r'講座|セミナー|ウェビナー|参加登録|採用募集|受講', re.I)
# A sales pitch mentioning a partner is not a corporate partnership announcement.
MATERIAL = re.compile(
    r'\b(?:quarterly (?:results|earnings)|financial results|earnings results|'
    r'acquisition|acquires?|merger|revenue guidance|capital expenditure|'
    r'capacity expansion|data cent(?:er|re) expansion)\b|決算|買収|売上高|設備投資', re.I)
CTA = re.compile(
    r'\b(?:sign up|register (?:now|today|here)|learn more|find out more|'
    r'read more|click here|apply (?:now|here)|join us)\b|'
    r'申[込し]込み?は?こちら|申し込みはこちら|詳細はこちら|登録はこちら|詳しくはこちら', re.I)
URL = re.compile(r'https?://\S+', re.I)


def eligible(title):
    if not title.strip():
        return False
    promotion = PROMOTION.search(title)
    material = MATERIAL.search(title)
    return not promotion or bool(material and material.start() < promotion.start())


def headline(title):
    """Remove promotional tails and raw URLs without changing reported facts."""
    title = CTA.split(title, maxsplit=1)[0]
    title = URL.sub('', title)
    return ' '.join(title.split()).strip(' .。:：;；-–—')
