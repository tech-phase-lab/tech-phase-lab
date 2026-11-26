// 今夜のひと息 (owner, Nov 26): 「スマホで自分で設定しないと動画が横画面にならないの不便すぎる」. On a phone the video plays landscape
// without touching the phone's rotation lock: Android goes full screen and locks landscape; iPhone (no element full screen, no
// orientation lock) gets an in-page view turned 90° by CSS while the screen is upright. PCs keep the plain full-screen button.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { enterLandscape, exitLandscape, LANDSCAPE_VIEW_QUERY } from "../lib/resolute/tonight-landscape.ts";

function fakeEnvironment({ lock = "ok", exit = true } = {}) {
  const calls = [];
  let fullscreen = null;
  const env = {
    fullscreenElement: () => fullscreen,
    exitFullscreen: exit ? async () => { calls.push("exitFullscreen"); fullscreen = null; } : undefined,
    orientation: lock === "missing" ? { unlock() { calls.push("unlock"); } } : {
      async lock(value) { calls.push(`lock:${value}`); if (lock === "refused") throw new Error("NotSupportedError"); },
      unlock() { calls.push("unlock"); },
    },
  };
  const box = {
    async requestFullscreen(options) { calls.push(`requestFullscreen:${options?.navigationUI}`); fullscreen = box; },
  };
  return { env, box, calls, setFullscreen: (value) => { fullscreen = value; } };
}

test("Android: full screen first, then the landscape lock; closing unlocks and leaves full screen", async () => {
  const { env, box, calls } = fakeEnvironment();
  assert.equal(await enterLandscape(box, env), "locked");
  assert.deepEqual(calls, ["requestFullscreen:hide", "lock:landscape"]);
  await exitLandscape(env);
  assert.deepEqual(calls.slice(2), ["unlock", "exitFullscreen"]);
  await exitLandscape(env); // closing twice (the end of the video, then the close button) is harmless
  assert.deepEqual(calls.slice(4), ["unlock"]);
});

test("A refused lock leaves full screen so the CSS can turn the view in the page; a refused full screen stays in the page", async () => {
  // The browser's full-screen style forces transform:none, so a full-screen box upright cannot be turned.
  const refused = fakeEnvironment({ lock: "refused" });
  assert.equal(await enterLandscape(refused.box, refused.env), "page");
  assert.deepEqual(refused.calls, ["requestFullscreen:hide", "lock:landscape", "exitFullscreen"]);
  assert.equal(refused.env.fullscreenElement(), null);
  const missing = fakeEnvironment({ lock: "missing" });
  assert.equal(await enterLandscape(missing.box, missing.env), "page");
  assert.equal(missing.env.fullscreenElement(), null);
  const denied = fakeEnvironment();
  denied.box.requestFullscreen = async () => { throw new Error("TypeError: not allowed"); };
  assert.equal(await enterLandscape(denied.box, denied.env), "page");
  assert.ok(!denied.calls.some((c) => c.startsWith("lock")), "no lock without full screen");
});

test("iPhone: no element full screen and no orientation lock, so the view stays in the page and nothing throws", async () => {
  const env = { fullscreenElement: () => null, exitFullscreen: undefined, orientation: { type: "portrait-primary" } };
  assert.equal(await enterLandscape({}, env), "page");
  await exitLandscape(env);
  await exitLandscape({ fullscreenElement: () => null, orientation: null });
});

test("Phones only: the landscape view is for touch screens under the PC width; PCs keep the plain full-screen button", () => {
  assert.equal(LANDSCAPE_VIEW_QUERY, "(hover: none) and (pointer: coarse) and (max-width: 1023.98px)");
  const desktop = readFileSync(new URL("../app/resolute/use-desktop.ts", import.meta.url), "utf8");
  assert.match(desktop, /DESKTOP_QUERY = "\(min-width: 1024px\)"/, "the phone width ends where the PC layout starts");
  const screen = readFileSync(new URL("../app/resolute/tonight/screen.tsx", import.meta.url), "utf8");
  const player = screen.slice(screen.indexOf("function TonightVideo"));
  assert.match(player, /const fullscreen=\(\)=>\{if\(landscape\)\{closeLandscape\(\);return;\}if\(phone\(\)\)\{openLandscape\(\);return;\}/);
  assert.match(player, /if\(el\?\.requestFullscreen\)void el\.requestFullscreen\(\)\.catch\(\(\)=>v\?\.webkitEnterFullscreen\?\.\(\)\)/, "the PC path is unchanged");
  assert.match(player, /if\(v\.paused\)\{if\(!landscape&&phone\(\)\)openLandscape\(\);play\(\);\}/, "starting the video on a phone opens the view");
  assert.match(player, /const ended=\(\)=>\{setPlaying\(false\);if\(landscape\)closeLandscape\(\);\}/, "the end of the video closes the view");
  assert.match(player, /aria-label=\{en\?'Close':'閉じる'\} data-tonight-close/, "the close button is icon-only with the existing label");
  assert.match(player, /addEventListener\('fullscreenchange'/, "leaving full screen with the phone's back gesture closes the view");
  const css = readFileSync(new URL("../app/resolute/tonight/reference.module.css", import.meta.url), "utf8");
  assert.match(css, /\.player\.landscape \{ position:fixed; inset:0;/);
  assert.match(css, /@media \(orientation: portrait\) \{\n \.player\.landscape \{[^}]*transform:translate\(-50%,-50%\) rotate\(90deg\);/, "upright screens get the picture turned");
});
