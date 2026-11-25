"""Check the 決算の深掘り data files (lib/research/dives/<TICKER>.json) against their contract (owner, Nov 25).

Usage:
  python3 scripts/research/check_dives.py [lib/research/dives/NVDA.json ...]   # default: every lib/research/dives/*.json
  python3 scripts/research/check_dives.py --write-fixture lib/research/dives/NVDA.json URL=path/to/full-text ...

What is checked, per file:
  - every contract field is present and has the right shape (numbers, history, summary, tiles, sources, evidence);
  - section counts: 1-3 conclusion paragraphs; cards growth/change/caution/next, each 1-3 chips and 3-4 sections; 3 tiles;
  - every evidence quote appears in the cached source text tests/fixtures/dives/<TICKER>-source.txt (the quoted
    passages of the official filing, plus about 300 characters either side; never the whole filing);
  - every number in numbers, history and tiles has an evidence entry, and the number matches its quote: either the value
    itself appears in the quote, or the entry's `calc` (plain arithmetic over figures that all appear in the quote) gives it.

The fixture file holds blocks: a line `@@ <source url>` followed by one excerpt per line. Text is compared after
normalize() (whitespace collapsed, non-breaking spaces and curly quotes made plain), which is also how excerpts are written.
"""
import ast
import html
import json
import re
import sys
from decimal import Decimal, ROUND_HALF_UP
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
DIVES = ROOT / 'lib/research/dives'
FIXTURES = ROOT / 'tests/fixtures/dives'
WINDOW = 300
CARD_KEYS = ('growth', 'change', 'caution', 'next')
SECTION_KEYS = {'happened', 'good', 'watch', 'means', 'view'}
TONES = {'up', 'down', 'gold'}
CURRENCIES = {'USD', 'TWD', 'EUR', 'KRW', 'JPY', 'GBP'}
CONSTANTS = {'1', '2', '100', '1000'}  # unit changes, halves and percentages; every other figure must be quoted
DATE = re.compile(r'^20\d\d-\d\d-\d\d$')
NUMBER = re.compile(r'\d[\d,]*(?:\.\d+)?')
# no advice, ratings or targets in the copy (BRIEF content rules)
FORBIDDEN = re.compile(r'おすすめ|オススメ|買い時|売り時|買うべき|売るべき|目標株価|\bbuy\b|\bsell\b|price target|recommend', re.I)


def normalize(text):
    text = text.replace('\xa0', ' ').replace('​', '').replace('’', "'").replace('‘', "'")
    text = text.replace('“', '"').replace('”', '"')
    return re.sub(r'\s+', ' ', text).strip()


def html_text(raw):
    """Plain text of an HTML filing, in the same form the quotes are compared in."""
    raw = re.sub(r'(?is)<(script|style)[^>]*>.*?</\1>', ' ', raw)
    raw = re.sub(r'(?i)<br\s*/?>|</(p|div|tr|td|th|li|h\d)>', ' ', raw)
    raw = re.sub(r'<[^>]+>', ' ', raw)
    return normalize(html.unescape(raw))


def quote_numbers(quote):
    return {m.replace(',', '') for m in NUMBER.findall(quote)}


def _eval(node):
    if isinstance(node, ast.Expression):
        return _eval(node.body)
    if isinstance(node, ast.Constant) and isinstance(node.value, (int, float)):
        return Decimal(str(node.value))
    if isinstance(node, ast.UnaryOp) and isinstance(node.op, ast.USub):
        return -_eval(node.operand)
    if isinstance(node, ast.BinOp) and isinstance(node.op, (ast.Add, ast.Sub, ast.Mult, ast.Div)):
        a, b = _eval(node.left), _eval(node.right)
        return a + b if isinstance(node.op, ast.Add) else a - b if isinstance(node.op, ast.Sub) else a * b if isinstance(node.op, ast.Mult) else a / b
    raise ValueError('calc may only use numbers, + - * / and parentheses')


