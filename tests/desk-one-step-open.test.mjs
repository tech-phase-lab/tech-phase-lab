// Owner, Nov 21: 「この3つ RIZEL'S DESK（ひとりごと・リゼルに聞く・週刊PRO）の立ち上げがまだ3段階ぐらいになってる」 and
// 「週刊PROの下書きを書くがないけど？」. Measured on techphase.app: opening リゼルに聞く or 週刊PRO from the desk menu showed the full-screen
// TECH PHASE mark, then the desk with 「読み込み中…」, then the content; リゼルに聞く also flashed 「接続できませんでした」 before the answer.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { JSDOM } from 'jsdom';
import React, { act } from 'react';


const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');
const dom = new JSDOM('<!doctype html><html><body></body></html>', { pretendToBeVisual: true, url: 'https://example.test/research/weekly' });
for (const key of ['window', 'document', 'navigator', 'Node', 'Element', 'HTMLElement', 'MutationObserver', 'DOMParser']) Object.defineProperty(globalThis, key, { configurable: true, value: dom.window[key] });
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
// Loaded after the DOM globals exist, so React sees a browser (text input events).
const { createRoot } = await import('react-dom/client');
const tick = () => new Promise(resolve => setTimeout(resolve, 25));

// The page is mounted with its providers replaced: the shell renders its title and children, and the member display reads globalThis.__desk.
const stubs = { name: 'desk-stubs', setup(b) {
  b.onResolve({ filter: /^react$/, namespace: 'desk-stub' }, () => ({ path: 'react', external: true }));
  b.onResolve({ filter: /^next\/(image|link)$|\/(identity-provider|research-tool-shell|use-research-language|member-display-provider)$/ }, args => ({ path: args.path, namespace: 'desk-stub' }));
  b.onLoad({ filter: /.*/, namespace: 'desk-stub' }, args => ({ loader: 'js', contents:
    args.path === 'next/image' ? `import React from 'react';export default function Image(p){return React.createElement('img',{src:p.src,alt:p.alt})}`
    : args.path === 'next/link' ? `import React from 'react';export default function Link(p){return React.createElement('a',{href:p.href},p.children)}`
    : args.path.endsWith('research-tool-shell') ? `import React from 'react';export default function Shell(p){return React.createElement('main',null,React.createElement('h1',null,p.title),p.children)}`
    : `export const useIdentityRefresh=()=>globalThis.__desk.refresh,useResearchLanguage=()=>['ja',()=>{}],useMemberDisplay=()=>'pro',useMemberSettled=()=>globalThis.__desk.settled,useOwnerMode=()=>globalThis.__desk.ownerMode,useOwnerAccount=()=>globalThis.__desk.ownerMode;` }));
  b.onLoad({ filter: /\.css$/ }, () => ({ contents: 'export default new Proxy({}, {get: (_, key) => key})', loader: 'js' }));
} };
const refresh = async () => {};
async function load(path) {
  const dir = await mkdtemp(new URL('../.desk-open-', import.meta.url));
  try {
    const outfile = `${dir}/page.mjs`;
    await build({ entryPoints: [new URL(path, import.meta.url).pathname], bundle: true, platform: 'node', format: 'esm', packages: 'external', jsx: 'automatic', outfile, plugins: [stubs] });
    return (await import(pathToFileURL(outfile).href)).default;
  } finally { await rm(dir, { recursive: true, force: true }); }
}
async function mount(Component, props, { ownerMode = false, settled = true, fetch, identity = refresh } = {}) {
  globalThis.__desk = { ownerMode, settled, refresh: identity };
  const calls = [], original = globalThis.fetch;
  globalThis.fetch = async (url, options = {}) => { calls.push({ url: String(url), method: options.method ?? 'GET', body: options.body }); return fetch ? fetch(String(url), options) : { ok: true, status: 200, json: async () => ({ ok: true }) }; };
  const host = document.createElement('div'); document.body.append(host); const root = createRoot(host);
  let first = '';
  act(() => { root.render(React.createElement(Component, props)); });
  first = host.textContent;
  await act(async () => { await tick(); });
  return { host, calls, first, unmount: async () => { await act(async () => root.unmount()); host.remove(); globalThis.fetch = original; } };
}
const issue = { id: 'i1', number: 3, status: 'published', date: '2026-11-14', headline: '今週の見出し', lead: '今週のリード', parts: [{ type: 'text', heading: '本文の見出し', body: '本文です。' }], sources: [] };
const weeklyInitial = { issue, latest: 3, issues: [{ number: 3, date: '2026-11-14', headline: '今週の見出し' }], hasMore: false };
const ownerAnswer = { ok: true, drafts: [], settings: { autoPublish: false, generateEnabled: false, generateHour: 8 }, generation: { running: false, configured: true, lastOk: null, lastError: '' } };

