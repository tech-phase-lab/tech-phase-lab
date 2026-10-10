"""One explicitly reviewed, revision-bound commentary recovery; no API calls."""
from datetime import datetime,timezone
import json
from pathlib import Path

import general_source_news as news

REVIEW=Path(__file__).with_name('reviewed_business_news.json')


def publish(db,reference,model,clock=None):
    reviewed=json.loads(REVIEW.read_text())
    if reviewed.get('policy')!='reviewed-source-commentary-v1':return False
    rows=[r for r in news.candidates(db,reference)
          if (r['source_id'],r['url'],r['sha'],r['body_sha'],r['category'])==
          (reviewed.get('sourceId'),reviewed.get('url'),reviewed.get('sourceSha'),reviewed.get('bodySha'),reviewed.get('category'))]
    if not rows:return False
    db.commit()
    with db:
        db.execute('BEGIN IMMEDIATE')
        for row in rows:
            if not news.current_revision(db,row):continue
            job=db.execute('SELECT * FROM official_research_jobs WHERE event_id=? AND sha=?',(row['id'],row['sha'])).fetchone()
            if not job or job['state']!='retry':continue
            failure=db.execute('SELECT * FROM official_research_attempt_failures WHERE event_id=? ORDER BY julianday(failed_at) DESC,rowid DESC LIMIT 1',(row['id'],)).fetchone()
            if not failure or failure['lease']!=job['lease'] or failure['sha']!=row['sha']:continue
            call=db.execute('SELECT * FROM signal_headline_translation_calls WHERE lease=?',(job['lease'],)).fetchone()
            failed=news.reconciliation.instant(failure['failed_at'])
            if not call or call['model']!=model or call['source_id']!='research:'+row['source_id'] or call['sha']!=row['sha'] or call['state']!='failed' or not failed:continue
            started=datetime.fromtimestamp(call['at'],timezone.utc)
            if not news.reconciliation.instant(row['body_at'])<=started<=failed<=reference:continue
            raw=failure['payload']
            if not isinstance(raw,str) or len(raw.encode())>131072:continue
            try:
                # The full reviewed replacement must satisfy every current gate.
                note=news.bind_note({'facts':reviewed['facts']},row)
            except (ValueError,TypeError,KeyError):continue
            public=(clock or (lambda:datetime.now(timezone.utc)))()
            if public<reference:continue
            public_at=public.isoformat()
            encoded=json.dumps(note,ensure_ascii=False)
            adjustments=[{'kind':'manual-reviewed-source-correction','policy':reviewed['policy'],
                          'scope':'complete-broker-commentary','sourceUrl':row['url'],
                          'reviewedManifestSha':news.digest(REVIEW.read_text()),
                          'reason':'restore precise revenue/period/attribution without invented causality or source copying'}]
            db.execute('INSERT OR REPLACE INTO official_research_publications VALUES(?,?,?,?,?,?,?,?)',
                (row['id'],row['sha'],row['body_sha'],encoded,json.dumps([f['evidenceQuote'] for f in note['facts']]),
                 started.isoformat(),public_at,round((failed-started).total_seconds()*1000)))
            db.execute('INSERT OR IGNORE INTO business_news_revalidations VALUES(?,?,?,?,?,?,?,?)',
                (row['id'],row['sha'],row['body_sha'],failure['lease'],news.digest(raw),news.digest(encoded),json.dumps(adjustments),public_at))
            db.execute("UPDATE official_research_jobs SET state='done',failure_kind=NULL WHERE event_id=? AND lease=?",(row['id'],job['lease']))
            return True
    return False
