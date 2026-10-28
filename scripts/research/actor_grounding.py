"""Bounded actor/status checks for newly admitted reporter-led source units.

This is a conservative publication grammar, not a general semantic verifier.
Unrecognized source syntax still receives assessment, but cannot auto-publish.
The original evidence remains intact; only an exactly scoped claim is rewritten.
"""
import re


REPORTING = r'(?:says|said|reports|reported)'
NESTED = re.compile(
    r'\b(?:but|while|whereas|although|unless|if|because|despite|according|'
    r'says?|said|reports?|reported|denies?|denied|claims?|claimed|'
    r'confirms?|confirmed|asserts?|asserted|suggests?|suggested|'
    r'watch\w*|observ\w*|monitor\w*|hear\w*|learn\w*|discover\w*|saw|seen|sees|knows?|knew|'
    r'which|whose|who|whom|where|when|whether|that)\b', re.I)
ROLE_PATTERNS = {
    'leader': (r'\b(?:CEO|CFO|executives?|presidents?|founders?|chief\w*|leaders?|boss(?:es)?|entrepreneurs?)\b', r'CEO|CFO|社長|経営者|創業者|起業家|最高\S{0,8}責任者'),
    'employee': (r'\b(?:employ\w*|staff|workers?|engineers?|members?|teams?|personnel|hire\w*|hiring|recruit\w*|payroll|workplace)\b|\bworks? (?:at|for)\b', r'社員|従業員|職員|エンジニア|スタッフ|チーム|雇|採用|勤務|所属|在籍|勤め|働'),
    'representative': (r'\b(?:representatives?|spokespersons?|spokesmen|advis[oe]rs?|directors?)\b', r'代表者|広報担当|報道官|顧問|取締役'),
    'investor': (r'\b(?:shareholders?|investors?|owners?)\b', r'株主|投資家|所有者'),
    'customer': (r'\bcustomers?\b|\bclients?\b', r'顧客|取引先'),
    'supplier': (r'\bsuppliers?\b|\bvendors?\b', r'供給業者|サプライヤー|納入業者'),
    'partner': (r'\bpartners?\b|\baffiliates?\b', r'提携先|協業先|パートナー|関連会社'),
}
STATUS_PATTERNS = {
    'talks': (r'\b(?:talks|discuss\w*|negotiat\w*|explor\w*)\b', r'協議|交渉|話し合|模索'),
    'possible': (r'\b(?:possible|potential|possibly|perhaps|may|might|could|would|consider\w*)\b', r'可能性|かもしれ|検討'),
    'planned': (r'\b(?:will|plans?|planning|intends?|aims?|expects?|scheduled)\b|\bset to\b', r'予定|計画|意向|方針|見込|見通|予想'),
    'agreed': (r'\b(?:agreed|agrees|committed|commits)\b|\breached an? agreement\b', r'合意(?:した|して|済|に達)|確約'),
    'signed': (r'\b(?:signed|signs)\b|\b(?:entered|enters)\s+(?:into\s+)?(?:an?\s+)?(?:agreement|contract)\b', r'(?:締結|調印|署名)(?:した|している|していた|しており|済み?|[。！？]|$)'),
    'completed': (r'\b(?:completed|closed|finalized|finalised|executed|concluded)\b', r'(?:完了|実行|成立|完結)(?:した|している|していた|しており|済み?|[。！？]|$)'),
}
VERB_HEAD = re.compile(r'^(?:is|are|was|were|has|have|had|will|may|might|could|would|can|does|did|[a-z]+(?:s|ed))\b')
NOUN_HEAD = re.compile(r'^(?:shares|stocks|products|devices|chips|samples|contracts|agreements|partners|employees|customers|suppliers|members|executives|logos?|signs?|branding|names?|CEO|CFO)\b', re.I)
OTHER_ACTOR = re.compile(
    r'\b(?:other|another|different|unrelated)\s+(?:\w+\s+){0,2}'
    r'(?:company|business|firm|manufacturer|laboratory|startup|person|entrepreneur|supplier)\b|'
    r'\b(?:shipped|built|made|manufactured|provided|sent|produced|owned|operated|developed)\s+(?:by|from|at|for)\b', re.I)


