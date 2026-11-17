import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { isFresh, newNoteId, newestNote, nextSteadyOwner, NEW_TAG_MS } from "../app/research/desk/use-minute.ts";
const read = path => readFile(new URL(path, import.meta.url), "utf8");
const at = (base, minutes) => new Date(base - minutes * 60_000).toISOString();

test("1. the post box stays mounted while the membership is only being re-checked (reopen bug, Nov 16)", async () => {
  // A forced re-check (network back, access renewal, membership change) clears ownerMode and settled together.
  assert.equal(nextSteadyOwner(true, false, false), true, "re-checking: keep the editor and its focus");
  assert.equal(nextSteadyOwner(true, true, true), true);
  assert.equal(nextSteadyOwner(true, false, true), false, "a finished check that says not the owner removes it");
  assert.equal(nextSteadyOwner(false, false, false), false, "never shown to someone who was not the owner");
  assert.equal(nextSteadyOwner(false, true, false), true, "the owner always gets the post box");
  const columns = await read("../app/research/columns/columns.tsx");
  assert.match(columns, /initialKind === "notes" && steadyOwner && <SteadyNoteComposer onPublished=\{published\} \/>/);
  assert.match(columns, /const steadyOwner = useSteadyOwnerMode\(ownerMode, useMemberSettled\(\)\)/);
  assert.match(columns, /const SteadyNoteComposer = memo\(NoteComposer\)/);
  assert.match(columns, /const published = useCallback\(/, "a stable callback, so list refreshes do not re-render the editor");
});

test("2. the input text is 16px with a 1.7 line height; the composer's status rule no longer reaches the editor", async () => {
  const composer = await read("../app/research/notes/composer.module.css");
  assert.doesNotMatch(composer, /\.composer p\{/, "a descendant `p` rule shrank the editor's paragraphs to 12px");
  assert.match(composer, /\.composer>p\{margin:12px 0 0;color:#c7b997;font-size:12px/);
  const format = await read("../app/research/desk/format.module.css");
  const last = format.lastIndexOf(".editor .editable,.editor .editable p{font-size:16px;line-height:1.7}");
  assert.ok(last > 0);
  for (const size of format.slice(last).matchAll(/\.editable[^{]*\{[^}]*font-size:(\d+)px/g)) assert.ok(Number(size[1]) >= 16);
  const columns = await read("../app/research/columns/styles.module.css");
  assert.match(columns, /\.article\.note \.text\{font-size:17px;line-height:1\.9\}/, "posted text keeps its size");
});

test("3. native long-press selection is not overridden, and B / 赤 / マーカー keep a long-press selection", async () => {
  const format = await read("../app/research/desk/format.module.css");
  assert.doesNotMatch(format, /::selection/);
  assert.doesNotMatch(format, /\.editor[^{}]*\{[^}]*user-select:none/);
  assert.match(format, /\.editor,\.editor \.editable,\.editor \.editable \*\{-webkit-user-select:text;user-select:text;-webkit-touch-callout:default\}/);
  const editor = await read("../app/research/desk/rich-editor.tsx");
  assert.match(editor, /onPointerDownCapture=\{keep\}/);
  assert.match(editor, /if \(editor\.state\.selection\.empty && range && range\.to <= editor\.state\.doc\.content\.size\) chain\.setTextSelection\(range\);/);
  assert.doesNotMatch(editor, /onTouchStart|touchstart/);
});

test("4. date, time and zone (JST / ET) never split; NEW wraps under them; pencil and trash stay right", async () => {
  const columns = await read("../app/research/columns/columns.tsx");
  assert.match(columns, /<span className=\{styles\.stamp\}>\{date\}<small className=\{styles\.zone\}> \{zoneLabel\(lang\)\}<\/small><\/span>/);
  const css = await read("../app/research/columns/styles.module.css");
  assert.match(css, /\.stamp\{white-space:nowrap\}/);
  assert.match(css, /\.article\.note \.meta\{flex:1 1 auto;min-width:0;[^}]*flex-wrap:wrap/);
  assert.match(await read("../app/research/desk/format.module.css"), /\.postActions\{display:flex;align-items:center;gap:2px;margin-left:auto;flex-shrink:0\}/);
});

test("5. NEW: 30 minutes, newest note only, gone without a reload", async () => {
  const now = Date.parse("2026-11-16T11:34:00Z");
  assert.equal(NEW_TAG_MS, 30 * 60_000);
  const items = [
    { id: "b", kind: "notes", publishedAt: at(now, 20) },
    { id: "a", kind: "notes", publishedAt: at(now, 5) },
    { id: "q", kind: "qa", publishedAt: at(now, 1) },
    { id: "c", kind: "notes", publishedAt: at(now, 120) },
  ];
  assert.equal(newestNote(items).id, "a");
  assert.equal(newNoteId(items, now), "a", "only the newest of two posts within 30 minutes");
  assert.equal(newNoteId(items, now + 25 * 60_000 - 1), "a");
  assert.equal(newNoteId(items, now + 25 * 60_000), null, "30 minutes after posting, no NEW at all (the older one does not take it over)");
  assert.equal(newNoteId(items, 0), null, "nothing is NEW on the server");
  assert.equal(newNoteId([], now), null);
  assert.equal(isFresh(now, at(now, 29.99)), true);
  assert.equal(isFresh(now, at(now, 30)), false);
  const hook = await read("../app/research/desk/use-minute.ts");
  assert.match(hook, /for \(const edge of \[at - 60_000, at \+ NEW_TAG_MS\]\)/, "a timer fires at the exact end of the 30 minutes");
  assert.match(hook, /document\.addEventListener\("visibilitychange", wake\)/, "re-checked when the phone shows the page again");
  assert.match(await read("../app/research/columns/columns.tsx"), /const newNote = useNewNoteId\(shown\.items\.filter\(item => item\.kind === "notes"\)\)/);
});

test("the tool row fits inside the post box on a 360px phone, with tap targets of at least 36px (Nov 16)", async () => {
  const format = await read("../app/research/desk/format.module.css");
  const tail = format.slice(format.lastIndexOf("/* Nov 16 (owner): the tool row fits"));
  assert.match(tail, /\.editor \.toolbar\{flex-wrap:wrap;gap:6px;max-width:100%\}/);
  assert.match(tail, /@media\(max-width:420px\)\{[^\n]*\.editor \.toolbar button\{min-width:40px;padding:0 8px;font-size:14px/);
  for (const size of tail.matchAll(/min-(?:width|height):(\d+)px/g)) assert.ok(Number(size[1]) >= 36);
});