def calc_value(calc, quote):
    """The value of `calc`; every figure in it except the unit constants must appear in the quote."""
    tree = ast.parse(calc, mode='eval')
    quoted = {Decimal(q) for q in quote_numbers(quote)}
    for node in ast.walk(tree):
        if isinstance(node, ast.Constant):
            literal = calc[node.col_offset:node.end_col_offset]
            if literal not in CONSTANTS and Decimal(literal) not in quoted:
                raise ValueError(f'figure {literal} in calc is not in the quote')
    return _eval(tree)


def first_number(text):
    m = NUMBER.search(text or '')
    return Decimal(m.group().replace(',', '')) if m else None


def get_path(data, path):
    cur = data
    for part in re.findall(r'[^.\[\]]+|\[\d+\]', path):
        if part.startswith('['):
            idx = int(part[1:-1])
            if not isinstance(cur, list) or idx >= len(cur):
                raise KeyError(path)
            cur = cur[idx]
        else:
            if not isinstance(cur, dict) or part not in cur:
                raise KeyError(path)
            cur = cur[part]
    return cur


def number_fields(dive):
    """Every number the page shows that needs a source: (field path, value)."""
    out = []
    n = dive.get('numbers') or {}
    rev = n.get('revenue') or {}
    for key in ('current', 'previous', 'yearAgo'):
        if rev.get(key) is not None:
            out.append((f'numbers.revenue.{key}', rev[key]))
    for key in ('adjustedEPS', 'epsEstimate'):
        if n.get(key) is not None:
            out.append((f'numbers.{key}', n[key]))
    for group, keys in (('grossMargin', ('current', 'previous')), ('guidance', ('low', 'high', 'grossMarginPercent'))):
        if n.get(group):
            for key in keys:
                if n[group].get(key) is not None:
                    out.append((f'numbers.{group}.{key}', n[group][key]))
    for i, seg in enumerate(n.get('segments') or []):
        for key in ('revenue', 'previous', 'operatingMargin', 'previousOperatingMargin'):
            if isinstance(seg, dict) and seg.get(key) is not None:
                out.append((f'numbers.segments[{i}].{key}', seg[key]))
    for i, h in enumerate(dive.get('history') or []):
        if isinstance(h, dict):
            out.append((f'history[{i}].value', h.get('value')))
    for i, tile in enumerate(dive.get('tiles') or []):
        if isinstance(tile, dict):
            out.append((f'tiles[{i}].value', first_number((tile.get('value') or {}).get('en'))))
            note = first_number((tile.get('note') or {}).get('en'))
            if note is not None:
                out.append((f'tiles[{i}].note', note))
    return out


def read_fixture(path):
    """{url: [excerpt, ...]} from a fixture file."""
    blocks, url = {}, None
    for line in path.read_text(encoding='utf-8').splitlines():
        if line.startswith('@@ '):
            url = line[3:].strip()
            blocks.setdefault(url, [])
        elif line.strip() and url:
            blocks[url].append(normalize(line))
    return blocks


