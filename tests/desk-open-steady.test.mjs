// Owner, Nov 18: RIZEL'S DESK opened in about three visible stages (the full-screen loading mark, then the notes with a small editor
// placeholder, then the editor growing and each reaction badge pushing the notes down). It now stands in its final layout at once.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const read = path => readFile(new URL(path, import.meta.url), 'utf8');

test('opening the desk shows its own layout (same shell, title and menu) instead of the full-screen loading mark', async () => {
  const loading = await read('../app/research/notes/loading.tsx');
  const columns = await read('../app/research/columns/columns.tsx');
  assert.match(loading, /<ResearchToolShell desk compactTitle lang=\{lang\} setLang=\{setLang\} title=\{postNames\.notes\[lang\]\} description=\{ja \? "PRO会員だけに、本音を。" : "Candid thoughts, for PRO members only\."\}>/);
  assert.match(columns, /<ResearchToolShell desk compactTitle lang=\{lang\} setLang=\{setLang\} title=\{initialKind === "all" \? "RIZEL’S DESK" : initialKind === "qa" \? ja \? "リゼルに聞く" : "Ask Rizel" : postNames\[initialKind\]\[lang\]\} description=\{initialKind === "notes" \? \(ja \? "PRO会員だけに、本音を。" : "Candid thoughts, for PRO members only\."\)/, 'the page uses the same shell props, so nothing above the notes moves');
  assert.match(loading, /className=\{styles\.placeholder\}/, 'the same quiet placeholder as the page uses while it loads');
  const research = await read('../app/research/loading.tsx');
  assert.match(research, /if \(pathname === "\/research\/notes"\) return <NotesLoading \/>;/, 'the research-wide boundary above the desk shows the desk layout too');
  assert.match(loading, /ownerMode \? <div className=\{composerStyles\.slot\}/, "the owner's post box is held at its final size");
});

test("the owner's post box keeps its final size while the editor loads, and before the membership display starts", async () => {
  const css = await read('../app/research/notes/composer.module.css');
  const composer = await read('../app/research/notes/composer.tsx');
  const columns = await read('../app/research/columns/columns.tsx');
  // Measured in WebKit: the empty editor is 266px tall at 360px and wider, 311px below (the toolbar wraps).
  assert.match(css, /\.editorSlot\{min-height:266px\}/);
  assert.match(css, /\.slot\{box-sizing:content-box;height:266px;margin:0 0 30px;padding:18px;border:1\.5px solid #8f7851;border-radius:26px/);
  assert.match(css, /\.composer\{margin:0 0 30px;padding:18px;border:1\.5px solid #8f7851;border-radius:26px/, 'the frame matches the post box');
  assert.match(css, /@media\(max-width:359px\)\{\.editorSlot\{min-height:311px\}\.slot\{height:311px\}\}/);
  assert.match(css, /:global\(html\[data-member-hint="owner"\]\) \.hinted\{display:block\}/, 'shown before hydration only on the owner\'s device');
  assert.match(composer, /<div className=\{styles\.editorSlot\}><DeskTextEditor label="ひとりごとの本文"/);
  assert.match(columns, /steadyOwner \? <SteadyNoteComposer onPublished=\{published\} \/> : !settled && <div className=\{`\$\{composerStyles\.slot\} \$\{composerStyles\.hinted\}`\} aria-hidden="true" \/>/);
});

test('the notes arrive with their reaction counts, on the server and in the browser', async () => {
  const server = await read('../app/research/columns/server-posts.tsx');
  const columns = await read('../app/research/columns/columns.tsx');
  assert.match(server, /preloadReactions\(\(data\.items as EditorialPost\[\]\)\.filter\(item => item\.kind === "notes"\)/);
  assert.match(server, /valid && data\.access === "pro" \?/, 'only for a PRO reader, as the relay requires');
  assert.match(columns, /const reactions = data\.access === "pro" \? await preloadReactions\(/);
  assert.match(columns, /accept\(\{ items: data\.items, access: data\.access, status: "ready", validUntil: data\.validUntil, reactions \}\)/);
  assert.match(columns, /reactions=\{shown\.reactions\?\.\[item\.id\]\}/);
  assert.match(columns, /useReactions\(item\.id, item\.kind === "notes" && access === "pro", preloaded\)/);
});
