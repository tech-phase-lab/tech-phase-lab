"""Bind monetary increments and resulting totals to the exact signed amount.

Literal equality alone cannot justify translating an increase *by* an amount
as an increase *to* that amount. This bounded bilingual check never calculates
an unstated total or infers transaction completion.
"""
import re
from decimal import Decimal

NUMBER = r'[+＋\-−]?\s*\d+(?:,\d{3})*(?:\.\d+)?'
SCALE = r'(?:trillion|billion|million|thousand|bn|[KMBT]|兆|億|万|千)'
MONEY = re.compile(
    r'(?<![A-Za-z0-9.,])(?:[+＋\-−]?\s*(?:US\$|\$|USD|EUR|€|GBP|£|JPY|¥)\s*'
    + NUMBER + r'\s*(?:' + SCALE + r'(?![A-Za-z]))?'
    r'|' + NUMBER + r'\s*(?:' + SCALE + r')?\s*(?:米ドル|ドル|円|ユーロ|ポンド))', re.I)
SCALES = {'thousand': 1000, 'k': 1000, '千': 1000, 'million': 10**6,
          'm': 10**6, '万': 10**4, 'billion': 10**9, 'bn': 10**9,
          'b': 10**9, '億': 10**8, 'trillion': 10**12, 't': 10**12, '兆': 10**12}


def money_value(value):
    currency = ('USD' if re.search(r'US\$|\$|USD|ドル', value, re.I) else
                'EUR' if re.search(r'EUR|€|ユーロ', value, re.I) else
                'GBP' if re.search(r'GBP|£|ポンド', value, re.I) else 'JPY')
    digits = re.search(r'\d+(?:,\d{3})*(?:\.\d+)?', value)
    unit = re.match(r'\s*(' + SCALE + r')', value[digits.end():], re.I)
    number = Decimal(digits[0].replace(',', '')) * SCALES.get(unit[1].lower() if unit else '', 1)
    if re.search(r'[\-−]', value[:digits.start()]):
        number = -number
    return currency, number


