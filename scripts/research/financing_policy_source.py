"""Offline-only closed financing/policy grammars and exact bilingual rendering.

No admission, publication, provider, database, clock, URL identity or alias lookup.
The reviewed actor/header vocabulary is deliberately closed. Amounts are bound
variables; unfamiliar actors, syntax, clauses and modalities are unsupported.
All source characters are consumed, including layout and an optional t.co token.
This is not a free-text equivalence checker or a publication/recovery approval.
"""
from dataclasses import asdict, dataclass, fields, is_dataclass
import hashlib
import re

VERSION = 1
MAX_INPUT = 2400
UNSUPPORTED = 'unsupported-financing-policy-format'


class FinancingPolicyError(ValueError):
    pass


def fail(reason):
    raise FinancingPolicyError(reason)


@dataclass(frozen=True)
class Evidence:
    start: int
    end: int
    quote: str


@dataclass(frozen=True)
class Actor:
    literal: str
    kind: str
    evidence: Evidence
    resolved_identity: str | None = None
    full_name: str | None = None
    official_title: str | None = None


@dataclass(frozen=True)
class Amount:
    role: str
    billion_usd: str
    evidence: Evidence
    approximate: bool = False
    approximation_evidence: Evidence | None = None


@dataclass(frozen=True)
class Claim:
    key: str
    evidence: Evidence
    context: tuple[Evidence, ...]
    actor: Actor
    predicate: str
    modality: str
    polarity: str
    tense: str


@dataclass(frozen=True)
class DebtComponent:
    amount: Amount
    seniority: str
    security: str | None
    leader: Actor | None
    evidence: Evidence


@dataclass(frozen=True)
class Participation:
    commitment: Claim
    amount: Amount
    syndication: Claim
    remainder_evidence: Evidence
    remainder_amount: str | None = None
    remainder_denominator: str | None = None
    commitment_tranche: str | None = None
    commitment_instrument: str | None = None
    completed: bool | None = None


@dataclass(frozen=True)
class FinancingReport:
    body: str
    body_sha: str
    kind: str
    assembly: Claim
    arranger_ticker: Evidence
    beneficiaries: tuple[Actor, ...]
    purchase_objects: tuple[Evidence, ...]
    total: Amount
    package: Claim
    components: tuple[DebtComponent, ...]
    participation: Participation
    trailing_url: Evidence | None


@dataclass(frozen=True)
class PolicyReport:
    body: str
    body_sha: str
    kind: str
    speaker: Actor
    header: Evidence
    claims: tuple[Claim, ...]
    expectation_match: str
    deficit_reduction_completed: bool | None
    inflation_forecast: str | None
    prohibition_or_impossibility: str | None
    trailing_url: Evidence | None


# Only ASCII layout is ignored. Words, punctuation, casing and literal HTML
# entity spelling are not normalized. A URL token is consumed, never fetched.
WS = r'[ \t\r\n]+'
PAD = r'[ \t\r\n]*'
NUMBER = r'(?:0|[1-9][0-9]{0,5})(?:\.[0-9]{1,3})?'
TAIL = r'(?:' + WS + r'(?P<url>https://t\.co/[A-Za-z0-9]{1,64}))?' + PAD
FINANCING = re.compile(
    PAD + r'(?P<assembly>(?P<arranger>Broadcom) (?P<ticker>\$AVGO) is assembling '
    r'(?P<approx>roughly) (?P<total>\$(?P<total_n>' + NUMBER + r')B) of financing '
    r'to help (?P<customer>Anthropic) and (?P<others>other AI customers) fund '
    r'(?P<chip>chip) &amp; (?P<infrastructure>infrastructure) purchases)' + WS +
    r'(?P<package>(?P<package_subject>The package) includes:' + WS +
    r'(?P<senior>(?P<senior_amount>\$(?P<senior_n>' + NUMBER + r')B) senior-secured debt)' + WS +
    r'(?P<junior>(?P<junior_amount>\$(?P<junior_n>' + NUMBER + r')B) junior debt led by (?P<leader>Blackstone)))' + WS +
    r'(?P<participation>(?P<participant>\$BX) (?P<expected>is expected to) '
    r'commit (?P<commit_amount>\$(?P<commit_n>' + NUMBER + r')B) itself &amp; '
    r'syndicate (?P<rest>the rest))' + TAIL
)
POLICY = re.compile(
    PAD + r'(?P<header>(?P<speaker>WHITE HOUSE HASSETT):[ \t]*)[\r\n]+' + PAD +
    r'(?P<assessment>(?P<report>THIS JOBS REPORT) WAS ABOUT EXPECTED)' + WS +
    r'(?P<commitment>(?P<president>PRESIDENT) IS COMMITTED TO CUTTING THE DEFICIT)' + WS +
    r'(?P<desire>(?P<we>WE) DO NOT WANT TO INFLATE OUR WAY OUT OF DEBT)' + TAIL
)


