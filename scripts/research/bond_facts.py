"""Preserve explicit bond metric and temporal roles, not just matching digits.

A ten-year return window is not the maturity of a ten-year bond. These are
conservative literal checks, not a claim of general translation verification.
"""
from collections import Counter
import re

BOND = re.compile(r'\b(?:Treasur(?:y|ies)|government bonds?|sovereign bonds?|JGBs?|bunds?|gilts?)\b|国債', re.I)
NUMBER = r'(?<![\d.])(\d+(?:\.\d+)?)'
YEAR = NUMBER + r'\s*[-‐‑– ]?\s*years?\b'
MATURITY_NOUN = r'(?:(?:U\.?S\.?|Japanese?|German|British)\s+)?(?:Treasur(?:y|ies)|(?:government |sovereign )?bonds?|notes?|bills?|yields?)\b'


def temporal_roles(text):
    roles = Counter()
    patterns = {
        'maturity': (
            YEAR + r'\s+' + MATURITY_NOUN,
            NUMBER + r'年(?:物|債)',
            # 「10年国債」「10年米国債」: the same maturity, common in Japanese copy.
            NUMBER + r'年(?:米|日本|独|英)?国債',
        ),
        'window': (
            YEAR + r'\s+(?:rolling\s+)?(?:periods?|returns?|performance|stretches?|windows?)\b',
            r'\breturns?\s+(?:over|during|for)\s+(?:the\s+)?(?:(?:past|last|preceding|previous)\s+)?' + NUMBER + r'\s+years?\b',
            NUMBER + r'年間',
            NUMBER + r'年(?:の)?(?:ローリング)?(?:リターン|収益率|騰落率|期間)',
        ),
        'lookback': (
            r'\b(?:in|past|last|over)\s+(?:(?:the|over|past|last)\s+)*' + NUMBER + r'\s+years?\b',
            r'(?:過去|直近)' + NUMBER + r'年(?!間)',
            NUMBER + r'年(?:以上)?ぶり',
        ),
        'since': (
            r'\bsince\s+' + NUMBER + r'\b',
            NUMBER + r'年以(?:来|降)',
        ),
    }
    occupied = []
    for role, expressions in patterns.items():
        for expression in expressions:
            for match in re.finditer(expression, text, re.I):
                # The same phrase can match both "over 10 years" and "10年間";
                # classify each visible relationship once in precedence order.
                span = match.span(1)
                if any(start < span[1] and span[0] < end for start, end in occupied):
                    continue
                occupied.append(span)
                roles[(role, match[1])] += 1
    return roles


def metrics(text):
    found = set()
    for name, pattern in (
        ('yield', r'\byields?\b|利回り'),
        ('price', r'\bprices?\b|価格|債券価格'),
        ('return', r'\breturns?\b|リターン|収益率|騰落率'),
        ('total-return', r'\btotal[- ]returns?\b|トータルリターン|総収益'),
        ('real-return', r'\breal\s+returns?\b|inflation[- ]adjusted|実質リターン|インフレ調整'),
        ('annualized', r'\bannuali[sz](?:ed|ation)\b|年率(?:換算)?'),
        ('rolling', r'\brolling\b|ローリング'),
        ('nominal', r'\bnominal\b|名目'),
    ):
        if re.search(pattern, text, re.I):
            found.add(name)
    return found


def forecast(text):
    # May is also a month. Only discard explicit calendar contexts, keeping
    # modal "may suffer/rise/..." available to the conservative qualifier check.
    text = re.sub(r'\b(?:in|on|during|through|before|after|until|since|by|from)\s+May\b', '', text)
    text = re.sub(r'\bMay(?=\s+\d)', '', text)
    return bool(re.search(
        r'\b(?:on track|poised|set to|expected|forecast|will|would|likely|projected|anticipated|may|might|could)\b'
        r'|見通し|予想|予測|可能性|ペース|予定', text, re.I))


def validate(text, original):
    if not BOND.search(original):
        return
    if temporal_roles(text) != temporal_roles(original) or metrics(text) != metrics(original):
        raise ValueError('invalid-copy')
    if forecast(text) != forecast(original):
        raise ValueError('invalid-copy')
    for pattern in (
        r'\b(?:worst)\b|最悪', r'\b(?:best)\b|最良|最高の成績',
        r'\b(?:in history|ever|on record|all[- ]time)\b|史上|過去最|観測史上',
    ):
        if bool(re.search(pattern, text, re.I)) != bool(re.search(pattern, original, re.I)):
            raise ValueError('invalid-copy')
