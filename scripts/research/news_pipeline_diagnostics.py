"""Bounded editor-only pipeline metadata; no fetching, generation or writes."""
from collections import Counter
import json
import os
import re

import general_source_news
import issuer_business_news
import issuer_syndication
import signals


def configured_model():
    # Read exactly this identifier. Never inspect keys, headers or other env vars.
    model=os.environ.get('OFFICIAL_HEADLINE_TRANSLATION_MODEL','').strip()
    return model if len(model)<=100 and re.fullmatch(r'(?:gpt-[A-Za-z0-9_.-]+|o[1-9][A-Za-z0-9_.-]*|ft:gpt-[A-Za-z0-9_.:-]+)',model) else None


def issuer_preparation(db,reference):
    if not db.execute("SELECT 1 FROM sqlite_master WHERE name='issuer_syndication_bodies'").fetchone():
        return {'scope':'current-issuer-preparation','total':0,'records':[],'counts':{}}
    assessments={row['id']:(row,candidate,reason) for row,candidate,reason in issuer_business_news.assessments(db,reference)}
    deterministic={int(item['id']) for item in issuer_syndication.public_items(db,reference)}
    semantic={row['id'] for row,_,_ in issuer_business_news.publications(db,reference)}
    records=[];counts=Counter()
    for row in issuer_syndication.candidates(db,reference):
        cached=db.execute('SELECT sha,body_sha,reason,error,next_at FROM issuer_syndication_bodies WHERE event_id=? AND sha=?',(row['id'],row['sha'])).fetchone()
        preparation=cached['reason'] if cached else 'awaiting-body'
        counts[preparation]+=1
        detail,candidate,reason=assessments.get(row['id'],(row,None,'not-in-semantic-category'))
        disposition=('validated-deterministic-publication' if row['id'] in deterministic else
                     'validated-semantic-publication' if row['id'] in semantic else
                     'generation-pending' if candidate else 'held-before-generation')
        job=db.execute('SELECT sha,state,attempts,next_at,failure_kind FROM official_research_jobs WHERE event_id=?',(row['id'],)).fetchone()
        if job and job['sha']!=row['sha']:job=None
        records.append({'eventId':row['id'],'sourceId':row['source_id'],'url':row['url'],'title':row['title'][:500],
            'sourceSha':row['sha'],'bodySha':cached['body_sha'] if cached else None,
            'preparationReason':preparation,'generationDisposition':disposition,
            'generationEligibilityReason':reason,'companyRoleEvidence':detail.get('company_role_evidence'),
            'job':{'state':job['state'],'attempts':job['attempts'],'failureKind':job['failure_kind']} if job else None,
            'nextPreparationAt':cached['next_at'] if cached else None,
            'nextGenerationAt':job['next_at'] if job else None})
    records.sort(key=lambda r:(r['generationDisposition'].startswith('validated-'),-r['eventId']))
    return {'scope':'current-issuer-preparation','readOnly':True,'total':len(records),
            'counts':dict(counts),'records':records[:50],'recordsOmitted':max(0,len(records)-50),
            'notice':'Preparation statuses overlap generation/publication lanes; they are not additional missing-story counts.'}


def snapshot(db,reference):
    result={'check':'editor-only-news-pipeline-metadata','configuredModel':configured_model(),
            'issuerPreparation':issuer_preparation(db,reference),
            'retainedIntake':general_source_news.retained_intake(db,reference,include_records=True),
            'acquisitionCoverage':{s['id']:signals.x_intake_coverage(db,s,reference) for s in signals.SOURCES
                                   if s['id'] in signals.X_AUTHOR_INTAKE_SOURCE_IDS}}
    # Preserve aggregate counts while explicitly bounding displayed metadata.
    while len(json.dumps(result,ensure_ascii=False).encode())>60000:
        blocks=[result['retainedIntake'],result['issuerPreparation']]
        block=next((b for b in blocks if b.get('records')),None)
        if block is None:break
        block['records'].pop()
        block['responseOmittedRecords']=block.get('responseOmittedRecords',0)+1
    return result