def _evidence(body, match, group):
    start, end = match.span(group)
    return Evidence(start, end, body[start:end])


def parse(body):
    """Parse the full body or raise an explicit unsupported reason.

    No event ID, source URL, title or source-policy input can grant support.
    A successful parse proves grammar coverage, not source truth/eligibility.
    """
    if (type(body) is not str or not 1 <= len(body) <= MAX_INPUT
            or re.search(r'[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]', body)):
        fail(UNSUPPORTED)
    sha = hashlib.sha256(body.encode('utf-8')).hexdigest()
    match = FINANCING.fullmatch(body)
    if match:
        ev = lambda name: _evidence(body, match, name)
        actor = lambda name, kind: Actor(match[name], kind, ev(name))
        amount = lambda name, role: Amount(role, match[name + '_n'], ev(name + '_amount'))
        arranger = actor('arranger', 'organization-literal')
        assembly = Claim('assembly', ev('assembly'), (), arranger,
                         'assemble-financing-for-purchases', 'assembling', 'positive', 'present-progressive')
        package = Claim('components', ev('package'), (ev('assembly'),), actor('package_subject', 'package-reference'),
                        'package-includes-debt-components', 'reported-composition', 'positive', 'present')
        participant = actor('participant', 'ticker-literal')
        commitment = Claim('expected-commitment', ev('participation'), (ev('assembly'),), participant,
                           'commit-itself', 'expected', 'positive', 'prospective')
        syndication = Claim('expected-syndication', ev('participation'), (ev('assembly'),), participant,
                            'syndicate-the-rest', 'expected', 'positive', 'prospective')
        return FinancingReport(body, sha, 'financing-package', assembly, ev('ticker'),
            (actor('customer', 'organization-literal'), actor('others', 'group-literal')),
            (ev('chip'), ev('infrastructure')),
            Amount('package-total', match['total_n'], ev('total'), True, ev('approx')), package,
            (DebtComponent(amount('senior', 'senior-debt'), 'senior', 'secured', None, ev('senior')),
             DebtComponent(amount('junior', 'junior-debt'), 'junior', None, actor('leader', 'organization-literal'), ev('junior'))),
            Participation(commitment, amount('commit', 'expected-own-commitment'), syndication, ev('rest')),
            ev('url') if match['url'] else None)
    match = POLICY.fullmatch(body)
    if match:
        ev = lambda name: _evidence(body, match, name)
        speaker = Actor(match['speaker'], 'source-speaker-literal', ev('speaker'))
        header = ev('header')
        claims = tuple(Claim(key, ev(group), (header,), Actor(match[subject], kind, ev(subject)),
                             predicate, modality, polarity, tense)
            for key, group, subject, kind, predicate, modality, polarity, tense in (
                ('assessment', 'assessment', 'report', 'report-literal', 'approximately-as-expected', 'assessment', 'positive', 'past'),
                ('commitment', 'commitment', 'president', 'office-literal', 'cut-deficit', 'committed', 'positive', 'present'),
                ('desire', 'desire', 'we', 'unresolved-first-person-plural', 'inflate-way-out-of-debt', 'desire', 'negative', 'present')))
        return PolicyReport(body, sha, 'attributed-policy-statements', speaker, header, claims,
                            'approximate', None, None, None, ev('url') if match['url'] else None)
    fail(UNSUPPORTED)


def _identical(left, right):
    """Do not equate True, 1 and 1.0 in exact typed source bindings."""
    if type(left) is not type(right):
        return False
    if is_dataclass(left):
        return all(_identical(getattr(left, f.name), getattr(right, f.name)) for f in fields(left))
    if isinstance(left, dict):
        return left.keys() == right.keys() and all(_identical(left[k], right[k]) for k in left)
    if isinstance(left, (list, tuple)):
        return len(left) == len(right) and all(_identical(a, b) for a, b in zip(left, right))
    return left == right


