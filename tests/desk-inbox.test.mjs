import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";

const read = path => readFileSync(new URL(path, import.meta.url), "utf8");
const load = path => import("data:text/javascript;base64," + Buffer.from(stripTypeScriptTypes(read(path).replace('import { getMembership } from "@/lib/membership/server";', "const getMembership = async () => globalThis.__inbox.member;"))).toString("base64"));
const ID = "12345678-1234-4234-8234-123456789abc";

async function withMonitor(run) {
  const saved = { fetch: globalThis.fetch, url: process.env.RESEARCH_MONITOR_URL, token: process.env.RESEARCH_EDITOR_TOKEN };
  const state = globalThis.__inbox = { member: { status: "signed-in", isAdmin: true }, calls: [], answers: {} };
  process.env.RESEARCH_MONITOR_URL = "https://monitor.example"; process.env.RESEARCH_EDITOR_TOKEN = "editor-token-at-least-24-characters";
  globalThis.fetch = async (url, init) => {
    const path = new URL(String(url)).pathname; state.calls.push({ path, url: String(url), init });
    return Response.json(state.answers[path] ?? { ok: true });
  };
  try { await run(state); } finally {
    globalThis.fetch = saved.fetch; delete globalThis.__inbox;
    for (const [key, value] of [["RESEARCH_MONITOR_URL", saved.url], ["RESEARCH_EDITOR_TOKEN", saved.token]]) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  }
}
const post = (body, origin = "https://example.test") => new Request("https://example.test/api/research/desk-inbox", { method: "POST", headers: { origin, "content-type": "application/json" }, body: JSON.stringify(body) });

test("the inbox list, playback link, rename and read are for the signed-in owner only and use the editor token", async () => {
  const { GET, POST } = await load("../app/api/research/desk-inbox/route.ts");
  await withMonitor(async state => {
    state.answers["/admin/inbox/items"] = { ok: true, items: [{ id: ID, title: "朝のメモ", at: "2026-11-02T00:00:00.000+00:00", seconds: 42, isNew: true }] };
    state.answers["/admin/inbox/key"] = { ok: true, exists: true };
    const list = await (await GET(new Request("https://example.test/api/research/desk-inbox"))).json();
    assert.deepEqual([list.enabled, list.items[0].title], [true, "朝のメモ"]);
    assert.ok(state.calls.every(call => call.init.headers.Authorization === "Bearer editor-token-at-least-24-characters"));
    state.member = { status: "signed-in", isAdmin: false };
    const before = state.calls.length;
    assert.equal((await GET(new Request("https://example.test/api/research/desk-inbox"))).status, 403);
    assert.equal((await POST(post({ action: "rename", id: ID, title: "x" }))).status, 403);
    assert.equal(state.calls.length, before, "a member never reaches the monitor");
    state.member = { status: "signed-out" };
    assert.equal((await GET(new Request("https://example.test/api/research/desk-inbox"))).status, 403);
  });
});