def _alias_pattern(aliases):
    return '(?:' + '|'.join(re.escape(a) for a in sorted(aliases, key=len, reverse=True) if a) + ')'


def _subject(text, ticker, aliases, language):
    pattern = _alias_pattern(aliases)
    if language == 'ja':
        match = re.match(r'^' + pattern + r'(?:\s*\$' + re.escape(ticker) + r')?\s*(?:は|が)', text, re.I)
    else:
        match = re.match(r'^' + pattern + r'(?![A-Za-z0-9_])(?:\s+\$' + re.escape(ticker) + r'(?![\w.]))?\s+', text, re.I)
    return text[match.end():].strip() if match else None


def _signals(text, patterns, language):
    return {key for key, pair in patterns.items() if re.search(pair[language == 'ja'], text, re.I)}


def _stages(text, language):
    return _signals(text, STATUS_PATTERNS, language)


def _single_scope(tail, language):
    """Do not guess nested subjects, quotation scope, or cross-clause binding."""
    core = tail.rstrip('.。!?！？').strip()
    if not core or re.search(r'[;；\n“”"「」]|(?<!\d)[.!?。！？](?!\d)', core):
        return False
    if language == 'en':
        if not VERB_HEAD.match(core) or NOUN_HEAD.match(core) or NESTED.search(core) or OTHER_ACTOR.search(core):
            return False
        # Extra proper names, passive agents, and independent subject clauses
        # need relationship binding that this intentionally small grammar lacks.
        if re.search(r'\b[A-Z][A-Za-z0-9_-]*\b|\b(?:by|he|she|him|her|his|they|them|their)\b|\b(?:and|or)\s+(?:it|the company|[A-Z][a-z])\b', core):
            return False
    else:
        if re.search(r'によると|と(?:述べ|語|話し|説明し|報告し)|一方|しかし|ものの|だが|けれど|ものと|によって|他社|別の会社|第三者|同氏|同人|その人|彼女|彼|氏|さん', core):
            return False
        # A second explicit topic/subject is outside the supported clause shape.
        cleaned = re.sub(r'可能性が|ことが|方針は|見通しは', '', core)
        if re.search(r'[はが]', cleaned):
            return False
    return True


def _attribution(label, aliases):
    if not label or len(label) > 100 or re.search(r'[\n:;!?“”"「」]|\b(?:not|never|denies?|denied|false|claims?|claimed|but|while|if|unless)\b', label, re.I):
        return False
    # A literal name or report label, without trying to infer employment.
    return bool(re.fullmatch(r"[A-Za-z][A-Za-z0-9 .'’\-]*", label))


def _attribution_ja(label):
    for role, translated in (('Reporter', '記者'), ('Entrepreneur', '起業家'),
                             ('Researcher', '研究者')):
        match = re.fullmatch(role + r'\s+(.+)', label, re.I)
        if match:
            return translated + match[1]
    match = re.fullmatch(r'(?:a |the )?field report by (.+)', label, re.I)
    return match[1] + 'の現地報告' if match else label