def _display(amount, language):
    # String/integer scaling, with no float rounding or decimal-context effects.
    whole, _, fraction = amount.billion_usd.partition('.')
    digits = str(int(whole + fraction) * (10 if language == 'ja' else 1))
    places = len(fraction)
    if places:
        digits = digits.zfill(places + 1)
        digits = (digits[:-places] + '.' + digits[-places:]).rstrip('0').rstrip('.')
    return digits + '億ドル' if language == 'ja' else '$' + digits + ' billion'


def _fact(key, ja, en, evidence, context):
    return {'key': key, 'ja': ja, 'en': en, 'claimEvidence': asdict(evidence),
            'contextEvidence': [asdict(item) for item in context]}


def render(report):
    """Render only an unmodified typed parse; never authorize arbitrary prose."""
    if type(report) not in (FinancingReport, PolicyReport):
        fail('invalid-financing-policy-binding')
    try:
        current = parse(report.body)
    except FinancingPolicyError:
        fail('invalid-financing-policy-binding')
    if not _identical(report, current):
        fail('invalid-financing-policy-binding')
    if type(report) is FinancingReport:
        total, senior, junior = report.total, report.components[0].amount, report.components[1].amount
        own = report.participation.amount
        claims = (report.assembly, report.package, report.participation.commitment)
        pairs = (
            (f'報道によると、Broadcomは、Anthropicやその他のAI顧客のチップ・インフラ購入を支えるため、約{_display(total,"ja")}の資金調達パッケージを組成している。',
             f'The report says Broadcom is putting together about {_display(total,"en")} in financing for chip and infrastructure purchases by Anthropic and other AI customers.'),
            (f'このパッケージには、{_display(senior,"ja")}の担保付きシニア債務と、Blackstoneが主導する{_display(junior,"ja")}のジュニア債務が含まれると報じられている。',
             f'The report says the package contains {_display(senior,"en")} of senior-secured debt, alongside {_display(junior,"en")} of junior debt led by Blackstone.'),
            (f'報道によると、$BXは{_display(own,"ja")}の拠出に自らコミットし、残りをシンジケートする見込みとされる。',
             f'The report says $BX is expected to commit {_display(own,"en")} itself and syndicate the rest.'),
        )
        title_ja = f'報道：Broadcom、AI顧客の購入支援へ約{_display(total,"ja")}の資金調達を組成中'
        title_en = f'Reported: Broadcom assembling roughly {_display(total,"en")} in financing for AI customers'
        title_evidence, context = (report.assembly.evidence,), ()
    else:
        claims = report.claims
        pairs = (
            ('報道によると、ホワイトハウスのハセット氏は、今回の雇用報告はおおむね予想通りだったと述べた。',
             'The report says the White House’s Hassett characterized this jobs report as broadly in line with expectations.'),
            ('報道によると、ホワイトハウスのハセット氏は、大統領が財政赤字の削減にコミットしていると述べた。',
             'The report says the White House’s Hassett said the president is committed to reducing the deficit.'),
            ('報道によると、ホワイトハウスのハセット氏は「我々はインフレで債務から抜け出すことを望んでいない」と述べた。',
             'The report says the White House’s Hassett said, “We do not want to inflate our way out of debt.”'),
        )
        title_ja = '報道：ホワイトハウスのハセット氏、雇用報告はおおむね予想通りと発言'
        title_en = 'Reported: White House’s Hassett says jobs report was broadly as expected'
        title_evidence, context = (report.header, claims[0].evidence), (report.header,)
    return {'grammarVersion': VERSION, 'kind': report.kind, 'bodySha': report.body_sha,
            'titleJa': title_ja, 'titleEn': title_en,
            'titleEvidence': [asdict(e) for e in title_evidence],
            'facts': [_fact(claim.key, ja, en, claim.evidence, claim.context)
                      for claim, (ja, en) in zip(claims, pairs)],
            'contextOnly': [asdict(e) for e in context],
            'trailingUrl': asdict(report.trailing_url) if report.trailing_url else None}


def derive(body):
    return render(parse(body))


def validate_rendered(body, candidate):
    """Compare all copy, keys, types and spans with fresh full-body derivation."""
    expected = derive(body)
    if not _identical(candidate, expected):
        fail('changed-financing-policy-copy')
    return candidate
