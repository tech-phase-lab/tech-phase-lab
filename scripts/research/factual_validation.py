"""Deterministic checks for literal numbers and explicit transaction status.

These checks reject known contradictions; they do not prove semantic accuracy.
"""
import re
from decimal import Decimal
from collections import Counter


def numbers(text):
    return re.findall(r'\d+(?:[.,]\d+)*', text)


def signed_numbers(text):
    values=[]
    pattern=r'(?P<before>[+＋\-−]?)\s*(?:[$€£¥]\s*)?(?P<after>[+＋\-−]?)\s*(?P<number>\d+(?:,\d{3})*(?:\.\d+)?)'
    for match in re.finditer(pattern,text):
        before, after=match['before'],match['after']
        if before and match.start()>0 and text[match.start()-1].isalnum():
            before=''  # A product identifier such as MI-450 is not a negative value.
        sign=after or before
        prefix=text[:match.start()].rstrip()
        suffix=text[match.end():].lstrip()
        accounting=prefix.endswith('(') and suffix.startswith(')')
        value=Decimal(match['number'].replace(',',''))
        if sign in ('-','−') or accounting:
            value=-value
        values.append(value)
    return values


def validate_numbers(text, evidence):
    # Whole values and signs: +32 is not -32, and 5 is not 15 or 500.
    if not set(signed_numbers(text)).issubset(set(signed_numbers(evidence))):
        raise ValueError('unsupported-number')
    for match in re.finditer(r'(\d+(?:[.,]\d+)*)\s*(million\b|billion\b|trillion\b|%|percent\b)', text, re.I):
        number, unit = match.groups()
        unit_pattern = r'(?:%|percent)' if unit.lower() in ('%', 'percent') else re.escape(unit)
        if not re.search(r'(?<![\d.,])' + re.escape(number) + r'(?![\d.,])\s*' + unit_pattern, evidence, re.I):
            raise ValueError('unsupported-number')


def planned_acquisition(text):
    return bool(re.search(r'\bto acquire\b|\b(?:planned|proposed|pending) acquisition\b|\bacquisition agreement\b', text, re.I))


def validate_acquisition(text, source, language, require_status=False):
    if not planned_acquisition(source):
        return
    completed = (r'買収(?:済み?|を完了|が完了|した|しました)|買収完了' if language == 'ja'
                 else r'\bacquired\b|\bcompleted\b.{0,50}\bacquisition\b|\bacquisition\b.{0,50}\bcompleted\b')
    if re.search(completed, text, re.I):
        raise ValueError('invalid-copy')
    planned = (r'計画|予定|契約|合意|買収へ|買収する方針' if language == 'ja'
               else r'\bto acquire\b|agreement|plans?|intends?|will acquire|proposed|pending')
    if require_status and not re.search(planned, text, re.I):
        raise ValueError('invalid-copy')


SEMANTIC_POLARITIES = (
    (r'\b(?:increas(?:e|ed|es|ing)|rose|grew|growth|higher)\b|増加|増収|増益|上昇',
     r'\b(?:decreas(?:e|ed|es|ing)|fell|declin(?:e|ed|es)|lower)\b|減少|減収|減益|下落'),
    (r'\b(?:net income|net profit)\b|純利益', r'\bnet loss\b|純損失'),
)


def validate_semantics(text, evidence):
    for positive, negative in SEMANTIC_POLARITIES:
        if re.search(positive,text,re.I) and re.search(negative,evidence,re.I) and not re.search(positive,evidence,re.I):
            raise ValueError('invalid-copy')
        if re.search(negative,text,re.I) and re.search(positive,evidence,re.I) and not re.search(negative,evidence,re.I):
            raise ValueError('invalid-copy')


def validate_pair(ja, en):
    if Counter(signed_numbers(ja))!=Counter(signed_numbers(en)):
        raise ValueError('unsupported-number')
    for positive, negative in SEMANTIC_POLARITIES:
        if ((re.search(positive,ja,re.I) and re.search(negative,en,re.I))
                or (re.search(negative,ja,re.I) and re.search(positive,en,re.I))):
            raise ValueError('invalid-copy')