def derive(quote, ticker, aliases):
    """Return a whole-unit, source-bound claim scope or a review-only result."""
    unsupported = {'supported': False, 'claimScope': '', 'attribution': '',
                   'reason': 'actor-grounding-required'}
    if not isinstance(quote, str) or not aliases:
        return unsupported
    text = quote.strip()
    claim, attribution = text, ''
    if _subject(claim, ticker, aliases, 'en') is None:
        match = re.fullmatch(r'According to (.{1,100}?),\s*(.+)', text, re.I)
        if match:
            attribution, claim = match.groups()
        else:
            match = re.fullmatch(r'(.{1,100}?)\s+' + REPORTING + r'\s+(?:that\s+)?(.+)', text, re.I)
            if not match:
                return unsupported
            attribution, claim = match.groups()
        if not _attribution(attribution, aliases):
            return unsupported
    tail = _subject(claim, ticker, aliases, 'en')
    if tail is None or not _single_scope(tail, 'en'):
        return unsupported
    stages = _stages(tail, 'en')
    # Talks plus potential is one tentative stage. Other mixed stages may refer
    # to distinct actions, past contracts, or conditional completion.
    if len(stages) > 1 and not stages <= {'talks', 'possible'}:
        return unsupported
    if any(re.search(pair[0], tail, re.I) for key, pair in ROLE_PATTERNS.items()
           if key not in {'customer', 'supplier'}):
        return unsupported
    end = len(quote.rstrip())
    start = end - len(claim)
    if quote[start:end] != claim:
        return unsupported
    return {'supported': True, 'claimScope': claim, 'attribution': attribution,
            'claimStart': start, 'claimEnd': end,
            'attributionJa': _attribution_ja(attribution)}


def _affiliations(text, language):
    """Detect role assertions, separately from objects such as 'customers'."""
    result = set()
    for key, pair in ROLE_PATTERNS.items():
        role = pair[language == 'ja']
        relation = (r'(?:' + role + r')(?:で(?:ある|あり|す)|だ|として|とな|にな|に就|を務め)' if language == 'ja'
                    else r'\b(?:is|was|as|became|become|been)\s+(?:(?:an?|the)\s+)?(?:\w+\s+){0,2}(?:' + role + r')')
        if re.search(relation, text, re.I):
            result.add(key)
    return result


def validate(item, grounding, ticker, aliases):
    """Validate constrained paraphrases; never trust model-provided actor maps."""
    if not isinstance(grounding, dict) or grounding.get('supported') is not True:
        raise ValueError('actor-grounding-required')
    claim, attribution = grounding.get('claimScope'), grounding.get('attribution')
    if not isinstance(claim, str) or not isinstance(attribution, str):
        raise ValueError('actor-grounding-required')
    source_tail = _subject(claim, ticker, aliases, 'en')
    if source_tail is None or not _single_scope(source_tail, 'en'):
        raise ValueError('actor-grounding-required')
    source_roles = _signals(claim, ROLE_PATTERNS, 'en')
    source_affiliations = _affiliations(claim, 'en')
    source_stages = _stages(source_tail, 'en')
    speaker_words = [word for word in re.findall(r"[A-Za-z][A-Za-z'’-]{2,}", attribution)
                     if not re.search(r'\b' + re.escape(word) + r'\b', claim, re.I)]
    for language in ('en', 'ja'):
        text = item.get(language) if isinstance(item, dict) else None
        if not isinstance(text, str):
            raise ValueError('changed-claim-actor')
        if _signals(text, ROLE_PATTERNS, language) - source_roles or _affiliations(text, language) - source_affiliations:
            raise ValueError('unsupported-affiliation')
        if any(re.search(r'(?<![A-Za-z])' + re.escape(word) + r'(?![A-Za-z])', text, re.I) for word in speaker_words):
            raise ValueError('changed-source-attribution')
        tail = _subject(text.strip(), ticker, aliases, language)
        if tail is None or not _single_scope(tail, language):
            raise ValueError('changed-claim-actor')
        if language == 'ja' and any(not re.search(r'(?<![A-Za-z0-9_])' + re.escape(word) + r'(?![A-Za-z0-9_])', claim, re.I)
                                    for word in re.findall(r'(?<![A-Za-z0-9_])[A-Z][A-Za-z0-9_-]*(?![A-Za-z0-9_])', tail)):
            raise ValueError('changed-claim-actor')
        if _stages(tail, language) != source_stages:
            raise ValueError('changed-claim-status')