class Checker:
    def __init__(self, path):
        self.path = Path(path)
        self.errors = []

    def err(self, msg):
        self.errors.append(f'{self.path.name}: {msg}')

    def copy(self, value, where, max_len=800):
        if not isinstance(value, dict) or not all(isinstance(value.get(k), str) and 0 < len(value[k]) <= max_len for k in ('ja', 'en')):
            self.err(f'{where}: needs non-empty ja and en text (at most {max_len} characters)')
            return
        ja, en = value['ja'], value['en']
        if '$' in ja or re.search(r'billion|million|\d\s*(?:bn|mn)\b', ja, re.I):
            self.err(f'{where}: Japanese text must use Japanese money units (億ドル), not $ or English scale words')
        # the site's Japanese copy rules (tests/ja-copy-punctuation.test.mjs): 「ドル」 never 「米ドル」, no 「。」「、」 after a parenthesis
        if '米ドル' in ja or re.search(r'[)）][。、]', ja):
            self.err(f'{where}: Japanese copy must say ドル (not 米ドル) and must not put 。 or 、 right after a closing parenthesis')
        if re.search(r'[ぁ-んァ-ン一-龥]', en):
            self.err(f'{where}: English text contains Japanese')
        for text in (ja, en):
            if FORBIDDEN.search(text):
                self.err(f'{where}: advice or rating wording is not allowed ({FORBIDDEN.search(text).group()})')

    def num(self, value, where, nullable=False, lo=None, hi=None):
        if value is None and nullable:
            return
        if isinstance(value, bool) or not isinstance(value, (int, float)):
            self.err(f'{where}: must be a number' + (' or null' if nullable else ''))
            return
        if (lo is not None and value < lo) or (hi is not None and value > hi):
            self.err(f'{where}: {value} is outside {lo}..{hi}')

    def run(self):
        try:
            dive = json.loads(self.path.read_text(encoding='utf-8'))
        except (OSError, ValueError) as e:
            self.err(f'not readable JSON ({e})')
            return self.errors
        if not isinstance(dive, dict):
            self.err('top level must be an object')
            return self.errors
        self.top(dive)
        self.numbers(dive.get('numbers'))
        self.history(dive)
        self.summary(dive)
        self.tiles(dive.get('tiles'))
        self.evidence(dive)
        return self.errors

    def top(self, d):
        if not re.fullmatch(r'[A-Z]{1,6}', str(d.get('ticker', ''))):
            self.err('ticker must be 1-6 capital letters')
        elif self.path.stem != d['ticker']:
            self.err(f'file name must be {d["ticker"]}.json')
        for key in ('name', 'exchange', 'quoteTicker', 'period'):
            if not isinstance(d.get(key), str) or not d[key].strip():
                self.err(f'{key} is missing')
        if not isinstance(d.get('periodQuarter'), int) or not 1 <= d['periodQuarter'] <= 4:
            self.err('periodQuarter must be 1-4')
        else:
            m = re.search(r'Q([1-4])', str(d.get('period', '')))
            if not m or int(m.group(1)) != d['periodQuarter']:
                self.err('periodQuarter must match the quarter in period')
        for key in ('releasedOn', 'periodEnd', 'reviewedOn'):
            if not DATE.match(str(d.get(key, ''))):
                self.err(f'{key} must be YYYY-MM-DD')
        if all(DATE.match(str(d.get(k, ''))) for k in ('releasedOn', 'periodEnd', 'reviewedOn')):
            if not d['periodEnd'] < d['releasedOn'] <= d['reviewedOn']:
                self.err('dates must satisfy periodEnd < releasedOn <= reviewedOn')
        if d.get('currency') not in CURRENCIES:
            self.err(f'currency must be one of {sorted(CURRENCIES)}')
        sources = d.get('sources')
        if not isinstance(sources, list) or not sources:
            self.err('sources must be a non-empty list')
        else:
            for i, s in enumerate(sources):
                if not isinstance(s, dict) or not str(s.get('url', '')).startswith('https://') or not s.get('title') or not s.get('location'):
                    self.err(f'sources[{i}] needs an https url, a title and a location')

    def numbers(self, n):
        if not isinstance(n, dict):
            self.err('numbers is missing')
            return
        rev = n.get('revenue')
        if not isinstance(rev, dict):
            self.err('numbers.revenue is missing')
        else:
            self.num(rev.get('current'), 'numbers.revenue.current', lo=0.000001)
            self.num(rev.get('previous'), 'numbers.revenue.previous', lo=0.000001)
            self.num(rev.get('yearAgo'), 'numbers.revenue.yearAgo', nullable=True, lo=0)
        for key in ('adjustedEPS', 'epsEstimate'):
            if key not in n:
                self.err(f'numbers.{key} is missing (use null)')
            self.num(n.get(key), f'numbers.{key}', nullable=True)
        for key in ('grossMargin', 'guidance', 'segments'):
            if key not in n:
                self.err(f'numbers.{key} is missing (use null)')
        gm = n.get('grossMargin')
        if gm is not None:
            if not isinstance(gm, dict):
                self.err('numbers.grossMargin must be an object or null')
            else:
                self.num(gm.get('current'), 'numbers.grossMargin.current', lo=-100, hi=100)
                self.num(gm.get('previous'), 'numbers.grossMargin.previous', lo=-100, hi=100)
        g = n.get('guidance')
        if g is not None:
            if not isinstance(g, dict):
                self.err('numbers.guidance must be an object or null')
            else:
                self.num(g.get('low'), 'numbers.guidance.low', lo=0.000001)
                self.num(g.get('high'), 'numbers.guidance.high', lo=0.000001)
                self.num(g.get('grossMarginPercent'), 'numbers.guidance.grossMarginPercent', nullable=True, lo=-100, hi=100)
                if isinstance(g.get('low'), (int, float)) and isinstance(g.get('high'), (int, float)) and g['low'] > g['high']:
                    self.err('numbers.guidance.low is above high')
        segs = n.get('segments')
        if segs is not None:
            if not isinstance(segs, list) or not segs:
                self.err('numbers.segments must be a non-empty list or null')
            else:
                keys = set()
                for i, s in enumerate(segs):
                    if not isinstance(s, dict):
                        self.err(f'numbers.segments[{i}] must be an object')
                        continue
                    if not re.fullmatch(r'[a-z][a-z0-9_-]{0,19}', str(s.get('key', ''))) or s['key'] in keys:
                        self.err(f'numbers.segments[{i}].key must be a unique short lowercase key')
                    keys.add(s.get('key'))
                    for k in ('nameJa', 'nameEn'):
                        if not isinstance(s.get(k), str) or not 0 < len(s[k]) <= 60:
                            self.err(f'numbers.segments[{i}].{k} is missing')
                    for k in ('revenue', 'previous'):
                        self.num(s.get(k), f'numbers.segments[{i}].{k}', lo=0)
                    for k in ('operatingMargin', 'previousOperatingMargin'):
                        self.num(s.get(k), f'numbers.segments[{i}].{k}', lo=-1000, hi=100)

    def history(self, d):
        h = d.get('history')
        if not isinstance(h, list) or len(h) < 4:
            self.err('history needs at least 4 earlier quarters')
            return
        quarters = []
        for i, item in enumerate(h):
            if not isinstance(item, dict) or not re.fullmatch(r'Q[1-4]', str(item.get('label', ''))) or not DATE.match(str(item.get('end', ''))):
                self.err(f'history[{i}] needs label Q1-Q4 and end YYYY-MM-DD')
                return
            self.num(item.get('value'), f'history[{i}].value', lo=0.000001)
            quarters.append(int(item['label'][1]))
        ends = [item['end'] for item in h]
        if ends != sorted(set(ends)):
            self.err('history must be oldest first with distinct end dates')
        if DATE.match(str(d.get('periodEnd', ''))) and ends[-1] >= d['periodEnd']:
            self.err('history must end before the reported quarter')
        seq = quarters + ([d['periodQuarter']] if isinstance(d.get('periodQuarter'), int) else [])
        if any(b != a % 4 + 1 for a, b in zip(seq, seq[1:])):
            self.err(f'history labels must be consecutive quarters leading to Q{d.get("periodQuarter")}: {quarters}')

    def summary(self, d):
        s = d.get('summary')
        if not isinstance(s, dict):
            self.err('summary is missing')
            return
        conclusion = s.get('conclusion')
        if not isinstance(conclusion, list) or not 1 <= len(conclusion) <= 3:
            self.err('summary.conclusion needs 1-3 items')
        else:
            for i, c in enumerate(conclusion):
                self.copy(c, f'summary.conclusion[{i}]')
        cards = s.get('cards')
        if not isinstance(cards, dict):
            self.err('summary.cards is missing')
            return
        seg_keys = {x.get('key') for x in ((d.get('numbers') or {}).get('segments') or []) if isinstance(x, dict)}
        for key in CARD_KEYS:
            card = cards.get(key)
            where = f'summary.cards.{key}'
            if not isinstance(card, dict):
                self.err(f'{where} is missing')
                continue
            self.copy(card.get('headline'), f'{where}.headline', 120)
            chips = card.get('chips')
            if not isinstance(chips, list) or not 1 <= len(chips) <= 3:
                self.err(f'{where}.chips needs 1-3 items')
            else:
                for i, chip in enumerate(chips):
                    if not isinstance(chip, dict) or chip.get('tone') not in TONES:
                        self.err(f'{where}.chips[{i}].tone must be up, down or gold')
                    else:
                        self.copy(chip.get('text'), f'{where}.chips[{i}].text', 80)
            sections = card.get('sections')
            if not isinstance(sections, list) or not 3 <= len(sections) <= 4:
                self.err(f'{where}.sections needs 3-4 items')
            else:
                seen = []
                for i, sec in enumerate(sections):
                    if not isinstance(sec, dict) or sec.get('key') not in SECTION_KEYS:
                        self.err(f'{where}.sections[{i}].key must be one of {sorted(SECTION_KEYS)}')
                        continue
                    seen.append(sec['key'])
                    self.copy(sec.get('text'), f'{where}.sections[{i}].text')
                if len(seen) != len(set(seen)):
                    self.err(f'{where}.sections repeat a key')
                if 'happened' not in seen:
                    self.err(f'{where}.sections must include happened')
                if key == 'caution' and 'watch' not in seen:
                    self.err(f'{where}.sections must include watch')
            if card.get('segment') is not None and card['segment'] not in seg_keys:
                self.err(f'{where}.segment {card["segment"]!r} is not one of numbers.segments')

    def tiles(self, tiles):
        if not isinstance(tiles, list) or len(tiles) != 3:
            self.err('tiles needs exactly 3 items')
            return
        for i, t in enumerate(tiles):
            if not isinstance(t, dict):
                self.err(f'tiles[{i}] must be an object')
                continue
            for k in ('label', 'value', 'note'):
                self.copy(t.get(k), f'tiles[{i}].{k}', 80)
            if first_number((t.get('value') or {}).get('en')) is None:
                self.err(f'tiles[{i}].value.en must contain the number')

    def evidence(self, d):
        ev = d.get('evidence')
        if not isinstance(ev, list) or not ev:
            self.err('evidence must be a non-empty list')
            return
        urls = {s.get('url') for s in d.get('sources') or [] if isinstance(s, dict)}
        fixture = FIXTURES / f'{d.get("ticker")}-source.txt'
        if not fixture.exists():
            self.err(f'cached source text {fixture.relative_to(ROOT)} is missing')
            return
        blocks = read_fixture(fixture)
        used_urls, by_field, matched = set(), {}, {}
        for i, e in enumerate(ev):
            if not isinstance(e, dict) or not all(isinstance(e.get(k), str) and e[k] for k in ('field', 'url', 'quote')):
                self.err(f'evidence[{i}] needs field, url and quote')
                continue
            if e['url'] not in urls:
                self.err(f'evidence[{i}] url is not in sources')
            used_urls.add(e['url'])
            quote = normalize(e['quote'])
            hits = [x for x in blocks.get(e['url'], []) if quote in x]
            if not hits:
                self.err(f'evidence[{i}] ({e["field"]}): quote not found in the cached source text for {e["url"]}')
            for x in hits:
                matched.setdefault((e['url'], x), []).append(quote)
            by_field.setdefault(e['field'], []).append(e)
        for url in urls - used_urls:
            self.err(f'source {url} has no evidence entry')
        for url, excerpts in blocks.items():
            if url not in urls:
                self.err(f'fixture block {url} is not one of the sources')
            for x in excerpts:
                quotes = matched.get((url, x), [])
                if not quotes:
                    self.err(f'fixture excerpt for {url} quotes nothing (trim it): {x[:60]}...')
                elif len(x) > sum(len(q) for q in quotes) + 2 * WINDOW * len(quotes) + 20:
                    self.err(f'fixture excerpt for {url} is longer than the quotes plus {WINDOW} characters either side')
        for field, value in number_fields(d):
            entries = by_field.get(field)
            if not entries:
                self.err(f'{field} has no evidence entry')
                continue
            if value is None:
                continue
            target = abs(Decimal(str(value)))
            ok, why = False, ''
            # a calc may combine figures from every quote given for the same field (e.g. revenue and gross profit
            # printed in two different tables of the same release)
            pooled = ' | '.join(normalize(e['quote']) for e in entries)
            for e in entries:
                quote = normalize(e['quote'])
                try:
                    if e.get('calc'):
                        got = calc_value(e['calc'], pooled)
                        if e.get('round') is not None:
                            got = got.quantize(Decimal(1).scaleb(-int(e['round'])), ROUND_HALF_UP)
                        good = abs(abs(got) - target) <= Decimal('1e-9') * max(Decimal(1), target)
                        why = f'calc {e["calc"]} = {got}, value {value}'
                    else:
                        good = any(Decimal(q) == target for q in quote_numbers(quote))
                        why = f'{value} does not appear in the quote (add calc)'
                except (ValueError, SyntaxError, ArithmeticError) as exc:
                    good, why = False, str(exc)
                ok = ok or good
            if not ok:
                self.err(f'{field}: number does not match its quote ({why})')
        known = {f for f, _ in number_fields(d)}
        for field in by_field:
            if field not in known:
                try:
                    get_path(d, field)
                except KeyError:
                    self.err(f'evidence field {field} does not exist in the file')


