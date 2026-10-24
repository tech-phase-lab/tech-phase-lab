import { parseAnnotations, type Annotation } from './annotations.ts';
export type SavedDocument = { saved: string[]; notebooks: Record<string, Annotation[]> };
export const emptySavedDocument = (): SavedDocument => ({ saved: [], notebooks: {} });
export const notebookKey = (articleId: string, lang: string) => `${encodeURIComponent(articleId)}:${lang}`;
export const savedDocumentLimit = 1_000_000;
export function validateSavedDocument(value: unknown): SavedDocument {
  if (!value || typeof value !== 'object') throw new Error('invalid-document');
  const { saved, notebooks } = value as SavedDocument;
  if (!Array.isArray(saved) || saved.length > 2000 || new Set(saved).size !== saved.length || saved.some(id => typeof id !== 'string' || !id.length || id.length > 300)) throw new Error('invalid-saves');
  if (!notebooks || typeof notebooks !== 'object' || Array.isArray(notebooks) || Object.keys(notebooks).length > 4000) throw new Error('invalid-notebooks');
  const clean: SavedDocument = { saved: [...saved], notebooks: {} };
  for (const [key, marks] of Object.entries(notebooks)) {
    if (!/^.{1,900}:(ja|en)$/.test(key) || !Array.isArray(marks) || marks.length > 200 || parseAnnotations(JSON.stringify(marks)).length !== marks.length) throw new Error('invalid-marks');
    clean.notebooks[key] = marks.map(({ id, kind, color, note, parts }) => ({ id, kind, color, note, parts: parts.map(({ block, start, end, quote }) => ({ block, start, end, quote })) }));
  }
  if (new TextEncoder().encode(JSON.stringify(clean)).length > savedDocumentLimit) throw new Error('document-too-large');
  return clean;
}
const markValue = (mark: Annotation | undefined) => mark && [mark.id, mark.kind, mark.color, mark.note, mark.parts.map(p => [p.block, p.start, p.end, p.quote])];
export function sameSavedDocument(a: SavedDocument, b: SavedDocument) {
  const canonical = (doc: SavedDocument) => JSON.stringify({ saved: doc.saved, notebooks: Object.entries(doc.notebooks).filter(([, v]) => v.length).sort(([a], [b]) => a.localeCompare(b)).map(([key, marks]) => [key, marks.map(markValue)]) });
  return canonical(a) === canonical(b);
}
/** Three-way merge: distinct marks merge; editing/deleting the same mark conflicts. */
export function mergeSavedDocuments(base: SavedDocument, local: SavedDocument, remote: SavedDocument): SavedDocument | null {
  const saved = remote.saved.filter(id => !base.saved.includes(id) || local.saved.includes(id));
  for (const id of local.saved) if (!base.saved.includes(id) && !saved.includes(id)) saved.push(id);
  const notebooks: SavedDocument['notebooks'] = {};
  for (const key of new Set([...Object.keys(base.notebooks), ...Object.keys(local.notebooks), ...Object.keys(remote.notebooks)])) {
    const b = new Map((base.notebooks[key] ?? []).map(m => [m.id, m]));
    const l = new Map((local.notebooks[key] ?? []).map(m => [m.id, m]));
    const r = new Map((remote.notebooks[key] ?? []).map(m => [m.id, m]));
    const marks: Annotation[] = [];
    for (const id of new Set([...r.keys(), ...l.keys(), ...b.keys()])) {
      const original = b.get(id), mine = l.get(id), theirs = r.get(id);
      const same = (a: Annotation | undefined, b: Annotation | undefined) => JSON.stringify(markValue(a)) === JSON.stringify(markValue(b));
      if (!same(mine, original) && !same(theirs, original) && !same(mine, theirs)) return null;
      const next = same(mine, original) ? theirs : mine;
      if (next) marks.push(next);
    }
    if (marks.length) notebooks[key] = marks;
  }
  try { return validateSavedDocument({ saved, notebooks }); } catch { return null; }
}

// Migration is additive even when another device already populated the account.
const sameImportedMark = (a: Annotation, b: Annotation) => JSON.stringify(markValue(a)?.slice(1)) === JSON.stringify(markValue(b)?.slice(1));
export function hasBrowserResearch(account: SavedDocument, browser: SavedDocument) {
  return browser.saved.some(id => !account.saved.includes(id)) || Object.entries(browser.notebooks).some(([key, marks]) => marks.some(mark => !(account.notebooks[key] ?? []).some(other => sameImportedMark(mark, other))));
}
export function importBrowserResearch(account: SavedDocument, browser: SavedDocument, makeId: () => string): SavedDocument {
  const notebooks = { ...account.notebooks };
  for (const [key, source] of Object.entries(browser.notebooks)) {
    const marks = [...(notebooks[key] ?? [])];
    for (const mark of source) {
      if (marks.some(other => sameImportedMark(mark, other))) continue;
      marks.push(marks.some(other => other.id === mark.id) ? { ...mark, id: makeId() } : mark);
    }
    notebooks[key] = marks;
  }
  return validateSavedDocument({ saved: [...account.saved, ...browser.saved.filter(id => !account.saved.includes(id))], notebooks });
}
