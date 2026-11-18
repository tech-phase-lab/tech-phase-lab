"""Note-specific "still unknown" and "next checkpoint" lines for issuer notes.

Owner, Nov 18: every issuer research note showed the same two fixed sentences.
Both lines are now written in the same model call as the note (no extra call)
and published only after deterministic checks against the release:

- openQuestion names one point the release does not disclose. Its numbers and
  dates must appear in the quoted evidence, it must be phrased as
  non-disclosure, carry no advice or forecast wording, and its topic must not
  be one the release actually discloses (a price, a closing/launch date, an
  approval already received, a stated revenue contribution, named customers).
- nextCheckpoint restates a future milestone the release itself mentions. It
  passes the full fact check (validate_item) like any other fact, its evidence
  must contain a future or schedule cue, and it carries no advice.

Anything that fails is dropped; the app then shows a short kind-specific line.
Nothing here can hold back or change the note itself.
"""
import copy
import re

import factual_validation

FIELDS = ('openQuestion', 'nextCheckpoint')
TOPICS = ('price', 'financialTerms', 'timing', 'revenueImpact', 'customers', 'regulatoryApproval', 'other')
MAX_CHARS = 240

POLICY = """Also return openQuestion and nextCheckpoint for this release (each at most 200 characters per language), using the same evidence excerpts.
openQuestion: one point that this release does not disclose and that matters for judging its business effect, such as the price or financial terms, the timing, the revenue contribution, the customers or a regulatory approval. Say plainly that the release does not disclose it (Japanese e.g. 〜は明らかにしていない; English e.g. The release does not disclose ...). Set topic to the matching value. Its evidenceId is the excerpt about the subject. Never call something undisclosed when the excerpts state it, and add no figure that is not in that excerpt.
nextCheckpoint: restate one concrete future milestone that the release itself mentions (an expected closing, a launch or availability date, a next report, a required approval), keeping its timing and modality exactly as stated. Its evidenceId must contain that milestone.
Neither line may predict results, comment on the share price or give advice."""

KINDS = ('acquisition', 'earnings', 'partnership', 'product')


def release_kind(title):
    """Note kind from the release title (unchanged public classification)."""
    return ('acquisition' if re.search(r'\bacquir|\bacquisition', title, re.I) else
            'earnings' if re.search(r'results|earnings', title, re.I) else
            'partnership' if re.search(r'partner|agreement', title, re.I) else 'product')


def enabled(row):
    """Only the company's own releases shown as research notes use these lines."""
    return (str(row.get('source_id', '')).startswith('primary-ir-')
            and not row.get('general_source') and not row.get('issuer_business')
            and not row.get('semantic_assessment'))


def response_properties():
    item = {'type': 'object', 'additionalProperties': False, 'required': ['ja', 'en', 'evidenceId'],
            'properties': {k: {'type': 'string'} for k in ('ja', 'en', 'evidenceId')}}
    question = {'type': 'object', 'additionalProperties': False, 'required': ['ja', 'en', 'evidenceId', 'topic'],
                'properties': {**{k: {'type': 'string'} for k in ('ja', 'en', 'evidenceId')},
                               'topic': {'type': 'string', 'enum': list(TOPICS)}}}
    return {'openQuestion': question, 'nextCheckpoint': item}


def extend_schema(schema):
    schema = copy.deepcopy(schema)
    schema['properties'].update(response_properties())
    schema['required'] = [*schema['required'], *FIELDS]
    return schema


def extract(value):
    """Remove the two lines from a model answer so the note keeps its exact shape."""
    if not isinstance(value, dict):
        return {}
    return {name: value.pop(name) for name in FIELDS if name in value}


ADVICE = re.compile(r'\b(?:buy|sell|hold|price target|stock price|share price|investors? should)\b|'
                    r'株価|目標株価|投資判断|買い推奨|売り推奨|買い時|売り時|投資家は', re.I)
FORECAST = re.compile(r'\b(?:likely|unlikely|probabl\w*|poised|tailwind|headwind|upside|downside|bullish|bearish|'
                      r'boost\w*|benefit from|set to (?:grow|rise|fall))\b|'
                      r'見込まれ|予想され|期待され|可能性が高|追い風|逆風|押し上げ|押し下げ|上振れ|下振れ|強気|弱気|恩恵', re.I)
UNDISCLOSED_JA = re.compile(r'明らかにしていない|明らかにされていない|開示していない|開示されていない|示していない|'
                            r'示されていない|触れていない|明示していない|公表していない|説明していない|記載がない|記載はない|'
                            r'言及していない|分からない|わからない')
UNDISCLOSED_EN = re.compile(r"\b(?:does|did|do)(?: not|n't) (?:disclose|specify|say|state|detail|give|provide|mention|"
                            r"quantify|name|identify|include)\b|\bnot (?:been )?(?:disclosed|specified|stated|detailed|"
                            r"quantified|given|provided|named|identified)\b|\bundisclosed\b|\bunclear\b", re.I)
FUTURE_CUE = re.compile(r'\b(?:expect\w*|anticipat\w*|schedul\w*|plan(?:s|ned|ning)?|will|intend\w*|upcoming|'
                        r'target(?:s|ed)?|subject to|pending|later this|by the end of|on track)\b', re.I)
MONEY = r'(?:\$\s?\d|\d[\d,.]*\s*(?:million|billion)\b)'
DATE_WORD = (r'(?:\b(?:19|20)\d\d\b|\bQ[1-4]\b|\b(?:first|second|third|fourth) (?:quarter|half)\b|'
             r'\b(?:January|February|March|April|May|June|July|August|September|October|November|December)\b|'
             r'\b(?:today|now|immediately)\b)')