def cumulative_award_claims(text, *, explicit=False):
    """Find a narrow implicit aggregate, only used for an explicit source total.

    The same clause must start with a since-year and contain a completed award
    predicate followed by the amount and award noun. Never infer totals for
    authorizations, future budgets, increments, periodic rates or negated acts.
    """
    result = set()
    matches = list(MONEY.finditer(text))
    action = (r"^\s*since\s+(?P<year>(?:19|20)\d{2})\s*,?\s+"
              r"(?P<actor>(?:[\w’'-]+\s+){1,12})(?:has|have)\s+"
              r"(?P<verb>provided|awarded|disbursed|donated)\s*$")
    separator = r'(?:,\s*(?:and\s+)?|\s+and\s+)'
    subject = r'(?-i:[A-Z][A-Za-z-]*(?:\s+[A-Z][A-Za-z-]*)*)'
    subjects = subject + r'(?:' + separator + subject + r'){0,7}'
    recipient = (r'(?:\s+to\s+(?:(?:more\s+than|over)\s+)?\d+(?:,\d{3})*\s+'
                 r'(?:beneficiaries|students|recipients)'
                 r'(?:\s+pursuing\s+(?:Bachelor[’\']s|Master[’\']s|doctoral|undergraduate|graduate)'
                 r'\s+degrees?\s+in\s+' + subjects + r')?)?')
    cost = r'(?:tuition|living\s+expenses|accommodation|textbooks|monthly\s+stipends)'
    covering = r'(?:,\s+covering\s+' + cost + r'(?:' + separator + cost + r'){0,7})?'
    award = (r'\s+(?:in\s+)?(?P<award>bursaries|scholarships|grants|financial\s+aid)'
             + recipient + covering + r'[.]?\s*')
    kinds = {'bursaries': 'scholarship', 'scholarships': 'scholarship',
             'grants': 'grant', 'financial aid': 'financial-aid'}
    blocked_actor = r'\b(?:no|not|never|neither|without|has|have|had|is|was|and|but|while|or|nor|then)\b'
    excluded = (r'\b(?:per|each|every|annual(?:ly)?|yearly|quarterly|monthly|weekly|daily|'
                r'additional|another|extra|remaining|planned|budgeted|will|not|never|no|scheduled|intended|future)\b'
                r'|\bto\s+be\s+(?:paid|provided|awarded|disbursed)\b'
                r'|\b(?:a|an)\s+(?:year|month|week|day)\b')
    def actor_name(value):
        name = ' '.join(value.lower().split())
        return 'company-reference' if name in {'the company', 'company', '会社', '同社'} else name

    def named_actor(value):
        return (actor_name(value) == 'company-reference'
                or re.fullmatch(r"[A-Z][A-Za-z0-9’'.-]*(?:\s+[A-Z][A-Za-z0-9’'.-]*){0,7}", value.strip()))

    for index, match in enumerate(matches):
        before = text[max(matches[index-1].end() if index else 0, match.start()-300):match.start()]
        before = re.split(r'(?<=[.!?])\s+|[;；。\n]', before)[-1]
        # Keep the entire clause for exclusions: an annual qualifier after a
        # second coordinated amount also disqualifies the first amount.
        after = re.split(r'(?<=[.!?])\s+|[;；。\n]', text[match.end():])[0]
        completed = re.search(action, before, re.I)
        if not explicit:
            awarded = re.fullmatch(award, after, re.I)
            if (completed and not re.search(blocked_actor, completed['actor'], re.I)
                    and named_actor(completed['actor'])
                    and awarded and not re.search(excluded, after, re.I)):
                kind = kinds[' '.join(awarded['award'].lower().split())]
                result.add((*money_value(match[0]), completed['year'], kind, completed['verb'].lower(),
                            actor_name(completed['actor'])))
            continue
        # An explicit total alone is insufficient evidence: bind this amount
        # to completed awards and the same since-year, excluding plans, rates,
        # negation, remaining budgets and dates in neighboring sentences.
        source_action = re.search(
            r'\b(?:has|have)\s+(?P<verb>provided|awarded|disbursed|donated)\s+'
            r'(?:comprehensive\s+)?(?P<award>bursaries|scholarships|grants|financial\s+aid)'
            r'\s+(?:totaling|totalling)\s*$', before, re.I)
        if source_action and not re.search(excluded, before + ' ' + after, re.I):
            years = re.findall(r'\bsince\s+((?:19|20)\d{2})\b', before + ' ' + after, re.I)
            starts = re.match(r'^\s*since\s+((?:19|20)\d{2})\s*,?\s+', before, re.I)
            ends = re.fullmatch(recipient + r'\s+since\s+((?:19|20)\d{2})'
                                r'(?:\s+to\s+date)?[.]?\s*', after, re.I)
            prefix = before[:source_action.start()]
            actor = re.sub(r'^\s*since\s+(?:19|20)\d{2}\s*,?\s+', '', prefix, flags=re.I)
            actor = re.sub(r'^\s*Through its(?:\s+[A-Z][A-Za-z-]*){1,7},\s*', '', actor)
            source_tail = re.fullmatch(recipient + covering + r'[.]?\s*', after, re.I)
            if (len(years) == 1 and ((starts and source_tail) or ends)
                    and named_actor(actor)
                    and not re.search(r'\b(?:while|but|or|nor|not|no|has|have|had|was|were)\b', prefix, re.I)
                    and not re.search(r'\b(?:who|which|that|has|have|had|will)\b', after, re.I)):
                kind = kinds[' '.join(source_action['award'].lower().split())]
                result.add((*money_value(match[0]), years[0], kind, source_action['verb'].lower(), actor_name(actor)))
        japanese_period = re.fullmatch(
            r'\s*(?P<actor>[^、。;]+?)は(?P<year>(?:19|20)\d{2})年以降[、,]'
            r'(?:(?:[ァ-ヶー一-龯や]+の学士課程)?学生\d+(?:名|人)(?:超|以上)?に)?'
            r'(?:合計|総額)\s*', before)
        japanese_action = re.fullmatch(
            r'\s*(?:の)?奨学金を(?P<verb>提供|授与|支給)'
            r'(?:した|している|してきた|し、(?:学費|生活費|授業料|住居費|教材費)'
            r'(?:(?:や|と|、)(?:学費|生活費|授業料|住居費|教材費)){0,4}'
            r'の負担軽減を支援している)[。]?\s*', after)
        if (japanese_period
                and japanese_action
                and not re.search(r'予定|計画|見込|予算|追加|残|毎年|年間|年当たり|していない|しなかった', before + after)):
            verb = {'提供': 'provided', '授与': 'awarded', '支給': 'disbursed'}[japanese_action['verb']]
            result.add((*money_value(match[0]), japanese_period['year'], 'scholarship', verb,
                        actor_name(japanese_period['actor'])))
    return result


