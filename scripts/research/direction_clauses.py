"""Clause-by-clause direction check (owner decision B, Nov 15).

The coarse rules reject a sentence that mixes an increase and a decrease ("Client up 7%, Gaming down 40%") because they cannot tell which
direction belongs to which item. This module looks at each clause of the copy on its own: the item it names, the direction it states and the
figure attached, and finds that same item with that same figure and direction in the cited source (a sentence such as "Gaming ... down 40%",
or a table row such as "Gross margin 4,806 5,018 (4)%"). It never decides alone that copy is fine; it returns

  'verified'     every direction-bearing clause was matched in the source (English clauses, and the Japanese clauses state the same
                 directions in the same order): the coarse direction rules are then not applied to this copy,
  'contradicted' a clause states the opposite of what the source shows for that item and figure (or the two languages disagree):
                 rejected, even where the coarse rules would have let it through,
  'unknown'      anything it cannot match: the coarse rules decide exactly as before.

Negation, numbers, names and every other check are untouched.
"""
import re

import factual_validation as fv

LEVEL = fv.DIRECTION_FAMILIES[0]
UP_EN, UP_JA, DOWN_EN, DOWN_JA = LEVEL[1], LEVEL[2], LEVEL[3], LEVEL[4]
# "(4)%" in a table's change column is a decrease; a bare "10%" there is an increase.
NUMBER = r'(?P<n>\d[\d,]*(?:\.\d+)?)'
UP_WORDS = r'(?:up|increas\w+|ris(?:e|es|en|ing)|rose|grew|grow(?:s|n|th)?|gain(?:s|ed)?|higher|climb\w*|jump\w*|expand\w*|improv\w*)'
DOWN_WORDS = r'(?:down|decreas\w+|declin\w+|fell|fall(?:s|en)?|drop\w*|lower|reduc\w+|slid\w*|shrank|shrink\w*|narrow\w*|contract\w*)'
CLAUSE_SPLIT = re.compile(r'(?<!\d)\.(?!\d)|[;!?\n]|\b(?:while|whereas|but|although|though|and|as)\b', re.I)
MODIFIERS = {'gaap', 'non-gaap', 'total', 'first-quarter', 'second-quarter', 'third-quarter', 'fourth-quarter', 'quarterly', 'full-year', 'annual',
             'adjusted', 'net', 'reported', 'overall', 'consolidated', 'quarter', 'q1', 'q2', 'q3', 'q4', 'the', 'a', 'its', 'our', 'company',
             'meanwhile', 'even', 'also', 'both', 'then', 'now', 'still', 'only', 'with', 'of', 'in', 'to', 'by', 'that', 'this', 'these', 'those',
             'was', 'were', 'is', 'are', 'be', 'been', 'rose', 'fell', 'at', 'for', 'on', 'from', 'after', 'before', 'where', 'which', 'it', 'they',
             'than', 'more', 'less', 'versus', 'vs', 'compared'}
LINKING = {'was', 'were', 'is', 'are', 'to', 'of', 'in', 'by', 'at', 'for', 'on', 'from', 'with', 'than', 'and', 'be', 'been', 'being', 'has', 'had', 'have'}
HEADS = {'revenue', 'revenues', 'sales', 'income', 'margin', 'profit', 'earnings', 'eps', 'cost', 'costs', 'expenses', 'shares'}
SKIP = re.compile(r'[$€£¥]?\d[\d,]*(?:\.\d+)?\s*(?:%|percent|billion|million|thousand|trillion|bn|m)?', re.I)


def _direction(clause):
    dirs = set()
    if fv._has(UP_EN, clause) or fv._has(UP_JA, clause) or re.search(r'\bup\b(?=\s+(?:from|by|[$€£¥]?\d))', clause, re.I):
        dirs.add('up')
    if fv._has(DOWN_EN, clause) or fv._has(DOWN_JA, clause) or re.search(r'\bdown\b(?=\s+(?:from|by|[$€£¥]?\d))', clause, re.I):
        dirs.add('down')
    return dirs


def _word_direction(word):
    if re.fullmatch(UP_WORDS, word, re.I):
        return 'up'
    if re.fullmatch(DOWN_WORDS, word, re.I):
        return 'down'
    return None


def _tokens(text):
    text = SKIP.sub(' ', text)
    return [t for t in re.findall(r"[A-Za-z][A-Za-z0-9&'’-]*", text)]