def write_fixture(dive_path, sources):
    """Cut the cached source text from full texts: each quote plus WINDOW characters either side, windows merged."""
    dive = json.loads(Path(dive_path).read_text(encoding='utf-8'))
    texts = {}
    for item in sources:
        url, path = item.split('=', 1)
        raw = Path(path).read_text(encoding='utf-8', errors='replace')
        texts[url] = html_text(raw) if path.endswith(('.htm', '.html')) else normalize(raw)
    spans, missing = {}, []
    for e in dive['evidence']:
        text, quote = texts.get(e['url']), normalize(e['quote'])
        at = text.find(quote) if text is not None else -1
        if at < 0:
            missing.append(f'{e["field"]}: {quote[:80]}')
            continue
        spans.setdefault(e['url'], []).append((max(0, at - WINDOW), min(len(text), at + len(quote) + WINDOW)))
    if missing:
        raise SystemExit('quotes not found in the full source text:\n  ' + '\n  '.join(missing))
    lines = []
    for url in [s['url'] for s in dive['sources']]:
        merged = []
        for a, b in sorted(spans.get(url, [])):
            if merged and a <= merged[-1][1]:
                merged[-1][1] = max(merged[-1][1], b)
            else:
                merged.append([a, b])
        lines.append(f'@@ {url}')
        lines.extend(texts[url][a:b].strip() for a, b in merged)
        lines.append('')
    FIXTURES.mkdir(parents=True, exist_ok=True)
    out = FIXTURES / f'{dive["ticker"]}-source.txt'
    out.write_text('\n'.join(lines), encoding='utf-8')
    return out


def check(paths):
    errors = []
    for p in paths:
        errors.extend(Checker(p).run())
    return errors


def main(argv):
    if argv[:1] == ['--write-fixture']:
        print(write_fixture(argv[1], argv[2:]))
        return 0
    paths = argv or sorted(str(p) for p in DIVES.glob('*.json'))
    errors = check(paths)
    for e in errors:
        print(e)
    print(f'{len(paths)} file(s) checked, {len(errors)} problem(s)')
    return 1 if errors else 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
