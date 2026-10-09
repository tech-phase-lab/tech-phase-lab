"""Ticker-independent source-news anchors; no external identity inference.

These are conservative contradiction guards, not a general entailment oracle.
Materiality remains a bounded semantic decision using complete source units.
"""
import re

import actor_grounding

FAILURE = 'changed-source-news-claim'
CONDITION_FAILURE = 'unproven-source-condition'
RELATION_FAILURE = 'unproven-source-relation'
POLICY = """These are source news units. Company/ticker association is optional enrichment and never establishes the actor or materiality. Assess business, technology, or industry news using the full supplied source. An untracked or privately held subject may be material. Preserve literal entity names, the actor of each action, affiliations, all amounts and dates, conditions, negation and planned/completed/expected status in BOTH languages. Do not replace an untracked actor with a tracked investor/customer/counterparty. Each unit must stand on its own. Start both languages with sourceNews.actor when supplied. Preserve the source entity names literally rather than inventing translations. Return review for unsupported claims, promotion, trivia, speculation without a reported development, price-only commentary, or insufficient evidence. No company mapping is required to publish."""
NAME = r"[A-Z][A-Za-z0-9]*(?:[ &'’\-][A-Z][A-Za-z0-9]*){0,4}"
LEAD = re.compile(r'^(?:Note:\s*)?('+NAME+r')(?:\s+\$[A-Z][A-Z0-9.\-]{0,9})?\s+(?=(?:is|are|has|have|was|were|does|did|get|gets|got|getting|will|may|might|could|plans?|intends?|announced|unveiled|introduced|launched|released|signed|acquired|purchased|bought|began|expects?)\b)')
IGNORED = frozenset({'The','A','An','Note','It','Its','This','That','These','Those','According','In','On','At','For','By','With','From','To','After','Before','However','Meanwhile','But','And'})
# An announcement or introduction does not establish release or availability.
# Topic cues include infinitives so a planned release stays a product topic;
# only completed forms below establish a completed action stage.
ANNOUNCEMENT_JA = r'(?:発表|披露|紹介)'
RELEASE_JA = r'(?:公開|発売|投入|提供(?:を)?開始)'
# Only a declarative ending proves completion here. Desire, advice, reported
# uncertainty and questions need their own supported relation, not a prefix.
COMPLETED_JA = r'(?:した|済み?(?:だ|である)?|している|された|されている)(?=[。.!！]|\s*$)'
# A made...available word bag cannot establish which actor made which object
# available (it also matches "made a presentation about available models").
# Keep this unproven relation closed in source and copy; do not normalize it.
UNPROVEN_AVAILABILITY = re.compile(r'\bmade\b[^.!?;\n]*\bavailable\b', re.I)
ACTION_TOPICS = (
    r'\b(?:announce[ds]?|unveil(?:ed|s)?|introduce[ds]?|release[ds]?|launch(?:ed|es)?)\b',
    ANNOUNCEMENT_JA+'|'+RELEASE_JA,
)
STAGES = {
    'planned': (r'\b(?:preparing|plans?|planning|intends?|will|scheduled)\b', r'準備|計画|意向|予定|方針'),
    'expected': (r'\b(?:expected|expects?|anticipated|forecast\w*)\b', r'見込|予想|予測|見通|期待'),
    'possible': (r'\b(?:may|might|could|possible|potential)\b', r'可能性|かもしれ|検討'),
    'signed': (r'\b(?:signed|signs)\b', r'締結|署名|調印'),
    'announced': (r'\b(?:announced|unveiled|introduced)\b', ANNOUNCEMENT_JA+COMPLETED_JA),
    'released': (r'\b(?:released|launched)\b', RELEASE_JA+COMPLETED_JA),
}
CONDITIONS = (r'\b(?:if|unless|subject to|conditional on|pending|following approval)\b', r'場合|なら|条件|承認.*(?:後|待)|承認を経')


def action_topic(text, language):
    """Product action topic only; status and relation guards still apply."""
    return bool(re.search(ACTION_TOPICS[language == 'ja'], text, re.I))


