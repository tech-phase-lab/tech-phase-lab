"""Bound literal token-price denominators; never invent free-standing numbers."""
from decimal import Decimal
import re

NUMBER = r'[+\-−]?\d+(?:,\d{3})*(?:\.\d+)?'
EN_BASIS = re.compile(
    r'\b(?:per|each)\s+(?:(?P<count>' + NUMBER + r'|one)\s*)?'
    r'(?P<scale>million\b|M\b)\s+(?P<cached>cached\s+)?'
    r'(?P<role>input|output)\b(?:\s+(?P<unit>tokens?|characters?|requests?)\b)?', re.I)
JA_BASIS = re.compile(
    r'(?P<cached>キャッシュ(?:済み|された)?\s*)?(?P<role>入力|出力)\s*'
    r'(?P<before_tokens>トークン\s*)?(?P<count>' + NUMBER + r')\s*'
    r'(?P<scale>万|million\b|M\b)?\s*(?P<after_tokens>トークン\s*)?'
    r'(?:あたり|当たり|につき)', re.I)
PREFIX_PRICE = re.compile(r'(?P<currency>[$€£¥])\s*(?P<price>' + NUMBER + r')\s*$')
SUFFIX_PRICE = re.compile(r'^\s*(?:は\s*)?(?:(?P<prefix>[$€£¥])\s*(?P<first>' + NUMBER +
                          r')|(?P<last>' + NUMBER + r')\s*(?P<suffix>ドル|ユーロ|ポンド|円))')
CURRENCIES = {'$': 'dollar', 'ドル': 'dollar', '€': 'euro', 'ユーロ': 'euro',
              '£': 'pound', 'ポンド': 'pound', '¥': 'yen', '円': 'yen'}
PHASE = re.compile(r'(?P<negated>\b(?:not (?:an? |the )?|non[- ])introductory pric(?:es?|ing)|導入価格では(?:ない|なく|ありません))'
                   r'|(?P<after>after (?:the )?introductory (?:period(?: expires)?|pric(?:e|ing))|post[- ]introductory (?:price|pricing)|導入(?:期間|価格)終了後)'
                   r'|(?P<intro>introductory (?:price|pricing)|導入価格)', re.I)


def decimal(value):
    return Decimal(value.replace(',', '').replace('−', '-'))


def bases(text):
    result = []
    for pattern in (EN_BASIS, JA_BASIS):
        for match in pattern.finditer(text):
            if pattern is JA_BASIS and not (match['before_tokens'] or match['after_tokens']):
                continue
            count = match['count'] or 'one'
            count = Decimal(1) if count.lower() == 'one' else decimal(count)
            scale = (match['scale'] or '').lower()
            count *= 10000 if scale == '万' else 1000000 if scale in {'m', 'million'} else 1
            role = {'入力': 'input', '出力': 'output'}.get(match['role'].lower(), match['role'].lower())
            if pattern is EN_BASIS and (match['unit'] or '').lower() not in {'token', 'tokens'}:
                role += '-' + ((match['unit'] or 'untyped').lower().rstrip('s'))
            if match['cached']:
                role = 'cached-' + role
            result.append((match, count, role))
    return sorted(result, key=lambda item: item[0].start())


def token_denominators(text):
    """Return masked prose and typed quantities for only explicit token bases."""
    remaining, values = list(text), []
    for match, count, role in bases(text):
        if role not in {'input', 'output', 'cached-input', 'cached-output'}:
            continue  # Unknown unit relations can reject prices but never admit a number.
        values.append((count, 'per-' + role + '-tokens'))
        remaining[match.start():match.end()] = ' ' * (match.end() - match.start())
    return ''.join(remaining), values


def price_phase(text, offset):
    # Paragraph breaks/footnote markers can sit between an introductory-price
    # label and its values. A completed sentence cannot lend that label onward.
    before = re.split(r'[.!?。！？;；](?=\s|$)|[。！？;；]', text[:offset])[-1][-300:]
    matches = list(PHASE.finditer(before))
    if not matches:
        return 'unspecified'
    return ('non-introductory' if matches[-1]['negated'] else
            'post-introductory' if matches[-1]['after'] else 'introductory')


def parsed_token_prices(text):
    """Tie each parsed price to its role, base, currency and phase."""
    result, unmatched = set(), []
    for match, count, role in bases(text):
        price = (PREFIX_PRICE.search(text[max(0, match.start() - 40):match.start()])
                 if match.re is EN_BASIS else SUFFIX_PRICE.match(text[match.end():match.end() + 40]))
        if not price:
            unmatched.append((match.start(), match.end()))
            continue
        if match.re is EN_BASIS:
            currency, value = price['currency'], price['price']
        else:
            currency, value = price['prefix'] or price['suffix'], price['first'] or price['last']
        result.add((role, count, CURRENCIES[currency], decimal(value), price_phase(text, match.start())))
    return result, unmatched


def token_prices(text):
    return parsed_token_prices(text)[0]


def validate_token_prices(text, evidence):
    # This is intentionally a literal bounded grammar. Prices omitted from a
    # summary are fine; a retained price may not borrow another role, currency,
    # denominator or introductory phase from elsewhere in the evidence.
    actual, unmatched = parsed_token_prices(text)
    # An unparsed price is not an empty, therefore valid, price set. Keep
    # alternate currency/connector wording fail-closed instead of allowing
    # its numerator to borrow a globally matching number from another rate.
    money = re.search(r'[$€£¥]|\b(?:USD|EUR|GBP|JPY|dollars?|euros?|pounds?|yen)\b|ドル|ユーロ|ポンド|円', text, re.I)
    expected = token_prices(evidence)
    if (unmatched and (money or expected)) or not actual.issubset(expected):
        raise ValueError('unsupported-number')