def _labels(prefix):
    """Candidate item names from the words before a direction word, longest first. Only generic modifiers (GAAP, total, first-quarter ...) may
    be dropped from the front, so 'Client revenue' never becomes a bare 'revenue' that would match another segment."""
    tokens = [t for t in _tokens(prefix)]
    while tokens and tokens[-1].lower() in LINKING:
        tokens.pop()  # "Client revenue was" -> "Client revenue"
    while tokens and tokens[0].lower() in MODIFIERS:
        tokens.pop(0)
    # the item is the last noun phrase: stop at a linking verb or preposition inside the prefix
    for index in range(len(tokens) - 1, -1, -1):
        if tokens[index].lower() in LINKING:
            tokens = tokens[index + 1:]
            break
    tokens = [t for t in tokens if t.lower() not in {'rose', 'fell', 'up', 'down'}][-5:]
    while tokens and tokens[0].lower() in MODIFIERS:
        tokens.pop(0)
    found = []
    candidates = [tokens]
    # without the trailing generic noun, so "Client segment revenue" also finds "Client segment"
    if len(tokens) > 1 and tokens[-1].lower() in HEADS | {'segment'}:
        candidates.append(tokens[:-1])
    for candidate in candidates:
        if candidate and (len(candidate) > 1 or candidate[0].lower() in HEADS or len(candidate[0]) > 3):
            found.append(candidate)
    return found


def _positions(source, label):
    pattern = r'\W+'.join(re.escape(t) for t in label)
    return [m.start() for m in re.finditer(pattern, source, re.I)]


def _signed_numbers(window, number):
    """Directions the source gives for `number` (a percentage) within the window: (4) or -4 or 'down 4%' is down; 'up 6%' or a bare 6% is up."""
    n = re.escape(number)
    directions = set()
    for m in re.finditer(r'(?<![\d.,])\(\s*' + n + r'(?:\.0+)?\s*\)\s*%?', window):
        directions.add('down')
    for m in re.finditer(r'(?<![\d.,])[-−–]\s*' + n + r'(?:\.0+)?\s*%?', window):
        directions.add('down')
    for m in re.finditer(r'\b' + DOWN_WORDS + r'\s+(?:by\s+|about\s+|roughly\s+|approximately\s+)?' + n + r'(?:\.0+)?\s*(?:%|percent)', window, re.I):
        directions.add('down')
    for m in re.finditer(r'\b' + UP_WORDS + r'\s+(?:by\s+|about\s+|roughly\s+|approximately\s+)?' + n + r'(?:\.0+)?\s*(?:%|percent)', window, re.I):
        directions.add('up')
    # a bare figure in a change column: "10%" (not part of "(10)%", "-10%" or a longer number)
    for m in re.finditer(r'(?<![\d.,(\-−–])' + n + r'(?:\.0+)?\s*%(?!\s*\))', window):
        before = window[max(0, m.start() - 12):m.start()]
        if not re.search(DOWN_WORDS + r'\s*(?:by\s+)?$', before, re.I) and not before.rstrip().endswith('('):
            directions.add('up')
    return directions


def _numeric_claim(label_sets, direction, number, source):
    """'verified' / 'contradicted' / 'unknown' for "<item> <direction> <number>%"."""
    seen = set()
    for label in label_sets:
        for position in _positions(source, label):
            seen |= _signed_numbers(source[position:position + 220], number)
        if direction in seen:
            return 'verified'
    return 'contradicted' if seen and direction not in seen else 'unknown'


def _word_claim(label_sets, direction, source):
    """A clause with no figure: the item must be followed (within the sentence) by a word of the claimed direction in the source."""
    up, down = UP_WORDS, DOWN_WORDS
    for label in label_sets:
        found = set()
        for position in _positions(source, label):
            window = source[position:position + 200]
            if re.search(r'\b' + up + r'\b|' + UP_JA, window, re.I):
                found.add('up')
            if re.search(r'\b' + down + r'\b|' + DOWN_JA, window, re.I):
                found.add('down')
        if direction in found and len(found) == 1:
            return 'verified'
        if found and direction not in found:
            return 'contradicted'
    return 'unknown'


