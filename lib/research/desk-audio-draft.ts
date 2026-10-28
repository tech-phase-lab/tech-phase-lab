import type { AudioSpan } from "./desk-audio-edit";
export type AudioCutDraft = { history: AudioSpan[][]; from: number; to: number; length: number; sampleRate: number };
export type AudioDraftMeta = { title: string; edited: boolean; cut: AudioCutDraft | null };
type AudioDraftFiles = { file: File; original: File };
let database: Promise<IDBDatabase> | undefined;
let writes: Promise<unknown> = Promise.resolve();
function open() {
  if (!database) database = new Promise<IDBDatabase>((resolve, reject) => {
    if (typeof indexedDB === "undefined") { reject(Error("storage-unavailable")); return; }
    const request = indexedDB.open("tech-phase-desk-audio", 1);
    request.onupgradeneeded = () => request.result.createObjectStore("drafts");
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  }).catch(error => { database = undefined; throw error; });
  return database;
}
// Keep files separate: changing a title or cut position never rewrites a 50MB blob.
export function saveAudioDraft(key: string, meta: AudioDraftMeta | null, files?: AudioDraftFiles) {
  const operation = writes.catch(() => {}).then(async () => {
    const db = await open();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction("drafts", "readwrite"), store = tx.objectStore("drafts");
      if (meta === null) { store.delete(key + ":meta"); store.delete(key + ":files"); }
      else { store.put(meta, key + ":meta"); if (files) store.put(files, key + ":files"); }
      tx.oncomplete = () => resolve(); tx.onerror = tx.onabort = () => reject(tx.error || Error("storage-failed"));
    });
  });
  writes = operation; return operation;
}
export async function loadAudioDraft(key: string) {
  await writes.catch(() => {});
  const db = await open();
  return new Promise<{ meta: AudioDraftMeta; file: File; original: File } | null>((resolve, reject) => {
    const tx = db.transaction("drafts", "readonly"), store = tx.objectStore("drafts");
    const meta = store.get(key + ":meta"), files = store.get(key + ":files");
    tx.oncomplete = () => resolve(meta.result && files.result ? { meta: meta.result, ...files.result } : null);
    tx.onerror = tx.onabort = () => reject(tx.error || Error("storage-failed"));
  });
}
export function validCutDraft(cut: AudioCutDraft, length: number, sampleRate: number) {
  if (!cut || cut.length !== length || cut.sampleRate !== sampleRate || !Array.isArray(cut.history) || !cut.history.length || cut.history.length > 51) return false;
  if (!cut.history.every(spans => Array.isArray(spans) && spans.length > 0 && spans.length <= 51 && spans.every((span, i) => Array.isArray(span) && span.length === 2 && Number.isInteger(span[0]) && Number.isInteger(span[1]) && span[0] >= (i ? spans[i - 1][1] : 0) && span[0] < span[1] && span[1] <= length))) return false;
  const duration = cut.history.at(-1)!.reduce((sum, [a,b]) => sum + b - a, 0) / sampleRate;
  return Number.isFinite(cut.from) && Number.isFinite(cut.to) && cut.from >= 0 && cut.to >= cut.from && cut.to <= duration;
}
