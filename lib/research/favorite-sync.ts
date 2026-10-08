import type { FavoriteLists } from './favorite-lists.ts';

export type CloudFavorites = { account: string; revision: number; document: FavoriteLists };
export type FavoriteSyncStatus = 'loading' | 'guest' | 'synced' | 'saving' | 'error' | 'conflict';
type Reply = { ok: boolean; status: number; json: () => Promise<Record<string, unknown>> };
type Transport = (init?: { body: string }) => Promise<Reply>;
const empty: FavoriteLists = { lists: [{ id: 'default', name: '', tickers: [] }], names: {}, alerts: [] };

function snapshot(data: Record<string, unknown>): CloudFavorites {
  if (typeof data.account !== 'string' || !/^[a-f0-9]{64}$/.test(data.account) || !Number.isSafeInteger(data.revision) || Number(data.revision) < 0) throw new Error('invalid-snapshot');
  const document = data.document ?? empty;
  if (typeof document !== 'object' || !Array.isArray((document as FavoriteLists).lists) || !(document as FavoriteLists).lists.length) throw new Error('invalid-document');
  return { account: data.account, revision: Number(data.revision), document: document as FavoriteLists };
}
// Compare persisted fields, independent of JSON object key order.
function sameDocument(a: FavoriteLists, b: FavoriteLists) {
  const normalize = (d: FavoriteLists) => JSON.stringify({
    lists: d.lists.map(({ id, name, tickers }) => [id, name, tickers]),
    names: Object.entries(d.names ?? {}).sort(([a], [b]) => a.localeCompare(b)),
    alerts: (d.alerts ?? []).map(({ ticker, price, direction, currency }) => [ticker, price, direction, currency]),
  });
  return normalize(a) === normalize(b);
}

/** Serializes edits and rejects stale reads. Each mount owns one disposable instance. */
export function createFavoriteSync(transport: Transport, notify: (cloud: CloudFavorites | null, status: FavoriteSyncStatus) => void) {
  let cloud: CloudFavorites | null = null;
  let status: FavoriteSyncStatus = 'loading';
  let pending = false, writing = false, reading = false, disposed = false;
  let generation = 0;
  const publish = (next: FavoriteSyncStatus) => { status = next; if (!disposed) notify(cloud, status); };
  async function refresh() {
    if (disposed || reading || pending || writing) return;
    reading = true;
    const started = generation;
    try {
      const response = await transport();
      const data = await response.json();
      if (disposed || started !== generation) return;
      if (response.status === 401) { cloud = null; publish('guest'); return; }
      if (!response.ok || !data.ok) throw new Error('read-failed');
      const next = snapshot(data);
      if (cloud?.account === next.account && cloud.revision > next.revision) return;
      cloud = next; publish('synced');
    } catch { if (!disposed && started === generation) publish('error'); }
    finally { reading = false; }
  }
  async function flush() {
    if (disposed || writing || !cloud || !pending || status === 'conflict') return;
    writing = true; publish('saving');
    try {
      while (!disposed && pending && cloud) {
        const sent: CloudFavorites = cloud;
        const response = await transport({ body: JSON.stringify(sent) });
        const data = await response.json();
        if (disposed) return;
        if (response.status === 401) { publish('error'); return; }
        if (response.status === 409) {
          // A successful save can lose its response. Accept only the exact saved
          // document for this account; never overwrite a different device's edits.
          if (data.error === 'account-changed') { publish('conflict'); return; }
          const remote = snapshot(data);
          if (remote.account !== sent.account || remote.revision <= sent.revision || !sameDocument(remote.document, sent.document)) { publish('conflict'); return; }
          pending = cloud.document !== sent.document;
          cloud = { ...cloud, revision: remote.revision };
        } else {
          if (!response.ok || !data.ok) throw new Error('write-failed');
          const saved = snapshot(data);
          if (saved.account !== sent.account || saved.revision <= sent.revision) throw new Error('invalid-acknowledgement');
          pending = cloud.document !== sent.document;
          cloud = { ...cloud, revision: saved.revision };
        }
        publish(pending ? 'saving' : 'synced');
      }
    } catch { if (!disposed) publish('error'); }
    finally { writing = false; }
  }
  function update(change: (current: FavoriteLists) => FavoriteLists) {
    if (disposed || !cloud || status === 'conflict') return false;
    cloud = { ...cloud, document: change(cloud.document) };
    generation++; pending = true;
    publish('saving'); void flush(); return true;
  }
  return {
    refresh, update,
    retry: () => pending ? flush() : refresh(),
    hasPending: () => pending,
    dispose: () => { disposed = true; generation++; },
  };
}
