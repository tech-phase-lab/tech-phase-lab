import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { isFresh } from "../app/research/desk/use-minute.ts";
import { deskImageFile, validImageUpload, isJpeg, maxDeskImageBytes } from "../lib/research/desk-audio.ts";
const read = path => readFile(new URL(path, import.meta.url), "utf8");

test("a post is NEW for the first 60 minutes only", () => {
  const at = "2026-11-02T01:00:00Z", minute = Date.parse(at) / 60_000;
  assert.equal(isFresh(minute + 10, at), true);
  assert.equal(isFresh(minute + 59, at), true);
  assert.equal(isFresh(minute + 60, at), false);
  assert.equal(isFresh(minute + 600, at), false);
  assert.equal(isFresh(0, at), false, "the server's clock is 0, so nothing is NEW before the browser takes over");
});

test("photos: only a JPEG made in the browser, 512 bytes to 6 MB, with a uuid name", () => {
  assert.equal(validImageUpload(100_000), true);
  assert.equal(validImageUpload(100), false);
  assert.equal(validImageUpload(maxDeskImageBytes + 1), false);
  assert.equal(validImageUpload("5000"), false);
  assert.equal(deskImageFile.test("12345678-1234-4234-8234-123456789abc.jpg"), true);
  assert.equal(deskImageFile.test("12345678-1234-4234-8234-123456789abc.png"), false);
  assert.equal(deskImageFile.test("../12345678-1234-4234-8234-123456789abc.jpg"), false);
  assert.equal(isJpeg(Uint8Array.from([0xff, 0xd8, 0xff, 0xe0])), true);
  assert.equal(isJpeg(Uint8Array.from([0x89, 0x50, 0x4e])), false);
});

test("photo routes: owner-only upload, private bucket, a note's photo is served to PRO only when that note shows it", async () => {
  const post = await read("../app/api/research/desk-media/route.ts");
  assert.match(post, /action === "start-image" && validImageUpload/);
  assert.match(post, /action === "finish-image"/);
  assert.match(post, /!member\.isAdmin\) return reply\(403, \{ ok: false, error: "owner-required" \}\)/);
  const get = await read("../app/api/research/desk-media/[file]/route.ts");
  assert.match(get, /deskImageFile\.test\(file\)/);
  assert.match(get, /\[\$\{photo \? "image" : "audio"\}\]\(\/api\/research\/desk-media\/\$\{file\}\)/, "the post must carry exactly this attachment line");
  const storage = await read("../lib/research/desk-audio-storage.ts");
  assert.match(storage, /Metadata: \{ verified: "jpg" \}/);
  assert.match(storage, /isJpeg\(bytes\)/);
  const body = await read("../app/research/desk/body.tsx");
  assert.match(body, /desk-media\\\/\[a-f0-9\]\{8\}.*\\\.jpg\$\/\.test\(value\)/);
});

test("the inbox is owner-only; its list, rename and key now come from the monitoring service (Nov 2)", async () => {
  const route = await read("../app/api/research/desk-inbox/route.ts");
  assert.match(route, /async function owner\(\) \{ const member = await getMembership\(\); return member\.status === "signed-in" && member\.isAdmin; \}/);
  assert.match(route, /RESEARCH_EDITOR_TOKEN/);
  assert.match(await read("../proxy.ts"), /\/api\/research\/desk-inbox\/:path\*/);
  const sheet = await read("../app/research/desk/inbox-sheet.tsx");
  assert.match(sheet, /選ぶと、添付に追加されます。あとから切り取りもできます。/);
  assert.match(sheet, /スマホから送った音声/);
});

test("the post box has the four attachment tiles, the 添付 button, the count and a docked 投稿 button without helper text (Nov 2)", async () => {
  const editor = await read("../app/research/desk/rich-editor.tsx");
  assert.match(editor, /閉じる ▲/);
  assert.match(editor, /画像URL/); assert.match(editor, /YouTube/);
  assert.match(editor, /<PhotoTile/);
  assert.doesNotMatch(editor, /動画はYouTubeリンクのみ/, "the line under the tiles is gone");
  const upload = await read("../app/research/desk/audio-upload.tsx");
  for (const label of ["音声ファイル", "受信箱"]) assert.match(upload, new RegExp(label));
  assert.match(await read("../app/research/desk/audio-recorder.tsx"), /ここで録音/);
  assert.match(await read("../app/research/desk/photo-tile.tsx"), /<span>\{progress === null \? "写真"/);
  const composer = await read("../app/research/notes/composer.tsx");
  assert.doesNotMatch(composer, /運営者だけに見えます|placeholder/);
  assert.doesNotMatch(composer, /通知|push/i, "no notification switch on the post screen");
  assert.match(composer, /disabled=\{busy \|\| mediaBusy \|\| !body\.trim\(\)\}/);
});

test("the owner's page header, timeline and NEW tag follow the design", async () => {
  const columns = await read("../app/research/columns/columns.tsx");
  assert.match(columns, /PRO会員だけに、本音を。/);
  assert.match(columns, /isFresh\(minute, item\.publishedAt!\)/);
  const css = await read("../app/research/columns/styles.module.css");
  assert.match(css, /\.newTag/);
  assert.match(css, /\.article\.note:last-of-type::before\{display:none\}/);
});

test("the phone notice for a new note: a setting in the notification page, off by default, no switch on the post screen", async () => {
  const view = await read("../app/research/notification-page-view.tsx");
  assert.match(view, /rizelNote: false \}/);
  assert.match(view, /onPrefs\(\{ rizelNote: v \}\)/);
  const python = await read("../scripts/research/web_push.py");
  assert.match(python, /note_posts INTEGER NOT NULL DEFAULT 0/);
  assert.match(python, /def deliver_notes/);
  assert.match(await read("../scripts/research/service.py"), /web_push\.deliver_notes\(db, notes\)/);
});

test("the voice memo paste import stays, and the audio title can be edited on the card (owner, Nov 2)", async () => {
  const upload = await read("../app/research/desk/audio-upload.tsx");
  assert.match(upload, /<VoiceMemoImport disabled=/);
  assert.match(upload, /onTitle=\{value => \{ setTitle\(value\); persist\(\{ title: value \}\); \}\}/);
  assert.match(await read("../app/research/desk/audio-card.tsx"), /aria-label="音声のタイトル"/);
});
