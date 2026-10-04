"""Preserve explicit rollout stage and distinguish it from support removal."""
import re

FAILURE='changed-rollout-status'
MONTHS='January|February|March|April|May|June|July|August|September|October|November|December'


def compact(text):
    # These product-surface nouns are translations, not inferred affiliations.
    text=re.sub(r'チャット','chat',text,flags=re.I)
    return re.sub(r'\s+','',text).casefold()


def source_context(body):
    """Immutable source-only relations, local to one complete validation."""
    active=re.findall(r'\b(?:today|starting today)[^.!?\n]{0,45}?\brolling out\b'
                      r'[^.!?\n]{0,70}?\b(?:into|in|to)\s+([A-Z][A-Za-z0-9 -]{1,45}?)\s+globally\b',body,re.I)
    later_audiences=re.findall(r'\bbringing this functionality to\s+(?:Google\s+)?([A-Z][A-Za-z0-9-]+)'
                              r'[^.!?\n]{0,100}\bcustomers in the coming weeks\b',body)
    removals=[]
    for match in re.finditer(r'\bremove support for\s+([A-Z][A-Za-z0-9 -]{1,35}?)\s+starting in\s+('
                             +MONTHS+r')\b',body,re.I):
        product,month=match.groups()
        relation=(r'\breplac(?:e|es|ed|ing)\s+'+re.escape(product)+r'\s+(?:starting|beginning|from|in)\s+'
                  +re.escape(month)+r'\b')
        if not re.search(relation,body,re.I):removals.append((product,month,relation))
    return body,tuple(active),tuple(later_audiences),tuple(removals)


def validate(text,body,context=None):
    """Bind the same source relations; no context survives a validate call.

    A context from another body is never reused, even for a matching product.
    """
    if context is None or context[0]!=body:context=source_context(body)
    _,active,later_audiences,removals=context
    for surface in active:
        for clause in re.split(r'[.!?。！？;；\n,、]|\b(?:and|while|whereas|but)\b',text,flags=re.I):
            if compact(surface) not in compact(clause):continue
            if not re.search(r'\b(?:globally|worldwide)\b|全世界|世界中|グローバル',clause,re.I):continue
            future=re.search(r'\b(?:will\s+(?:soon\s+)?(?:be|become|roll|launch|replace)|coming weeks|not yet|later)\b|'
                             r'まもなく|今後|予定|後日|これから',clause,re.I)
            action=re.search(r'\b(?:roll(?:ing)? out|availab\w*|offer\w*|introduc\w*|launch\w*|replac\w*)\b|'
                             r'提供|導入|展開|代わ|置き換',clause,re.I)
            if future and action:
                # The later audience must qualify this claim explicitly. A
                # bare brand mention elsewhere never excuses a global delay.
                audience_scoped=any(re.search(r'\bfor\s+(?:Google\s+)?'+re.escape(audience)
                    +r'(?:\s+(?:business|enterprise|education|nonprofit|and|or|,)){0,6}\s+(?:customers|users)\b|'
                    +re.escape(audience)+r'(?:の)?(?:利用者|ユーザー|顧客)?(?:向け|には)',clause,re.I)
                    for audience in later_audiences)
                if not audience_scoped:raise ValueError(FAILURE)
    for product,month,relation in removals:
        if re.search(relation,text,re.I):raise ValueError(FAILURE)
        number=MONTHS.split('|').index(month.title())+1
        if re.search(str(number)+r'月(?:から|に)[^。;；\n]{0,25}'+re.escape(product)+r'(?:に|を)(?:代わ|置き換)',text,re.I):
            raise ValueError(FAILURE)