def monetary_relations(text):
    matches = list(MONEY.finditer(text))
    result = set()
    for index, match in enumerate(matches):
        before = text[max(matches[index-1].end() if index else 0, match.start()-120):match.start()]
        after = text[match.end():min(matches[index+1].start() if index+1 < len(matches) else len(text), match.end()+110)]
        # Relation words stay in this clause, and cannot jump another amount.
        before = re.split(r'[;；。\n]|,\s+(?=[A-Za-z])', before)[-1]
        after = re.split(r'[;；。\n]|,\s+(?=[A-Za-z])', after)[0]
        role = None
        # These local noun phrases still describe an increment, even when
        # 'additional' follows the amount. An explicit remaining/total qualifier
        # cannot borrow that increment sense from a neighboring phrase.
        local_increment = bool(
            re.search(r'追加(?:の)?(?:(?:自社株買い|買い戻し|承認|取得))?枠\s*$', before)
            or re.match(r'\s+(?:in|of)\s+additional\s+(?:(?:share|stock)\s+)?'
                        r'(?:buyback|repurchase)\s+(?:authority|authorization)\b', after, re.I))
        local_increment = local_increment and not re.search(
            r'\b(?:total|remaining|balance)\b|総額|合計|残り|残る|残額', before, re.I)
        if (local_increment or re.search(r'\b(?:additional|another)\s*$', before, re.I)
                or re.search(r'\b(?:increas\w*|rais\w*|expand\w*|boost\w*)\b[^;。]{0,65}\bby\s*$', before, re.I)
                or re.match(r'\s*(?:の)?(?:追加|増額|上積み|増加)', after)
                or re.match(r'\s*(?:を|分)?(?:追加|増額|上積み|増加)', after)
                or re.match(r'\s*(?:(?:share|stock)\s+repurchase\s+)?(?:authorization\s+)?increase\b', after, re.I)):
            role = 'increment'
        elif (re.search(r'\b(?:totals?|totaling|totalling)\s*$', before, re.I)
                or re.search(r'\b(?:increas\w*|rais\w*|expand\w*|boost\w*|bringing)\b[^;。]{0,85}\bto\s*$', before, re.I)
                or re.search(r'\b(?:total|remaining|balance)\b[^;。]{0,45}(?:to|of|is)\s*$', before, re.I)
                or re.match(r'\s*(?:に|へ)(?:拡大|増額|引き上げ|増加)', after)
                or re.match(r'\s+(?:(?:of|in)\s+)?(?:remaining\s+(?:capacity|authorization)|authorization\s+remaining)\b', after, re.I)
                or re.search(r'(?:総額|合計|残り|残る|残額)[^、。;；]{0,20}?(?:は|を|が)?\s*$', before)):
            role = 'total'
        if role:
            result.add((*money_value(match[0]), role))
    return result


def validate_amount_relations(text, evidence):
    original = monetary_relations(evidence)
    if not original:
        return
    output_amounts = {money_value(match[0]) for match in MONEY.finditer(text)}
    for currency, number in output_amounts:
        source_currencies = {c for c, value, _ in original if value == number}
        if source_currencies and currency not in source_currencies:
            raise ValueError('changed-amount-relation')
    required = {relation for relation in original if relation[:2] in output_amounts}
    actual = {relation for relation in monetary_relations(text) if relation[:2] in {r[:2] for r in required}}
    if actual != required:
        # This fallback cannot create a new source requirement or override an
        # explicit increment/remaining role. It recognizes a completed awards
        # aggregate only when this same amount is already an explicit total in
        # the selected evidence (or in the other language of the same pair).
        classified = {relation[:2] for relation in actual}
        proven = cumulative_award_claims(evidence, explicit=True)
        actual |= {(currency, number, 'total')
                   for currency, number, year, kind, verb, actor in cumulative_award_claims(text)
                   if any(source[:5] == (currency, number, year, kind, verb)
                          and (source[5] == actor or 'company-reference' in (source[5], actor))
                          for source in proven)
                   and (currency, number, 'total') in required
                   and (currency, number) not in classified}
    if actual != required:
        raise ValueError('changed-amount-relation')