# A topic the release does disclose cannot be called undisclosed.
DISCLOSED = {
    'price': re.compile(r'\b(?:purchase price|consideration|transaction value|enterprise value|valued at|priced at|'
                        r'per share in cash|pricing (?:starts|begins)|(?:starts|starting) at)\b[^.]{0,80}' + MONEY + r'|'
                        r'\bfor (?:approximately |about |roughly )?' + MONEY, re.I),
    'financialTerms': re.compile(r'\b(?:purchase price|consideration|transaction value|enterprise value|valued at|'
                                 r'all-cash|cash and stock|per share in cash)\b|\bfor (?:approximately |about )?' + MONEY, re.I),
    'timing': re.compile(r'\b(?:expected to (?:close|be completed|complete|launch|ship|be available|begin|start)|'
                         r'(?:will be|is|are|becomes?|now) (?:generally |broadly )?available|'
                         r'(?:launch|ship|deliver|roll)(?:es|s|ing)?(?: out)? (?:in|on|by|starting)|'
                         r'(?:plans?|expects?|intends?) to (?:make|launch|ship|close|complete|begin|start|deliver|release)|'
                         r'scheduled (?:to|for)|will (?:close|begin|start|launch|ship))\b[^.]{0,80}' + DATE_WORD, re.I),
    'revenueImpact': re.compile(r'\baccretive\b|\b(?:expected to|will) (?:add|contribute|generate)\b[^.]{0,60}'
                                r'(?:revenue|sales|\$)', re.I),
    'customers': re.compile(r'\bcustomers? (?:include|including|such as)\b', re.I),
    'regulatoryApproval': re.compile(r'\b(?:received|obtained|secured) (?:all )?(?:required |necessary )?(?:regulatory )?'
                                     r'(?:approvals?|clearances?)\b|\bapprovals? (?:has|have) been (?:received|obtained)\b', re.I),
}


def _normalized(text):
    return re.sub(r'\s+', ' ', text).strip()


def _bound(item, excerpts, body):
    """Attach the selected excerpt as evidence, or None when it is not a valid source excerpt."""
    if not isinstance(item, dict):
        return None
    item = dict(item)
    evidence_id = item.pop('evidenceId', None)
    if 'evidenceQuote' not in item:
        if not isinstance(evidence_id, str) or evidence_id not in excerpts:
            return None
        item['evidenceQuote'] = excerpts[evidence_id]
    quote = item.get('evidenceQuote')
    if not isinstance(quote, str) or not 16 <= len(quote) <= 1800 or _normalized(quote) not in _normalized(body):
        return None
    return item


def _plain_copy(item):
    for lang, script in (('ja', r'[ぁ-んァ-ヶ一-龯]'), ('en', r'[A-Za-z]')):
        text = item.get(lang)
        if (not isinstance(text, str) or not text.strip() or len(text) > MAX_CHARS or '\x00' in text
                or not re.search(script, text) or re.search(r'https?://|申し込|申込|sign up|register now', text, re.I)
                or ADVICE.search(text)):
            raise ValueError('invalid-outlook')


def check_question(item, body):
    if set(item) != {'ja', 'en', 'evidenceQuote', 'topic'} or item['topic'] not in TOPICS:
        raise ValueError('invalid-outlook')
    _plain_copy(item)
    if not UNDISCLOSED_JA.search(item['ja']) or not UNDISCLOSED_EN.search(item['en']):
        raise ValueError('invalid-outlook')
    if FORECAST.search(item['ja']) or FORECAST.search(item['en']):
        raise ValueError('invalid-outlook')
    disclosed = DISCLOSED.get(item['topic'])
    if disclosed and disclosed.search(_normalized(body)):
        raise ValueError('disclosed-topic')
    for lang in ('ja', 'en'):
        factual_validation.validate_numbers(item[lang], item['evidenceQuote'])
    factual_validation.validate_pair(item['ja'], item['en'])
    return item


def check_checkpoint(item, body, title, validate_item):
    if set(item) != {'ja', 'en', 'evidenceQuote'}:
        raise ValueError('invalid-outlook')
    _plain_copy(item)
    if not FUTURE_CUE.search(item['evidenceQuote']) or not FUTURE_CUE.search(item['en']):
        raise ValueError('invalid-outlook')
    # The same source/number/meaning checks as every published fact.
    validate_item('fact', item, body, title)
    _plain_copy(item)
    return item


def checked(raw, excerpts, row, validate_item):
    """Return only the lines that pass every check, keyed as stored."""
    result = {}
    for name in FIELDS:
        item = _bound(copy.deepcopy(raw.get(name)), excerpts, row['body'])
        if item is None:
            continue
        try:
            if name == 'openQuestion':
                item = check_question(item, row['body'])
            else:
                item = check_checkpoint(item, row['body'], row['title'], validate_item)
        except (ValueError, TypeError, KeyError, AttributeError):
            continue
        result[name] = item
    return result


def public_lines(note, row, validate_item):
    """Re-check stored lines against the current release; return public {unknown,next} copy."""
    stored = note.get('outlook') if isinstance(note, dict) else None
    if not isinstance(stored, dict) or not enabled(row):
        return {}
    lines = checked(stored, {}, row, validate_item)
    names = {'openQuestion': 'unknown', 'nextCheckpoint': 'next'}
    return {names[name]: {'ja': item['ja'], 'en': item['en']} for name, item in lines.items()}
