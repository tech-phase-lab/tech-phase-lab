"""Verified distributor body adapter for the existing issuer semantic publisher.

No generic host approval, fetching, new generation setting or additional quota.
The deterministic capacity adapter keeps priority. All proof is rechecked at
claim, commit and public read; source/publication clocks remain separate.
"""
from collections import Counter
from datetime import datetime, timezone
import json
import re

import issuer_syndication as syndication
import signals

POLICY='issuer-business-news-v1'
MAX_INPUT=32000
MATERIAL=re.compile(r'\b(?:contract|agreement|partnership|acqui(?:re|res|red|sition)|launch(?:es|ed)?|introduc(?:es|ed)|capacity|production|business outlook|guidance)\b',re.I)


def assessments(db,reference):
    if not db.execute("SELECT 1 FROM sqlite_master WHERE name='issuer_syndication_bodies'").fetchone():
        return
    for original in syndication.candidates(db,reference,include_research=True):
        row=dict(original)
        if not MATERIAL.search(row['title']):
            continue
        saved=db.execute('SELECT * FROM issuer_syndication_bodies WHERE event_id=? AND sha=?',(row['id'],row['sha'])).fetchone()
        if not saved or saved['error']:
            yield row,None,'awaiting-verified-body';continue
        if syndication.digest(saved['body'])!=saved['body_sha'] or not 600<=len(saved['body'])<=MAX_INPUT:
            yield row,None,'body-integrity-or-input-limit';continue
        try:
            source=next(s for s in signals.SOURCES if s['id']==row['source_id'])
            syndication.release_url(row['url'],source)
            metadata=json.loads(saved['metadata'])
            issuer=metadata['issuer'];short=metadata['issuerShort']
            if (not re.fullmatch(r"[A-Za-z][A-Za-z0-9 .,&'()-]{1,69}",issuer)
                or short!=re.sub(r'(?:,?\s+(?:Inc\.?|Corporation|Corp\.?|Ltd\.?|Limited))$','',issuer)
                or metadata['url']!=row['url'] or metadata['title']!=row['title']
                or syndication.instant(metadata['publishedAt'])!=syndication.instant(row['published_at'])
                or metadata['distributor']!=syndication.SOURCES[row['source_id']][0]
                or not row['title'].casefold().startswith(short.casefold()+' ')
                or short not in saved['body'][:1600]
                or not syndication.instant(saved['fetched_at']) or syndication.instant(saved['fetched_at'])>reference):
                raise ValueError('issuer-proof-mismatch')
            subjects=set(signals.match_companies(row['title'],list(signals.ALIASES))).intersection(json.loads(row['tickers_json']))
            if len(subjects)!=1:
                yield row,None,'multi-entity-relation-needs-binding';continue
            direct=db.execute('SELECT 1 FROM issuer_syndication_publications WHERE event_id=? AND sha=? AND body_sha=?',(row['id'],row['sha'],saved['body_sha'])).fetchone()
            if direct:
                yield row,None,'covered-deterministic-issuer';continue
            existing=(db.execute('SELECT payload FROM official_research_publications WHERE event_id=? AND sha=?',(row['id'],row['sha'])).fetchone()
                      if db.execute("SELECT 1 FROM sqlite_master WHERE name='official_research_publications'").fetchone() else None)
            if existing and json.loads(existing['payload']).get('issuerBusinessPolicy')!=POLICY:
                yield row,None,'covered-existing-issuer';continue
            row.update(body=saved['body'],body_sha=saved['body_sha'],body_at=saved['fetched_at'],
                       ticker=next(iter(subjects)),issuer_business=True,issuer_metadata=metadata)
            yield row,row,'eligible'
        except (TypeError,ValueError,KeyError,StopIteration):
            yield row,None,'issuer-proof-mismatch'


def candidates(db,reference):
    return [row for _,row,_ in assessments(db,reference) if row]


def current_revision(db,row):
    return any(r['id']==row['id'] and r['sha']==row['sha'] and r['body_sha']==row['body_sha'] and r['issuer_metadata']==row['issuer_metadata']
               for r in candidates(db,datetime.now(timezone.utc)))


