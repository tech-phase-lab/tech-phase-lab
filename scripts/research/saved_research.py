"""Account-private saved research; independent of ingestion and delivery."""
import json
import re
import sqlite3
from contextlib import contextmanager

LIMIT = 1_000_000

def size(text):
    return len(text.encode('utf-16-le', errors='surrogatepass')) // 2

def validate(value):
    if not isinstance(value, dict):
        raise ValueError('invalid-document')
    saved, notebooks = value.get('saved'), value.get('notebooks')
    if not isinstance(saved, list) or len(saved) > 2000 or any(not isinstance(i, str) or not 1 <= size(i) <= 300 for i in saved) or len(set(saved)) != len(saved):
        raise ValueError('invalid-saves')
    if not isinstance(notebooks, dict) or len(notebooks) > 4000:
        raise ValueError('invalid-notebooks')
    clean = {'saved': saved, 'notebooks': {}}
    for key, marks in notebooks.items():
        if not isinstance(key, str) or not re.fullmatch(r'.{1,900}:(ja|en)', key) or not isinstance(marks, list) or len(marks) > 200:
            raise ValueError('invalid-notebook')
        seen, result = set(), []
        for mark in marks:
            if not isinstance(mark, dict) or not isinstance(mark.get('id'), str) or size(mark['id']) > 100 or mark['id'] in seen or mark.get('kind') not in ('underline', 'highlight', 'box', 'note') or mark.get('color') not in ('red', 'yellow', 'blue') or not isinstance(mark.get('note'), str) or size(mark['note']) > 1000:
                raise ValueError('invalid-mark')
            seen.add(mark['id'])
            parts = mark.get('parts')
            if not isinstance(parts, list) or not 1 <= len(parts) <= 100:
                raise ValueError('invalid-parts')
            for p in parts:
                if not isinstance(p, dict) or not isinstance(p.get('block'), str) or size(p['block']) >= 500 or type(p.get('start')) is not int or type(p.get('end')) is not int or not 0 <= p['start'] < p['end'] <= 9007199254740991 or not isinstance(p.get('quote'), str) or size(p['quote']) != p['end'] - p['start'] or size(p['quote']) > 10000:
                    raise ValueError('invalid-part')
            result.append({**{k: mark[k] for k in ('id', 'kind', 'color', 'note')}, 'parts': [{k: p[k] for k in ('block', 'start', 'end', 'quote')} for p in parts]})
        clean['notebooks'][key] = result
    if len(json.dumps(clean, ensure_ascii=False, separators=(',', ':')).encode()) > LIMIT:
        raise ValueError('document-too-large')
    return clean

@contextmanager
def connect(path):
    db = sqlite3.connect(path, timeout=5)
    try:
        db.execute('CREATE TABLE IF NOT EXISTS member_saved_research (owner TEXT PRIMARY KEY, revision INTEGER NOT NULL, document TEXT NOT NULL)')
        yield db
    finally:
        db.close()

def owner_key(owner):
    if not isinstance(owner, str) or not re.fullmatch('[a-f0-9]{64}', owner):
        raise ValueError('invalid-owner')
    return owner

def read(db, owner):
    row = db.execute('SELECT revision, document FROM member_saved_research WHERE owner=?', (owner_key(owner),)).fetchone()
    return {'revision': row[0], 'document': json.loads(row[1])} if row else {'revision': 0, 'document': {'saved': [], 'notebooks': {}}}

def save(db, owner, revision, document):
    owner_key(owner)
    if type(revision) is not int or not 0 <= revision < 9007199254740991:
        raise ValueError('invalid-revision')
    data = json.dumps(validate(document), ensure_ascii=False, separators=(',', ':'))
    db.execute('BEGIN IMMEDIATE')
    try:
        current = read(db, owner)
        if current['revision'] != revision:
            db.rollback()
            return {'conflict': True, **current}
        db.execute('INSERT INTO member_saved_research VALUES (?,?,?) ON CONFLICT(owner) DO UPDATE SET revision=excluded.revision, document=excluded.document', (owner, revision + 1, data))
        db.commit()
        return {'revision': revision + 1, 'document': json.loads(data)}
    except Exception:
        db.rollback()
        raise
