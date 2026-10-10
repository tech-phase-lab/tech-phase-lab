"""Relate recap authorization context using already-public, current source copy.

No fetch, model call, writes, or hard-coded issuer/post IDs. The X post remains
its own evidence; an issuer release is never required to admit an X report.
"""
import re
from datetime import datetime

import amount_relations
import buyback_news


def authorization_signature(text):
    if not isinstance(text,str):return None
    roles=buyback_news.roles(text,'en')
    authorization=set(roles.get('authorization',[]));remaining=set(roles.get('remaining',[]))
    increments={buyback_news.quantity_value(match[0]) for match in buyback_news.QUANTITY.finditer(text)
                if any((currency,value)==amount_relations.money_value(match[0]) and relation=='increment'
                       for currency,value,relation in amount_relations.monetary_relations(text))
                if re.search(r'\$|USD|EUR|GBP|JPY|€|£|¥|ドル|円',match[0],re.I)}
    if len(authorization)!=1 or len(remaining)!=1 or authorization!=increments:return None
    return tuple(sorted(authorization)),tuple(sorted(remaining))


def published_context(db,reference):
    import signals
    import official_release_bridge
    # An explicit source list excludes the general-news extension and avoids
    # recursive assessment; only revalidated public issuer bodies are evidence.
    sources=[*signals.SOURCES,*official_release_bridge.publishers()]
    headlines=signals.public_official_updates(db,sources=sources,reference=reference,limit=100,
                                              read_only=True,include_bodies=False)
    # Preserve the metadata-only read optimization: only buyback releases can
    # supply authorization context, so unrelated full articles are never parsed.
    import official_research
    items=[]
    for item in headlines:
        if not buyback_news.CUE.search(item['title']):continue
        event=db.execute('SELECT * FROM signal_events WHERE id=? AND url=?',
                         (item['id'],item['url'])).fetchone()
        if event is None:continue
        body=official_research.public_story_body(db,event)
        if body.get('bodyJa') and body.get('bodyEn'):items.append({**item,**body})
    return items


def from_published(items):
    """Use this invocation's complete issuer projection, before extensions.

    The caller must preserve the exact first-100 eligible issuer boundary and
    have already requested body validation. No result survives the request.
    """
    return [item for item in items[:100] if buyback_news.CUE.search(item['title'])
            and item.get('bodyJa') and item.get('bodyEn')]


def relate(row,items):
    if row.get('category')!='share-buyback' or not any(u['buyback'].get('historical') for u in row['units']):
        return row,'eligible-buyback'
    linked=[];kept=[]
    for unit in row['units']:
        signature=authorization_signature(unit['quote']) if unit['buyback'].get('status')=='authorization' else None
        if not signature or buyback_news.EXECUTED.search(unit['quote']):
            kept.append(unit);continue
        import signals
        aliases='|'.join(re.escape(alias) for alias in sorted(signals.ALIASES.get(row['ticker'],[]),key=len,reverse=True))
        issuer_action=re.compile(r'^(?:'+aliases+r')(?:[’\']s)?(?:\s+(?:board(?: of directors)?))?\s+(?:has\s+)?(?:authorized|approved|increased|raised|expanded)\b',re.I)
        matches=[]
        for item in items:
            at=item.get('publishedOn') or item.get('publishedAt','')[:10]
            # A date-only source cannot prove ordering within the same day.
            try:
                report_at=datetime.fromisoformat(row['published_at'].replace('Z','+00:00'))
                prior=(datetime.fromisoformat(item['publishedAt'].replace('Z','+00:00'))<=report_at
                       if item.get('publishedAt') else at<report_at.date().isoformat())
            except (ValueError,TypeError,KeyError):prior=False
            if (item.get('tickers')!=[row['ticker']] or not re.fullmatch(r'\d{4}-\d{2}-\d{2}',at)
                    or not prior or not item.get('bodyJa') or not item.get('bodyEn')
                    or not buyback_news.CUE.search(item['bodyEn']) or not issuer_action.match(item['bodyEn'])
                    or re.search(r'\b(?:cancelled|canceled|cancellation|withdrawn|withdrew|revoked|rescinded|retracted|denied|not|never|no longer)\b',item['bodyEn'],re.I)
                    or authorization_signature(item['bodyEn'])!=signature):continue
            date=unit['buyback'].get('eventDate')
            if date and date!=at:continue
            matches.append({key:item[key] for key in ('id','url','publisher')}
                           | {'publishedOn':at,'authorizationSignature':signature})
        # Multiple dated authorizations with the same sums remain ambiguous.
        if not matches or len({item['publishedOn'] for item in matches})!=1:
            kept.append(unit);continue
        linked.append({**sorted(matches,key=lambda item:(item['publishedOn'],item['id']))[0],'unitId':unit['id']})
    if not linked:return row,'eligible-buyback-recap'
    if not kept:return None,'covered-buyback-authorization'
    # Keep generation/validation units invariant as prior publications arrive
    # or change. Deduplication affects projection only, never evidence shape.
    return {**row,'related_authorizations':linked},'eligible-buyback-recap'
