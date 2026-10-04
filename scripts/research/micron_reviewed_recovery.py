"""One source-reviewed, zero-call recovery of an exact retained broker report."""
from datetime import datetime, timezone
import json
from pathlib import Path

import general_source_news as news

REVIEW=Path(__file__).with_name('micron_reviewed_correction.json')
POLICY='reviewed-broker-metric-correction-v1'


def reviewed():
    raw=REVIEW.read_text()
    value=json.loads(raw)
    if not isinstance(value,dict) or value.get('policy')!=POLICY:
        raise ValueError('unapproved-reviewed-copy')
    return value,news.digest(raw)


def matches(row,value):
    return all(row.get(key)==value.get(field) for key,field in (
        ('id','eventId'),('source_id','sourceId'),('url','url'),('sha','sourceSha'),
        ('body_sha','bodySha'),('published_at','publishedAt'),('observed_at','observedAt'),
        ('category','category'))) and row.get('semantic_assessment')


def note_for(row,value):
    note,reason=news.bind_assessment({'disposition':'publish','reason':'material-company-development',
                                    'facts':value['facts']},row)
    if reason is not None:
        raise ValueError('unapproved-reviewed-copy')
    return note


def resolves(db,row,review,reference):
    """Retain the original decision while recognizing its audited correction."""
    try:value,manifest_sha=reviewed()
    except (ValueError,OSError):return False
    if not matches(row,value) or not db.execute("SELECT 1 FROM sqlite_master WHERE name='business_news_revalidations'").fetchone():
        return False
    audit=db.execute('SELECT * FROM business_news_revalidations WHERE event_id=? AND sha=? AND body_sha=? AND failure_lease=?',
                     (row['id'],row['sha'],row['body_sha'],review['lease'])).fetchone()
    publication=db.execute('SELECT * FROM official_research_publications WHERE event_id=? AND sha=? AND body_sha=?',
                           (row['id'],row['sha'],row['body_sha'])).fetchone()
    if not audit or not publication or news.digest(publication['payload'])!=audit['validated_payload_sha']:
        return False
    try:
        adjustments=json.loads(audit['adjustments'])
        public=news.reconciliation.instant(publication['public_at'])
        expected=note_for(row,value)
        return (json.loads(publication['payload'])==expected
                and adjustments['policy']==POLICY and adjustments['reviewedManifestSha']==manifest_sha
                and adjustments['originalReview']==dict(review)
                and public is not None and public<=reference
                and publication['public_at']==audit['revalidated_at'])
    except (ValueError,TypeError,KeyError):
        return False


def publish(db,reference,model,clock=None):
    try:value,manifest_sha=reviewed()
    except (ValueError,OSError):return False
    rows=[r for r in news.candidates(db,reference,include_review=True) if matches(r,value)]
    if not rows:return False
    db.commit()
    with db:
        db.execute('BEGIN IMMEDIATE')
        for row in rows:
            if not news.current_revision(db,row):continue
            review=news.semantic_review(db,row,reference)
            job=db.execute('SELECT * FROM official_research_jobs WHERE event_id=?',(row['id'],)).fetchone()
            if (not review or not job or job['sha']!=row['sha'] or job['state']!='review'
                or job['lease']!=review['lease'] or review['reason']!='unsubstantiated-model-output'):
                continue
            failure=db.execute('SELECT * FROM official_research_attempt_failures WHERE event_id=? ORDER BY julianday(failed_at) DESC,rowid DESC LIMIT 1',(row['id'],)).fetchone()
            proof=db.execute('SELECT * FROM official_research_attempt_body_proofs WHERE lease=?',(job['lease'],)).fetchone()
            if (not failure or failure['lease']!=job['lease'] or failure['sha']!=row['sha']
                or failure['failed_at']!=value['failedAt'] or failure['reason']!='changed-broker-metric'
                or job['failure_kind']!=failure['reason'] or not proof
                or proof['source_sha']!=row['sha'] or proof['body_sha']!=row['body_sha']):
                continue
            call=db.execute('SELECT * FROM signal_headline_translation_calls WHERE lease=?',(job['lease'],)).fetchone()
            if (not call or call['model']!=model or call['source_id']!='research:'+row['source_id']
                or call['sha']!=row['sha'] or call['state']!='failed'):
                continue
            started=datetime.fromtimestamp(call['at'],timezone.utc)
            failed=news.reconciliation.instant(failure['failed_at'])
            if not failed or not news.reconciliation.instant(row['body_at'])<=started<=failed<=reference:
                continue
            original=failure['payload']
            if not isinstance(original,str) or len(original.encode())>131072:continue
            try:
                if json.loads(original)!={'disposition':'publish','reason':'material-company-development','facts':value['originalFacts']}:
                    continue
                note=note_for(row,value)
            except (ValueError,TypeError,KeyError):continue
            if db.execute('SELECT 1 FROM official_research_publications WHERE event_id=?',(row['id'],)).fetchone():continue
            if db.execute('SELECT 1 FROM business_news_revalidations WHERE event_id=? AND sha=? AND body_sha=? AND failure_lease=?',
                          (row['id'],row['sha'],row['body_sha'],job['lease'])).fetchone():continue
            public=(clock or (lambda:datetime.now(timezone.utc)))()
            if public<reference:continue
            public_at=public.isoformat()
            encoded=json.dumps(note,ensure_ascii=False)
            adjustments={'kind':'manual-reviewed-source-correction','policy':POLICY,
                         'sourceUrl':row['url'],'reviewedManifestSha':manifest_sha,
                         'originalReview':review,'originalJob':dict(job),'originalFailedAt':failure['failed_at'],
                         'reason':'retain unlabeled metric, calendar basis, strict/inclusive thresholds and continuous period; preserve broker/sector/company scopes'}
            db.execute('INSERT INTO official_research_publications VALUES(?,?,?,?,?,?,?,?)',
                (row['id'],row['sha'],row['body_sha'],encoded,json.dumps([f['evidenceQuote'] for f in note['facts']]),
                 started.isoformat(),public_at,round((failed-started).total_seconds()*1000)))
            db.execute('INSERT INTO business_news_revalidations VALUES(?,?,?,?,?,?,?,?)',
                (row['id'],row['sha'],row['body_sha'],job['lease'],news.digest(original),news.digest(encoded),
                 json.dumps(adjustments,ensure_ascii=False),public_at))
            db.execute("UPDATE official_research_jobs SET state='done',failure_kind=NULL WHERE event_id=? AND lease=?",(row['id'],job['lease']))
            return True
    return False