test('週刊PRO: the owner has 「下書きを書く」 at the top of the page; a member does not', async () => {
  const WeeklyIssues = await load('../app/research/weekly/issues.tsx');
  const owner = await mount(WeeklyIssues, { initial: weeklyInitial }, { ownerMode: true, fetch: async () => ({ ok: true, status: 200, json: async () => ownerAnswer }) });
  try {
    const summary = owner.host.querySelector('main > details > summary');
    assert.equal(summary?.textContent, '下書きを書く', 'the folded entry is the first thing under the title');
    assert.equal(owner.host.querySelector('main > details').getAttribute('aria-hidden'), null, 'the real entry, not the reserved place');
  } finally { await owner.unmount(); }
  const member = await mount(WeeklyIssues, { initial: weeklyInitial }, { ownerMode: false });
  try {
    assert.ok(!member.host.textContent.includes('下書きを書く'), 'a PRO member never sees it');
    assert.equal(member.host.querySelector('details[aria-hidden="true"]'), null, 'nor its reserved place once the membership is known');
    assert.ok(member.host.textContent.includes('今週の見出し'));
  } finally { await member.unmount(); }
});

test("週刊PRO: before the membership is known, only the owner's device keeps the entry's place (by the hint set before the first paint)", async () => {
  const WeeklyIssues = await load('../app/research/weekly/issues.tsx');
  const page = await mount(WeeklyIssues, { initial: weeklyInitial }, { ownerMode: false, settled: false });
  try { assert.equal(page.host.querySelector('details[aria-hidden="true"]')?.className, 'composer hinted'); } finally { await page.unmount(); }
  const css = read('../app/research/weekly/styles.module.css');
  assert.match(css, /\.hinted\{display:none\}:global\(html\[data-member-hint="owner"\]\) \.hinted\{display:block\}/);
});

test('週刊PRO: a hand-written draft goes to the issue store as a new draft, through the owner-only route', async () => {
  const WeeklyIssues = await load('../app/research/weekly/issues.tsx');
  const page = await mount(WeeklyIssues, { initial: weeklyInitial }, { ownerMode: true, fetch: async url => ({ ok: true, status: 200, json: async () => url.includes('view=owner') ? ownerAnswer : { ok: true, item: { id: 'new' }, issue, latest: 3, issues: weeklyInitial.issues, hasMore: false } }) });
  try {
    const set = (label, value) => {
      const field = [...page.host.querySelectorAll('main > details label')].find(node => node.firstChild.textContent === label).querySelector('input,textarea');
      const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(field), 'value').set;
      act(() => { setter.call(field, value); field.dispatchEvent(new window.Event('input', { bubbles: true })); });
    };
    set('見出し(今回のひとこと)', '手で書いた見出し'); set('リード', '手で書いたリード'); set('本文の見出し', '今週の動き'); set('本文', '本文を手で書いた。');
    set('出典（1行に「資料名 | URL」）', '決算資料 | https://example.com/ir');
    await act(async () => { page.host.querySelector('main > details form').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true })); await tick(); });
    const post = page.calls.find(call => call.method === 'POST');
    assert.equal(post.url, '/api/research/weekly-issues');
    const sent = JSON.parse(post.body);
    assert.equal(sent.action, 'draft');
    assert.equal(sent.payload.id, null, 'no id: the service makes a new draft');
    assert.deepEqual(sent.payload.parts, [{ type: 'text', heading: '今週の動き', body: '本文を手で書いた。' }]);
    assert.deepEqual(sent.payload.sources, [{ title: '決算資料', url: 'https://example.com/ir' }]);
    assert.match(sent.payload.date, /^\d{4}-\d{2}-\d{2}$/);
    assert.ok(page.host.textContent.includes('下書きを保存しました'));
  } finally { await page.unmount(); }
  const route = read('../app/api/research/weekly-issues/route.ts');
  assert.match(route, /if \(member\.status !== "signed-in" \|\| !member\.isAdmin\) return reply\(403, \{ ok: false, error: "owner-required" \}\)/, 'saving stays the owner\'s alone on the server');
});