test("playback follows only a signed address in the private bucket, and bad ids or titles are refused", async () => {
  const { GET, POST } = await load("../app/api/research/desk-inbox/route.ts");
  await withMonitor(async state => {
    state.answers["/admin/inbox/file"] = { ok: true, url: `https://${"a".repeat(32)}.r2.cloudflarestorage.com/bucket/inbox/x.m4a?X-Amz-Signature=1` };
    const go = await GET(new Request(`https://example.test/api/research/desk-inbox?id=${ID}`));
    assert.equal(go.status, 307); assert.match(go.headers.get("location"), /^https:\/\/a{32}\.r2\.cloudflarestorage\.com\//);
    state.answers["/admin/inbox/file"] = { ok: true, url: "https://evil.example/x" };
    assert.equal((await GET(new Request(`https://example.test/api/research/desk-inbox?id=${ID}`))).status, 503);
    assert.equal((await GET(new Request("https://example.test/api/research/desk-inbox?id=../x"))).status, 400);
    for (const title of ["", "   ", "x".repeat(81), "a\0b", 5]) assert.equal((await POST(post({ action: "rename", id: ID, title }))).status, 400);
    assert.equal((await POST(post({ action: "rename", id: ID, title: "新しい名前" }, "https://evil.test"))).status, 403);
    assert.equal((await POST(post({ action: "rename", id: ID, title: "新しい名前" }))).status, 200);
    assert.equal(JSON.parse(state.calls.at(-1).init.body).title, "新しい名前");
    assert.equal((await POST(post({ action: "delete", id: ID }))).status, 400);
  });
});

test("the inbox key is made by the owner only, shown once, and never kept or logged by this site", async () => {
  const { GET, POST } = await load("../app/api/research/desk-inbox/key/route.ts");
  await withMonitor(async state => {
    state.answers["/admin/inbox/key"] = { ok: true, exists: true, createdAt: "2026-11-02T00:00:00.000+00:00", key: "tpinbox_abcdefghijklmnopqrstuvwxyz0123456789ABCDEFG" };
    const status = await (await GET()).json();
    assert.deepEqual([status.exists, status.startUrl, status.finishUrl], [true, "https://monitor.example/inbox/start", "https://monitor.example/inbox/finish"]);
    const made = await POST(new Request("https://example.test/api/research/desk-inbox/key", { method: "POST", headers: { origin: "https://example.test" } }));
    assert.equal((await made.json()).key.startsWith("tpinbox_"), true);
    assert.equal(made.headers.get("cache-control"), "private, no-store");
    assert.equal((await POST(new Request("https://example.test/api/research/desk-inbox/key", { method: "POST", headers: { origin: "https://evil.test" } }))).status, 403);
    state.member = { status: "signed-in", isAdmin: false };
    const count = state.calls.length;
    assert.equal((await GET()).status, 403);
    assert.equal((await POST(new Request("https://example.test/api/research/desk-inbox/key", { method: "POST", headers: { origin: "https://example.test" } }))).status, 403);
    assert.equal(state.calls.length, count);
  });
  const source = read("../app/api/research/desk-inbox/key/route.ts");
  assert.doesNotMatch(source, /console\./);
});

test("the inbox screens: rename in the list, the key page for the owner, the proxy covers the routes (Nov 2)", () => {
  const sheet = read("../app/research/desk/inbox-sheet.tsx");
  assert.match(sheet, /action: "rename"/); assert.match(sheet, /aria-label="タイトルを変える"/); assert.match(sheet, /href="\/research\/inbox-key"/);
  const page = read("../app/research/inbox-key/page.tsx");
  assert.match(page, /!member\.isAdmin\) redirect\("\/research\/notes"\)/);
  const screen = read("../app/research/inbox-key/screen.tsx");
  for (const text of ["新しく作る", "鍵をコピー", "この鍵は、いまだけ表示されます。", "Authorization", "PUT", "保存先の住所", "②をコピー"]) assert.ok(screen.includes(text), text);
  assert.doesNotMatch(screen, /localStorage|sessionStorage/, "the key is kept only on the screen");
  assert.match(read("../proxy.ts"), /\/api\/research\/desk-inbox\/:path\*/);
  const python = read("../scripts/research/voice_inbox.py");
  assert.match(python, /hashlib\.sha256\(key\.encode\(\)\)/);
  assert.doesNotMatch(python, /print\([^)]*key\b/, "the key is never printed");
});

test("the inbox closes by dragging its top bar down, and the four attach tiles are low (Nov 3)", () => {
  const sheet = read("../app/research/desk/inbox-sheet.tsx");
  for (const text of ["onPointerDown", "onPointerMove", "onPointerUp", "onPointerCancel", "gesture.dy > 90", "translateY"]) assert.ok(sheet.includes(text), text);
  assert.match(read("../app/research/desk/inbox-sheet.module.css"), /\.handle\{[^}]*touch-action:none/);
  const tile = read("../app/research/desk/format.module.css").match(/\.audioUpload \.attachTile\{[^}]*?height:(\d+)px/);
  assert.ok(tile && Number(tile[1]) <= 76, "tiles are no taller than 76px");
});
