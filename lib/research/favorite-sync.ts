import type { FavoriteLists } from './favorite-lists.ts';

export type CloudFavorites = { account: string; revision: number; document: FavoriteLists };
export type FavoriteSyncStatus = 'loading' | 'guest' | 'synced' | 'saving' | 'error' | 'conflict';
type Reply = { ok: boolean; status: number; json: () => Promise<Record<string, unknown>> };
type Transport = (init?: { body: string }) => Promise<Reply>;
export type FavoriteSyncJournal = {
  load: (account: string) => string | null;
  save: (account: string, value: string) => void;
  clear: (account: string) => void;
};
const empty: FavoriteLists = { lists: [{ id: 'default', name: '', tickers: [] }], names: {}, alerts: [] };

/** Never substitute device-only favorites while the account is still unknown. */
export function favoriteDisplayDocument(cloud: CloudFavorites | null, status: FavoriteSyncStatus, local: FavoriteLists): FavoriteLists | null {
  return cloud?.document ?? (status === 'guest' ? local : null);
}

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
export function createFavoriteSync(transport: Transport, notify: (cloud: CloudFavorites | null, status: FavoriteSyncStatus) => void, journal?: FavoriteSyncJournal) {
  let cloud: CloudFavorites | null = null;
  let sentSnapshot: CloudFavorites | null = null;
  let status: FavoriteSyncStatus = 'loading';
  let pending = false, writing = false, reading = false, disposed = false;
  let generation = 0;
  const publish = (next: FavoriteSyncStatus) => { status = next; if (!disposed) notify(cloud, status); };
  const remember = (next: CloudFavorites, sent = sentSnapshot) => journal?.save(next.account, JSON.stringify({ cloud: next, sent }));
  // Keep the account-scoped journal, but stop displaying or writing a draft
  // once the server confirms its account is no longer active.
  function releaseAccount(next: 'guest' | 'error') {
    cloud = null; sentSnapshot = null; pending = false; generation++;
    publish(next);
  }
  async function refresh() {
    if (disposed || writing) return;
    // Focus/visibility and the visible-page timer also resume failed saves.
    // flush serializes overlapping wake-ups and leaves conflicts untouched.
    if (pending) { await flush(); return; }
    if (reading) return;
    reading = true;
    const started = generation;
    try {
      const response = await transport();
      const data = await response.json();
      if (disposed || started !== generation) return;
      if (response.status === 401) { releaseAccount('guest'); return; }
      if (!response.ok || !data.ok) throw new Error('read-failed');
      const next = snapshot(data);
      if (cloud?.account === next.account && cloud.revision > next.revision) return;
      const raw = journal?.load(next.account);
      if (raw) {
        const saved = JSON.parse(raw);
        const queued = snapshot(saved.cloud);
        const sent = saved.sent ? snapshot(saved.sent) : null;
        if (queued.account !== next.account || (sent && sent.account !== next.account)) throw new Error('invalid-journal-account');
        if (sameDocument(next.document, queued.document) && next.revision >= queued.revision) {
          journal?.clear(next.account);
        } else {
          cloud = queued; pending = true; sentSnapshot = sent;
          // A previous mount may have committed its in-flight save but lost the
          // response. Continue queued edits only when that exact save is visible.
          const recovered = sent && sent.revision === queued.revision && next.revision > sent.revision && sameDocument(next.document, sent.document);
          if (next.revision !== queued.revision && !recovered) { publish('conflict'); return; }
          cloud = { ...queued, revision: next.revision };
          remember(cloud); publish('saving'); void flush(); return;
        }
      }
      cloud = next; sentSnapshot = null; publish('synced');
    } catch { if (!disposed && started === generation) publish('error'); }
    finally { reading = false; }
  }
  async function flush() {
    if (disposed || writing || !cloud || !pending || status === 'conflict') return;
    writing = true; publish('saving');
    try {
      while (!disposed && pending && cloud) {
        const sent: CloudFavorites = cloud;
        remember(cloud, sent); sentSnapshot = sent;
        const response = await transport({ body: JSON.stringify(sent) });
        const data = await response.json();
        if (disposed) return;
        if (response.status === 401) { releaseAccount('guest'); return; }
        if (response.status === 409) {
          // A successful save can lose its response. Accept only the exact saved
          // document for this account; never overwrite a different device's edits.
          if (data.error === 'account-changed') { releaseAccount('error'); return; }
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
        sentSnapshot = null;
        if (pending) remember(cloud); else journal?.clear(cloud.account);
        publish(pending ? 'saving' : 'synced');
      }
    } catch { if (!disposed) publish('error'); }
    finally { writing = false; }
  }
  function update(change: (current: FavoriteLists) => FavoriteLists) {
    if (disposed || !cloud || status === 'conflict') return false;
    const next = { ...cloud, document: change(cloud.document) };
    try { remember(next); } catch { publish('error'); return false; }
    cloud = next;
    generation++; pending = true;
    publish('saving'); void flush(); return true;
  }
  async function discardPending() {
    if (disposed || writing || status !== 'conflict' || !cloud) return;
    try { journal?.clear(cloud.account); } catch { return; }
    pending = false; sentSnapshot = null; cloud = null; generation++;
    publish('loading'); await refresh();
  }
  return {
    refresh, update, discardPending,
    retry: () => pending ? flush() : refresh(),
    hasPending: () => pending,
    dispose: () => { disposed = true; generation++; },
  };
}
