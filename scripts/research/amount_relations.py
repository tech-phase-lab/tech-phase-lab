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
        raise ValueError('changed-amount-relation')