def condition(text, language):
    """One explicitly bound permit condition, not a bag of condition words.

    Unknown predicates/operators remain private. This does not try to prove
    arbitrary condition equivalence or normalize double negation.
    """
    if language == 'en':
        cues=list(re.finditer(CONDITIONS[0],text,re.I))
        if not cues:return None
        if len(cues)!=1:raise ValueError(CONDITION_FAILURE)
        cue=cues[0]
        if cue[0].lower() not in {'if','unless','subject to','conditional on'}:
            raise ValueError(CONDITION_FAILURE)
        tail=text[cue.end():].strip().rstrip('.').strip()
        predicates={
            'approved': r'(?:the )?permits? (?:is|are) (?:approved|granted)|permit approval|approval of (?:the )?permits?',
            'denied': r'(?:the )?permits? (?:is|are) (?:denied|rejected)|permit (?:denial|rejection)|(?:denial|rejection) of (?:the )?permits?',
        }
        status=next((key for key,pattern in predicates.items() if re.fullmatch(pattern,tail,re.I)),None)
        if status is None:raise ValueError(CONDITION_FAILURE)
        return ('unless' if cue[0].lower()=='unless' else 'if', 'permit', status)
    # Keep the supported Japanese condition at the end of the complete claim;
    # other condition syntax is not silently reinterpreted.
    cue=bool(re.search(CONDITIONS[1]+r'|限り|限って|待ち|待って',text))
    if not cue:return None
    patterns={
        ('if','permit','approved'): r'許可(?:の取得|の承認|を得ること|が下りること|が得られること)を条件(?:としている|とする|とした計画だ|にしている)?[。.]?$',
        ('if','permit','denied'): r'許可(?:の却下|の拒否|が却下されること|が拒否されること)を条件(?:としている|とする|とした計画だ|にしている)?[。.]?$',
        ('unless','permit','approved'): r'許可(?:が下りない|が得られない|を得ない)限り(?:の計画だ)?[。.]?$',
        ('unless','permit','denied'): r'許可(?:が却下されない|が拒否されない)限り(?:の計画だ)?[。.]?$',
    }
    found=[key for key,pattern in patterns.items() if re.search(pattern,text)]
    if len(found)!=1:raise ValueError(CONDITION_FAILURE)
    return found[0]


# Recognize unsupported count spellings too, so they cannot evade binding by
# disappearing into an empty match. Only the narrower _COUNT forms below are
# accepted; ambiguous/abbreviated/scientific counts remain review.
_QUANTITY_WORD = r'(?:zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|thousand|million|billion|trillion|dozen)(?:s)?(?:-[A-Za-z]+)*'
_QUANTITY_TOKEN = r'(?:(?:\d+(?:\.\d*)?|\.\d+)(?:/\d+)?(?:[-A-Za-z]+\d*)?|' + _QUANTITY_WORD + r')'
QUANTITY_NOUN = re.compile(r'(?<![\w.])' + _QUANTITY_TOKEN + r'\s+([A-Za-z][A-Za-z-]*)\b', re.I)
COUNTED_OBJECTS = {
    'factory': (r'factories|factory', r'工場'),
    'laboratory': (r'laboratories|laboratory|labs|lab', r'研究所|研究室'),
    'model': (r'models|model', r'モデル'),
}
_COUNT_WORDS = dict(zip(('one','two','three','four','five','six','seven','eight','nine','ten'), range(1,11)))
_COUNT = r'(?:\d+|one|two|three|four|five|six|seven|eight|nine|ten)'
_YEAR_CONNECTOR = frozenset({'if','unless','and','or','subject','conditional','pending','with','at','in','on','for','when','following','before','after'})
# These are quantities/units, not object nouns. Their existing numeric and
# factual guards remain responsible; this helper makes no new claim about them.
_SCALES = frozenset({'billion','million','thousand','trillion'})
_NON_OBJECT_MEASURES = frozenset({'percent','percentage',
    'dollars','dollar','yen','euros','euro','hours','hour','days','day','years','year','months','month',
    'second','seconds','minute','minutes','week','weeks',
    'watt','watts','kilowatt','kilowatts','megawatt','megawatts','gigawatt','gigawatts','kw','mw','gw'})