test('週刊PRO and リゼルに聞く open with the first page from the server: no 「読み込み中…」 step and no second request', async () => {
  const WeeklyIssues = await load('../app/research/weekly/issues.tsx');
  const weekly = await mount(WeeklyIssues, { initial: weeklyInitial }, { ownerMode: false });
  try {
    assert.ok(weekly.first.includes('今週の見出し') && !weekly.first.includes('読み込み中'), 'the issue is in the very first paint');
    assert.equal(weekly.calls.length, 0, 'the browser does not ask again for what the server sent');
  } finally { await weekly.unmount(); }
  const Questions = await load('../app/research/qa/questions.tsx');
  const items = [{ id: 'q-1', body: 'NVDAの決算はいつですか？', status: 'pending', answerPostId: null, createdAt: '2026-11-20T00:00:00.000Z' }];
  const qa = await mount(Questions, { initial: { items, hasNext: false, limit: 2, left: 2 } });
  try {
    assert.ok(qa.first.includes('NVDAの決算はいつですか？') && !qa.first.includes('読み込み中'));
    assert.equal(qa.calls.length, 0);
  } finally { await qa.unmount(); }
  for (const [page, route] of [['../app/research/weekly/page.tsx', 'weekly-issues'], ['../app/research/qa/page.tsx', 'questions']]) {
    const source = read(page);
    assert.match(source, new RegExp(`import \\{ GET \\} from "\\.\\./\\.\\./api/research/${route}/route";`), 'the same route and membership checks as the browser');
    assert.match(source, /await firstAnswer\(/, 'bounded in time; a slow or refused answer is left to the browser');
  }
  const first = read('../lib/research/first-answer.ts');
  assert.match(first, /limitMs = 3_000/); assert.match(first, /if \(!response \|\| !response\.ok\) return undefined;/);
});

test('the loading screen for リゼルに聞く and 週刊PRO is the page itself waiting, and asks nothing', async () => {
  const loading = read('../app/research/loading.tsx');
  assert.match(loading, /if \(pathname === "\/research\/qa"\) return <Questions standby \/>;/);
  assert.match(loading, /if \(pathname === "\/research\/weekly"\) return <WeeklyIssues standby \/>;/);
  const WeeklyIssues = await load('../app/research/weekly/issues.tsx');
  const weekly = await mount(WeeklyIssues, { standby: true }, { ownerMode: true });
  try {
    assert.equal(weekly.calls.length, 0);
    assert.equal(weekly.host.querySelector('h1').textContent, '週刊 Tech Phase PRO', 'the same title as the page');
    assert.ok(weekly.host.textContent.includes('読み込み中'), "the page's own waiting state");
  } finally { await weekly.unmount(); }
  const Questions = await load('../app/research/qa/questions.tsx');
  const qa = await mount(Questions, { standby: true });
  try { assert.equal(qa.calls.length, 0); assert.equal(qa.host.querySelector('h1').textContent, 'リゼルに聞く'); } finally { await qa.unmount(); }
});

test('リゼルに聞く keeps waiting while the sign-in library starts, instead of flashing 「接続できませんでした」', async () => {
  const Questions = await load('../app/research/qa/questions.tsx');
  const page = await mount(Questions, {}, { identity: async () => { throw Error('identity-loading'); } });
  try {
    assert.ok(!page.host.textContent.includes('接続できませんでした'));
    assert.ok(page.host.textContent.includes('読み込み中'));
    assert.equal(page.calls.length, 0);
  } finally { await page.unmount(); }
  const weekly = read('../app/research/weekly/issues.tsx');
  assert.match(weekly, /error\.message === "identity-loading"\)\) setState\("error"\)/);
  assert.match(weekly, /void refreshIdentity\(\)\.then\(\(\) => fetch\(`\/api\/research\/weekly-issues/, 'the token is renewed first, so a member is not shown the PRO lock');
});
