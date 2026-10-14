"use client";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { parseAnnotations, type Annotation } from '@/lib/research/annotations';
import { parseSavedIds } from '@/lib/research/saved-collection';
import { emptySavedDocument, hasBrowserResearch, importBrowserResearch, notebookKey, validateSavedDocument, type SavedDocument } from '@/lib/research/saved-document';
import { createSavedSync, type SavedCloud, type SavedStatus } from '@/lib/research/saved-sync';
const savedKey = 'tech-phase:research-saved:v1';
const inkPrefix = 'tech-phase:annotations:v1:';
const changed = 'tech-phase:research-saved';
function localSnapshot() {
  try {
    const keys = Object.keys(localStorage).filter(k => k.startsWith(inkPrefix)).sort();
    return JSON.stringify([localStorage.getItem(savedKey), keys.map(k => [k.slice(inkPrefix.length), localStorage.getItem(k)])]);
  } catch { return '[null,[]]'; }
}
function subscribe(callback: () => void) {
  const events = ['storage', changed, 'tech-phase:annotations-changed'];
  events.forEach(e => window.addEventListener(e, callback));
  return () => events.forEach(e => window.removeEventListener(e, callback));
}
export function useSavedResearch() {
  const raw = useSyncExternalStore(subscribe, localSnapshot, () => '[null,[]]');
  const local = useMemo(() => {
    const [saved, entries] = JSON.parse(raw) as [string, [string, string][]];
    return { saved: parseSavedIds(saved), notebooks: Object.fromEntries(entries.map(([k, v]) => [k, parseAnnotations(v)])) };
  }, [raw]);
  const [cloud, setCloud] = useState<SavedCloud | null>(null);
  const [status, setStatus] = useState<SavedStatus>('loading');
  const sync = useRef<ReturnType<typeof createSavedSync> | null>(null);
  const importKey = cloud ? `tech-phase:saved-import:v1:${cloud.account}` : '';
  const imported = useSyncExternalStore(subscribe, () => { try { return importKey ? localStorage.getItem(importKey) ?? '' : ''; } catch { return ''; } }, () => '');
  useEffect(() => {
    const expected = new Map<string, string | null>();
    const key = (account: string) => `tech-phase:saved-pending:v1:${account}`;
    function start() {
      sync.current?.dispose(); setCloud(null); setStatus('loading');
      const controller = createSavedSync(init => fetch('/api/research/saved', {
        method: init ? 'POST' : 'GET', cache: 'no-store', signal: AbortSignal.timeout(12000),
        ...(init ? { headers: { 'Content-Type': 'application/json' }, body: init.body } : {}),
      }), (next, state) => { setCloud(next); setStatus(state); }, {
        load(account) { const value = localStorage.getItem(key(account)); expected.set(account, value); return value; },
        save(account, value) {
          if (localStorage.getItem(key(account)) !== (expected.get(account) ?? null)) throw new Error('another-tab');
          localStorage.setItem(key(account), value); expected.set(account, value);
        },
        clear(account) {
          if (localStorage.getItem(key(account)) === expected.get(account)) localStorage.removeItem(key(account));
          expected.set(account, null);
        },
      });
      sync.current = controller; void controller.refresh();
    }
    start();
    const refresh = () => { if (document.visibilityState === 'visible') void sync.current?.refresh(); };
    const retry = () => { void sync.current?.retry(); };
    const protect = (event: BeforeUnloadEvent) => { if (sync.current?.hasPending()) { event.preventDefault(); event.returnValue = ''; } };
    const timer = setInterval(refresh, 30000);
    window.addEventListener('focus', refresh); window.addEventListener('online', retry);
    window.addEventListener('tech-phase:membership-changed', start);
    window.addEventListener('beforeunload', protect); document.addEventListener('visibilitychange', refresh);
    return () => {
      sync.current?.dispose(); sync.current = null; clearInterval(timer);
      window.removeEventListener('focus', refresh); window.removeEventListener('online', retry);
      window.removeEventListener('tech-phase:membership-changed', start);
      window.removeEventListener('beforeunload', protect); document.removeEventListener('visibilitychange', refresh);
    };
  }, []);
  const displayed = cloud?.document ?? (status === 'guest' ? local : emptySavedDocument());
  function update(change: (current: SavedDocument) => SavedDocument) {
    if (status !== 'guest') return sync.current?.update(change) ?? false;
    try {
      // Read again immediately before a device-only write, preserving other tabs.
      const [ids, entries] = JSON.parse(localSnapshot()) as [string, [string, string][]];
      const before = { saved: parseSavedIds(ids), notebooks: Object.fromEntries(entries.map(([k, v]) => [k, parseAnnotations(v)])) };
      const next = validateSavedDocument(change(before));
      if (JSON.stringify(before.saved) !== JSON.stringify(next.saved)) localStorage.setItem(savedKey, JSON.stringify(next.saved));
      for (const [key, marks] of Object.entries(next.notebooks)) if (JSON.stringify(marks) !== JSON.stringify(before.notebooks[key] ?? [])) localStorage.setItem(`${inkPrefix}${key}`, JSON.stringify(marks));
      window.dispatchEvent(new Event(changed)); window.dispatchEvent(new Event('tech-phase:annotations-changed')); return true;
    } catch { return false; }
  }
  function commitMarks(articleId: string, lang: string, previous: string, marks: Annotation[]) {
    const key = notebookKey(articleId, lang);
    return update(current => {
      if (JSON.stringify(current.notebooks[key] ?? []) !== previous) throw new Error('stale-marks');
      return { ...current, notebooks: { ...current.notebooks, [key]: marks } };
    });
  }
  return { document: displayed, status, scope: cloud?.account ?? status, ready: !!cloud || status === 'guest', editable: status === 'guest' || !!cloud && status !== 'conflict', update, commitMarks,
    retry: () => { void sync.current?.retry(); }, discardPending: () => {
      try { if (importKey) localStorage.removeItem(importKey); } catch { /* Original browser data is retained. */ }
      void sync.current?.discardPending();
    },
    canImport: !!cloud && status === 'synced' && imported !== raw && hasBrowserResearch(cloud.document, local),
    importLocal: () => {
      const accepted = update(current => importBrowserResearch(current, local, () => crypto.randomUUID()));
      if (accepted && importKey) {
        // Only suppress repeat prompts after the account draft is durably queued.
        // Discarding a conflicting migration clears this marker and offers it again.
        try { localStorage.setItem(importKey, raw); window.dispatchEvent(new Event(changed)); } catch { /* A repeat import remains idempotent. */ }
      }
      return accepted;
    },
  };
}