def counted_objects(text, language):
    """Bind a closed counted noun phrase, including supported modifiers.

    A number followed by an unknown English object grammar cannot quietly
    become an empty binding. Other numeric measures stay with existing guards.
    This deliberately supports only factory/laboratory/model object phrases;
    unknown adjectives, compound heads or object categories remain review.
    """
    found=[]
    if language == 'en':
        # Vulgar fractions, superscripts and other non-decimal numerals are
        # outside this grammar, rather than uncounted words. Japanese kanji
        # prose is not subjected to this English token check.
        if any(char.isnumeric() and not char.isdecimal() for char in text):
            raise ValueError(RELATION_FAILURE)
        for quantity in QUANTITY_NOUN.finditer(text):
            raw=quantity[0].split()[0].lower()
            following=quantity[1].lower()
            if raw.isdigit() and 1900 <= int(raw) <= 2199 and following in _YEAR_CONNECTOR:
                continue
            if following in _SCALES:
                prefix=text[:quantity.start()].rstrip()
                after_scale=text[quantity.end():].lstrip()
                if prefix.endswith(('$','€','£','¥')) or re.match(r'(?:dollars?|yen|euros?|pounds?)\b',after_scale,re.I):
                    continue
                # A scale followed by an object is still an object count.
                # Its unsupported compound quantity must not disappear.
                raise ValueError(RELATION_FAILURE)
            if following in _NON_OBJECT_MEASURES:
                continue
            if raw not in _COUNT_WORDS and not raw.isdigit():
                raise ValueError(RELATION_FAILURE)
            value=_COUNT_WORDS[raw] if raw in _COUNT_WORDS else int(raw)
            tail=text[quantity.start():]
            matches=[]
            for kind,(en,_) in COUNTED_OBJECTS.items():
                match=re.match(r'('+_COUNT+r')\s+(?P<new>new\s+)?(?P<ai>AI\s+)?(?:'+en+r')\b',tail,re.I)
                if match:
                    post_ai=(re.match(r'\s+using\s+AI\b',tail[match.end():],re.I)
                             if kind == 'model' else None)
                    phrase_end=match.end()+(post_ai.end() if post_ai else 0)
                    tail_after=tail[phrase_end:].lstrip()
                    if tail_after and not (
                            re.fullmatch(r'[.!?]',tail_after)
                            or re.match(r'(?:in|for|with|to|at|on|if|unless|subject|conditional|pending|after|before|by|from|during|using)\b',tail_after,re.I)
                            or re.match(r',[ \t]*(?:if|unless|subject|conditional)\b',tail_after,re.I)):
                        raise ValueError(RELATION_FAILURE)
                    # AI is a supported model modifier, not a generic claim
                    # that a factory or laboratory uses AI in some other role.
                    if match['ai'] and kind != 'model':
                        raise ValueError(RELATION_FAILURE)
                    matches.append((value,kind,bool(match['new']),bool(match['ai'] or post_ai)))
            if len(matches) != 1:
                raise ValueError(RELATION_FAILURE)
            found.extend(matches)
        return found
    for match in re.finditer(r'(?<![0-9A-Za-z_.])('+_COUNT+r')\s*(?:つの|個の|か所の|カ所の|施設の)?(?P<new>新しい|新たな|新規の)?(?P<ai>AI)?(?P<noun>工場|研究所|研究室|モデル)',text,re.I):
        tail_after=text[match.end():].lstrip()
        if tail_after and not (tail_after[0] in 'をはが' or re.fullmatch(r'[。.!！？]',tail_after)):
            raise ValueError(RELATION_FAILURE)
        raw=match[1].lower()
        value=_COUNT_WORDS[raw] if raw in _COUNT_WORDS else int(raw)
        kind=next(kind for kind,(_,ja) in COUNTED_OBJECTS.items() if re.fullmatch(ja,match['noun']))
        if match['ai'] and kind != 'model':
            raise ValueError(RELATION_FAILURE)
        found.append((value,kind,bool(match['new']),bool(match['ai'])))
    return found


def unsupported_auxiliary_role(text):
    """Closed generic predicate boundary, independent of an action vocabulary.

    The only be-auxiliary form supported here is an immediately expressed
    active progressive. Other be/get chains can carry passive or attributed
    roles, so they require a typed claim renderer rather than global flags.
    This intentionally holds unrecognized copular/auxiliary forms too.
    """
    scope=re.split(CONDITIONS[0],text,maxsplit=1,flags=re.I)[0]
    for auxiliary in re.finditer(r'\b(?:is|are|was|were|be|been|being|get|gets|got|getting)\b',scope,re.I):
        if (auxiliary[0].lower() in {'is','are','was','were'}
                and re.match(r'\s+[a-z]+ing\b',scope[auxiliary.end():],re.I)):
            continue
        return True
    # Reduced passive headlines can omit an auxiliary but name a by-agent.
    return bool(re.search(r'\bby\b',scope,re.I))