def _from_to(clause, direction, source):
    """"A% from B%" or "from B% to A%": the figures must sit together in the source and move the way the copy says."""
    numbers = re.findall(r'(?<![\d.,])(\d[\d,]*(?:\.\d+)?)\s*%', clause)
    if len(numbers) != 2:
        return None
    values = [float(n.replace(',', '')) for n in numbers]
    m_from = re.search(r'\bfrom\s+(\d[\d,]*(?:\.\d+)?)\s*%', clause, re.I)
    if not m_from:
        return None
    prior = m_from.group(1)
    current = numbers[0] if numbers[1] == prior else numbers[1]
    if current == prior:
        return 'unknown'
    moved = 'up' if float(current.replace(',', '')) > float(prior.replace(',', '')) else 'down'
    if moved != direction:
        return 'contradicted'
    c, p = re.escape(current), re.escape(prior)
    together = re.search(c + r'\s*%?\W{0,12}' + p + r'(?![\d.])|' + p + r'\s*%?\W{0,12}' + c + r'(?![\d.])', source)
    return 'verified' if together else 'unknown'


def en_claims(text, source):
    """[(verdict, direction)] for every direction-bearing English clause (None when a clause mixes directions or cannot be read)."""
    results = []
    for clause in CLAUSE_SPLIT.split(text):
        if not clause or not clause.strip():
            continue
        dirs = _direction(clause)
        if not dirs:
            continue
        if len(dirs) != 1:
            # one clause with both directions ("up in A, down in B"): split on the commas and judge each part
            parts = [p for p in re.split(r',', clause) if _direction(p)]
            if len(parts) < 2 or any(len(_direction(p)) != 1 for p in parts):
                return None
            for part in parts:
                got = _clause_claim(part, source)
                if got is None:
                    return None
                results.append(got)
            continue
        got = _clause_claim(clause, source)
        if got is None:
            return None
        results.append(got)
    return results


def _clause_claim(clause, source):
    (direction,) = _direction(clause)
    moved = _from_to(clause, direction, source)
    if moved is not None:
        return moved, direction
    pairs = list(re.finditer(r'\b(?:' + UP_WORDS + '|' + DOWN_WORDS + r')\s+(?:by\s+|about\s+|roughly\s+)?[$€£¥]?(\d[\d,]*(?:\.\d+)?)\s*(?P<pct>%|percent)?', clause, re.I))
    if not pairs:
        pairs = list(re.finditer(r'(\d[\d,]*(?:\.\d+)?)\s*(?P<pct>%|percent)\s*(?:' + UP_WORDS + '|' + DOWN_WORDS + r')\b', clause, re.I))
    if pairs:
        verdicts, start = [], 0
        for m in pairs:
            word = re.search(UP_WORDS + '|' + DOWN_WORDS, m.group(0), re.I)
            wdirs = {_word_direction(word.group(0))} - {None} if word else set()
            if len(wdirs) != 1 or not m.group('pct'):
                return 'unknown', direction
            labels = _labels(clause[start:m.start()] if m.start() > start else clause[:m.start()])
            start = m.end()
            if not labels:
                return 'unknown', direction
            verdicts.append(_numeric_claim(labels, next(iter(wdirs)), m.group(1), source))
        if 'contradicted' in verdicts:
            return 'contradicted', direction
        return ('verified' if all(v == 'verified' for v in verdicts) else 'unknown'), direction
    word = re.search(r'\b(?:' + UP_WORDS + '|' + DOWN_WORDS + r')\b', clause, re.I)
    labels = _labels(clause[:word.start()]) if word else []
    if not labels:
        return 'unknown', direction
    return _word_claim(labels, direction, source), direction


def ja_directions(text):
    """The direction of each Japanese clause that states exactly one, in order; None when a clause mixes both."""
    out = []
    for clause in re.split(r'[。；\n]|一方|ものの|が、|、', text):
        dirs = _direction(clause)
        if len(dirs) > 1:
            return None
        if dirs:
            out.append(next(iter(dirs)))
    return out


def verdict(ja, en, source):
    """'verified' | 'contradicted' | 'unknown' for one bilingual copy against the source it cites."""
    claims = en_claims(en, source)
    if claims is None or not claims:
        return 'unknown'
    english = [d for _, d in claims]
    japanese = ja_directions(ja)
    if any(v == 'contradicted' for v, _ in claims):
        return 'contradicted'
    if japanese is None:
        return 'unknown'
    if len(japanese) == len(english) and japanese != english:
        return 'contradicted'  # clause for clause, the two languages disagree on a direction: the swapped-direction mistake
    if collapse(japanese) != collapse(english):
        return 'unknown'
    return 'verified' if all(v == 'verified' for v, _ in claims) else 'unknown'


def collapse(items):
    """Order-preserving, with runs of the same direction kept (the English side splits clauses differently from Japanese)."""
    out = []
    for item in items:
        if not out or out[-1] != item:
            out.append(item)
    return out
