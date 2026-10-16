import test from 'node:test';
import assert from 'node:assert/strict';
import { saveNotebookPdf } from '../lib/research/save-notebook-pdf.ts';

const file = new File(['%PDF-'], 'research.pdf', { type: 'application/pdf' });
test('file sharing starts synchronously in the tap and never navigates the article', async () => {
  let shared = false;
  const result = saveNotebookPdf(file, 'blob:pdf', 'Research', {
    canShare: data => data.files[0] === file,
    share: data => { assert.equal(data.files[0], file); shared = true; return Promise.resolve(); },
  }, { createElement() { assert.fail('Sharing must not open another page'); } });
  assert.equal(shared, true);
  await result;
});

test('cancelling file sharing does not fall through to a download or navigation', async () => {
  await assert.rejects(saveNotebookPdf(file, 'blob:pdf', 'Research', {
    canShare: () => true,
    share: () => Promise.reject(new DOMException('Cancelled', 'AbortError')),
  }, { createElement() { assert.fail('Cancellation must leave the article alone'); } }), { name: 'AbortError' });
});

test('download fallback targets a separate tab and removes its temporary link', async () => {
  let clicked = false, removed = false;
  const link = { click() {
    assert.equal(this.target, '_blank'); assert.equal(this.download, file.name);
    assert.equal(this.href, 'blob:pdf'); assert.equal(this.rel, 'noopener'); clicked = true;
  }, remove() { removed = true; } };
  await saveNotebookPdf(file, 'blob:pdf', 'Research', {}, {
    createElement: name => { assert.equal(name, 'a'); return link; },
    body: { append: element => assert.equal(element, link) },
  });
  assert.equal(clicked, true); assert.equal(removed, true);
});