FINANCIAL = r'\b(?:revenues?|cash[ -]?flows?|income|returns?)\b'
EXPECTED_FINANCIAL = re.compile(r'\b(?:expect(?:s|ed|ing)?|anticipat(?:es|ed|ing)|project(?:s|ed|ing)|forecast(?:s|ed)?)\b[^.;\n]{0,200}'+FINANCIAL,re.I)
JA_FINANCIAL = re.compile(r'収益|売上|収入|キャッシュフロー|キャッシュ・フロー|現金収入|リターン')
JA_EXPECTED = re.compile(r'見込|予想|予測|期待|予定|想定|見通し|可能性')
FINANCIAL_POLICY = """Keep expected financial outcomes explicitly forward-looking in both languages. Completed asset acquisition or leasing does not make expected cash flows or recurring revenue already established. Attach the forecast qualifier to the financial outcome itself, not to a separate corporate review or plan. Preserve completed leasing when the evidence says assets have been leased; do not change it to a plan to lease."""


def validate_financial_modality(item):
    source=item['evidenceQuote']
    en,ja=item['en'],item['ja']
    source_future=EXPECTED_FINANCIAL.search(source)
    output_future=EXPECTED_FINANCIAL.search(en)
    if output_future or (source_future and re.search(FINANCIAL,en,re.I)):
        if not output_future:
            raise ValueError('lost-forecast-modality')
        financial_clauses=[clause for clause in re.split(r'[。！？;；]|、(?=(?:AI|同社|また|さらに|一方|不動産))',ja)
                           if JA_FINANCIAL.search(clause)]
        if not financial_clauses or any(not JA_EXPECTED.search(clause) for clause in financial_clauses):
            raise ValueError('lost-forecast-modality')
    if (re.search(r'\b(?:assets?|GPUs?)\b[^.;\n]{0,50}\b(?:have been|were|are) leased\b|\b(?:has|have) leased\b|\bleased (?:those|these|the) (?:assets?|GPUs?) back\b',source,re.I)
        and re.search(r'\b(?:plans?|intends?) to lease\b|\bwill lease\b',en,re.I)):
        raise ValueError('lost-action-status')


def validate_paraphrase(note):
    for item in [note['title'],note['summary'],*note['facts'],note['purpose']]:
        validate_financial_modality(item)
    for item in [note['summary'],*note['facts']]:
        words=re.findall(r"[a-z0-9']+",item['en'].lower())
        source=re.findall(r"[a-z0-9']+",item['evidenceQuote'].lower())
        if len(words)>=12 and any(words[i:i+12]==source[j:j+12]
            for i in range(len(words)-11) for j in range(max(0,len(source)-11))):
            raise ValueError('source-copy-overlap')


def publications(db,reference):
    import official_research
    if not db.execute("SELECT 1 FROM sqlite_master WHERE name='official_research_publications'").fetchone():
        return
    for row in candidates(db,reference):
        saved=db.execute('SELECT * FROM official_research_publications WHERE event_id=? AND sha=? AND body_sha=?',(row['id'],row['sha'],row['body_sha'])).fetchone()
        if not saved:continue
        started=syndication.instant(saved['started_at']);public=syndication.instant(saved['public_at'])
        observed=syndication.instant(row['observed_at']);body_at=syndication.instant(row['body_at'])
        if not all((started,public,observed,body_at)) or not observed<=body_at<=started<=public<=reference:
            continue
        try:
            note=json.loads(saved['payload'])
            if note.get('issuerBusinessPolicy')!=POLICY:continue
            official_research.validate_row(note,row)
        except (ValueError,TypeError,KeyError):continue
        yield row,saved,note


def public_items(db,reference):
    result=[]
    for row,_,note in publications(db,reference):
        metadata=row['issuer_metadata']
        result.append({'id':str(row['id']),'title':row['title'],'translationJa':note['title']['ja'],
            'url':row['url'],'publisher':metadata['issuer']+' / '+metadata['distributor'],
            'tickers':[row['ticker']],'publishedAt':row['published_at'],'observedAt':row['observed_at'],
            'bodyJa':'\n\n'.join(dict.fromkeys([note['summary']['ja'],*[f['ja'] for f in note['facts']]])),
            'bodyEn':'\n\n'.join(dict.fromkeys([note['summary']['en'],*[f['en'] for f in note['facts']]])),
            'syndication':{'policy':POLICY,'issuer':metadata['issuer'],'distributor':metadata['distributor']}})
    return result


def diagnostics(db,reference):
    records=list(assessments(db,reference));public={r['id'] for r,_,_ in publications(db,reference)}
    eligible=[r for _,r,_ in records if r]
    return {'eligible':len(eligible),'published':len(public),'pending':len(eligible)-len(public),
            'rejectionReasons':dict(Counter(reason for _,r,reason in records if not r))}