def relation_boundary(quote):
    """Known unsupported relation forms cannot use global bag-of-word guards."""
    if unsupported_auxiliary_role(quote) or UNPROVEN_AVAILABILITY.search(quote):
        raise ValueError(RELATION_FAILURE)
    if re.search(r';|(?<=[.!?])\s+(?=[A-Z])',quote):
        raise ValueError(RELATION_FAILURE)
    # The separately proven condition is not a second actor/action clause.
    scope=re.split(CONDITIONS[0],quote,maxsplit=1,flags=re.I)[0]
    # This generic lane has no per-predicate relation graph. Do not attempt
    # clause equivalence from global status/negation flags or adjacent names.
    # Coordinated object lists also remain private until explicitly supported.
    # A thousands separator (1,200 units) is not a clause or list boundary.
    if re.search(r'\b(?:and|or|but|while|whereas)\b|,',re.sub(r'(?<=\d),(?=\d{3}\b)','',scope).rstrip(' ,'),re.I):
        raise ValueError(RELATION_FAILURE)
    if re.search(r"\b(?:not|never|no|without|neither|nor)\b|n['’]t\b",quote,re.I):
        raise ValueError(RELATION_FAILURE)
    measures=[]
    for match in QUANTITY_NOUN.finditer(quote):
        # Calendar years before a connector are time anchors, not noun counts.
        if re.match(r'(?:19|20|21)\d{2}\s+',match[0]) and match[1].lower() in {'if','unless','and','or','subject','conditional','pending','with','at','in','on','for','when','following','before','after'}:
            continue
        measures.append(match[0])
    if len(measures)>1:raise ValueError(RELATION_FAILURE)


def literal_names(text):
    text=re.sub(r'\$[A-Z][A-Z0-9.\-]{0,9}(?![\w.])','',text)
    return list(dict.fromkeys(name for name in re.findall(r'(?<![A-Za-z0-9_])[A-Z][A-Za-z0-9]*(?![A-Za-z0-9_])',text) if name not in IGNORED))


def context(quote):
    lead = LEAD.match(quote)
    names = literal_names(quote)

    return {'actor': lead[1] if lead else None, 'literalNames': names}


def validate(item, quote, grounding):
    # The actor, when directly expressed, is bound to the source, not a ticker.
    actor = grounding['actor']
    names = grounding['literalNames']
    source_condition=condition(quote,'en')
    relation_boundary(quote)
    source_counts=counted_objects(quote,'en')
    source_stages = actor_grounding._signals(quote, STAGES, 'en')
    for lang in ('en', 'ja'):
        text = item.get(lang)
        if not isinstance(text, str):
            raise ValueError(FAILURE)
        if actor:
            prefix = re.escape(actor) + (r'(?:は|が|、)' if lang == 'ja' else r'(?:\s|,)')
            if not re.match(prefix, text):
                raise ValueError(FAILURE)
        # Literal source labels avoid guessing the identity of untracked names.
        output = literal_names(text)
        if output != names:
            raise ValueError(FAILURE)
        if actor_grounding._signals(text, STAGES, lang) != source_stages:
            raise ValueError('changed-claim-status')
        if condition(text,lang)!=source_condition:
            raise ValueError(CONDITION_FAILURE)
        if counted_objects(text,lang)!=source_counts:
            raise ValueError(RELATION_FAILURE)
        if ((unsupported_auxiliary_role(text) or UNPROVEN_AVAILABILITY.search(text)) if lang=='en'
                else re.search(r'され(?:た|る|て)|受け(?:た|る|て)',text)):
            raise ValueError(RELATION_FAILURE)
        negative=(r'\b(?:not|never|no(?!w))\b' if lang=='en' else r'ない|ず|未|なし|無い')
        if bool(re.search(r'\b(?:not|never|no(?!w))\b',quote,re.I)) != bool(re.search(negative,text,re.I)):
            raise ValueError('lost-negation')
        if actor_grounding._affiliations(text, lang) - actor_grounding._affiliations(quote, 'en'):
            raise ValueError('unsupported-affiliation')
