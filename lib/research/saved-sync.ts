import { emptySavedDocument, mergeSavedDocuments, sameSavedDocument, validateSavedDocument, type SavedDocument } from './saved-document.ts';
export type SavedCloud = { account: string; revision: number; document: SavedDocument };
export type SavedStatus = 'loading' | 'guest' | 'synced' | 'saving' | 'error' | 'conflict';
type Reply = { ok: boolean; status: number; json: () => Promise<Record<string, unknown>> };
export type SavedJournal = { load: (account: string) => string | null; save: (account: string, value: string) => void; clear: (account: string) => void };
function snapshot(data: Record<string, unknown>): SavedCloud {
  if (typeof data.account !== 'string' || !/^[a-f0-9]{64}$/.test(data.account) || !Number.isSafeInteger(data.revision) || Number(data.revision) < 0) throw new Error('invalid-snapshot');
  return { account: data.account, revision: Number(data.revision), document: validateSavedDocument(data.document ?? emptySavedDocument()) };
}
/** Durable draft precedes network writes. A server CAS protects every device. */
export function createSavedSync(transport: (init?: { body: string }) => Promise<Reply>, notify: (cloud: SavedCloud | null, status: SavedStatus) => void, journal: SavedJournal) {
  let base: SavedCloud | null = null, cloud: SavedCloud | null = null, sentSnapshot: SavedCloud | null = null;
  let pending = false, writing = false, reading = false, disposed = false, generation = 0;
  let status: SavedStatus = 'loading';
  const publish = (next: SavedStatus) => { status = next; if (!disposed) notify(cloud, next); };
  const remember = () => { if (cloud) journal.save(cloud.account, JSON.stringify({ base, cloud, sent: sentSnapshot })); };
  function release(next: SavedStatus) { base = cloud = sentSnapshot = null; pending = false; generation++; publish(next); }
  function reconcile(remote: SavedCloud) {
    if (!cloud || !base || remote.account !== cloud.account || remote.revision < base.revision) throw new Error('invalid-account');
    // If a committed response was lost, rebase newer queued edits on the exact
    // acknowledged payload, not the snapshot from before that successful save.
    const recovered = sentSnapshot && sentSnapshot.account === remote.account && remote.revision === sentSnapshot.revision + 1 && sameSavedDocument(sentSnapshot.document, remote.document);
    const merged = recovered ? cloud.document : mergeSavedDocuments(base.document, cloud.document, remote.document);
    if (!merged) { publish('conflict'); return false; }
    base = remote; cloud = { ...remote, document: merged }; sentSnapshot = null;
    pending = !sameSavedDocument(merged, remote.document);
    if (pending) remember(); else journal.clear(cloud.account);
    return true;
  }
  async function refresh() {
    if (disposed || writing || reading || status === 'conflict') return;
    if (pending) { await flush(); return; }
    reading = true;
    const started = generation;
    try {
      const response = await transport(); const data = await response.json();
      if (disposed || started !== generation) return;
      if (response.status === 401) { release('guest'); return; }
      if (!response.ok || !data.ok) throw new Error('read-failed');
      const remote = snapshot(data);
      if (cloud && cloud.account !== remote.account) { cloud = base = sentSnapshot = null; }
      const raw = journal.load(remote.account);
      if (raw) {
        const saved = JSON.parse(raw); base = snapshot(saved.base); cloud = snapshot(saved.cloud); sentSnapshot = saved.sent ? snapshot(saved.sent) : null;
        if (cloud.account !== remote.account || base.account !== remote.account) { release('error'); return; }
        pending = true;
        if (!reconcile(remote)) return;
      } else { base = cloud = remote; }
      publish(pending ? 'saving' : 'synced');
      if (pending) void flush();
    } catch { if (!disposed && started === generation) publish('error'); }
    finally { reading = false; }
  }
  async function flush() {
    if (disposed || writing || !cloud || !base || !pending || status === 'conflict') return;
    writing = true; publish('saving');
    try {
      if (sentSnapshot) {
        const response = await transport(); const data = await response.json();
        if (disposed) return;
        if (response.status === 401) { release('guest'); return; }
        if (!response.ok || !data.ok) throw new Error('read-failed');
        const remote = snapshot(data);
        if (remote.account !== cloud.account) { release('error'); return; }
        if (!reconcile(remote)) return;
        publish(pending ? 'saving' : 'synced');
      }
      let collisions = 0;
      while (!disposed && pending && cloud) {
        const sent: SavedCloud = cloud;
        sentSnapshot = sent; remember();
        const response = await transport({ body: JSON.stringify(sent) }); const data = await response.json();
        if (disposed) return;
        if (response.status === 401) { release('guest'); return; }
        if (response.status === 409 && data.error === 'account-changed') { release('error'); return; }
        if (response.status === 409) {
          if (++collisions > 3) throw new Error('busy');
          if (!reconcile(snapshot(data))) return;
        } else {
          if (!response.ok || !data.ok) throw new Error('write-failed');
          const remote = snapshot(data);
          if (remote.account !== sent.account || remote.revision !== sent.revision + 1 || !sameSavedDocument(remote.document, sent.document)) throw new Error('invalid-ack');
          base = remote; sentSnapshot = null;
          pending = !sameSavedDocument(cloud.document, sent.document);
          cloud = { ...remote, document: cloud.document };
          if (pending) remember(); else journal.clear(cloud.account);
        }
        publish(pending ? 'saving' : 'synced');
      }
    } catch { if (!disposed) publish('error'); }
    finally { writing = false; }
  }
  return {
    refresh,
    update(change: (document: SavedDocument) => SavedDocument) {
      if (disposed || !cloud || !base || status === 'conflict') return false;
      const previous = cloud;
      try { cloud = { ...cloud, document: validateSavedDocument(change(cloud.document)) }; remember(); }
      catch { cloud = previous; publish('error'); return false; }
      pending = true; generation++; publish('saving'); void flush(); return true;
    },
    retry: () => pending ? flush() : refresh(),
    async discardPending() {
      if (disposed || writing || status !== 'conflict' || !cloud) return;
      try { journal.clear(cloud.account); } catch { publish('error'); return; }
      release('loading'); await refresh();
    },
    hasPending: () => pending,
    // Auth events immediately hide the previous account; its draft stays in its journal.
    dispose: () => { disposed = true; generation++; },
  };
}
