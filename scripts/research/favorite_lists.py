"""Private watchlists. No market/news ingestion or notification delivery."""
import json
import math
import re
import sqlite3
from contextlib import contextmanager

@contextmanager
def connect(path):
    db = sqlite3.connect(path, timeout=5)
    try:
        db.execute('CREATE TABLE IF NOT EXISTS member_favorite_lists (owner TEXT PRIMARY KEY, revision INTEGER NOT NULL, document TEXT NOT NULL)')
        yield db
    finally:
        db.close()

def owner_key(owner):
    if not isinstance(owner, str) or not re.fullmatch('[a-f0-9]{64}', owner):
        raise ValueError('invalid-owner')
    return owner

def validate(value):
    if not isinstance(value, dict) or not isinstance(value.get('lists'), list) or not 1 <= len(value['lists']) <= 20:
        raise ValueError('invalid-lists')
    ids = set()
    ticker = lambda v: isinstance(v, str) and re.fullmatch(r'[A-Z][A-Z0-9.-]{0,14}', v)
    for item in value['lists']:
        if not isinstance(item, dict) or not isinstance(item.get('id'), str) or not re.fullmatch(r'[a-zA-Z0-9-]{1,80}', item['id']) or item['id'] in ids:
            raise ValueError('invalid-list-id')
        ids.add(item['id'])
        if not isinstance(item.get('name'), str) or len(item['name']) > 40 or not isinstance(item.get('tickers'), list) or len(item['tickers']) > 100 or not all(ticker(t) for t in item['tickers']) or len(set(item['tickers'])) != len(item['tickers']):
            raise ValueError('invalid-list')
    if value['lists'][0]['id'] != 'default':
        raise ValueError('missing-default')
    names = value.get('names', {})
    if not isinstance(names, dict) or not all(ticker(k) and isinstance(v, str) and len(v) <= 160 for k, v in names.items()):
        raise ValueError('invalid-names')
    alerts = value.get('alerts', [])
    if not isinstance(alerts, list) or len(alerts) > 100:
        raise ValueError('invalid-alerts')
    for a in alerts:
        if not isinstance(a, dict) or not ticker(a.get('ticker')) or type(a.get('price')) not in (int, float) or not math.isfinite(a['price']) or not 0 < a['price'] <= 1e9 or a.get('direction') not in ('above', 'below') or not isinstance(a.get('currency'), str) or not re.fullmatch('[A-Z]{3}', a['currency']):
            raise ValueError('invalid-alert')
    clean = {'lists': [{k: i[k] for k in ('id','name','tickers')} for i in value['lists']], 'names': names, 'alerts': [{k:a[k] for k in ('ticker','price','direction','currency')} for a in alerts]}
    if len(json.dumps(clean).encode()) > 60000:
        raise ValueError('document-too-large')
    return clean

def read(db, owner):
    owner_key(owner)
    row = db.execute('SELECT revision, document FROM member_favorite_lists WHERE owner=?', (owner,)).fetchone()
    return {'revision': row[0], 'document': json.loads(row[1])} if row else {'revision': 0, 'document': None}

def save(db, owner, revision, document):
    owner_key(owner)
    if type(revision) is not int or revision < 0:
        raise ValueError('invalid-revision')
    data = json.dumps(validate(document), ensure_ascii=False)
    # Compare and write under one transaction: another device cannot overwrite it.
    db.execute('BEGIN IMMEDIATE')
    try:
        current = read(db, owner)
        if current['revision'] != revision:
            db.rollback()
            return {'conflict': True, **current}
        db.execute('INSERT INTO member_favorite_lists VALUES (?,?,?) ON CONFLICT(owner) DO UPDATE SET revision=excluded.revision, document=excluded.document', (owner, revision + 1, data))
        db.commit()
        return {'revision': revision + 1, 'document': json.loads(data)}
    except Exception:
        db.rollback()
        raise
