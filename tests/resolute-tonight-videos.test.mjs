import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, statSync } from "node:fs";

test("今夜のひと息: the owner's BGM videos are set in Japanese and English and the files exist (owner, Nov 17)", () => {
  const source = readFileSync(new URL("../lib/resolute/tonight-videos.ts", import.meta.url), "utf8");
  for (const id of ["breathe", "steady", "history"]) for (const lang of ["ja", "en"]) {
    const path = `/media/resolute-tonight/${id}-${lang}.mp4`;
    assert.ok(source.includes(`'${path}'`), path);
    const file = new URL(`../public${path}`, import.meta.url);
    assert.ok(statSync(file).size > 1_000_000, path);
    assert.equal(readFileSync(file).subarray(4, 8).toString("latin1"), "ftyp", `${path} is an MP4`);
  }
  assert.doesNotMatch(source, /url:null/, "every video has a file");
  // Owner, Nov 17: before playing, each video shows one of its own frames instead of an empty panel.
  for (const id of ["breathe", "steady", "history"]) for (const lang of ["ja", "en"]) {
    const poster = `/media/resolute-tonight/${id}-${lang}.jpg`;
    assert.ok(source.includes(`poster:'${poster}'`), poster);
    assert.equal(readFileSync(new URL(`../public${poster}`, import.meta.url)).subarray(0, 2).toString("hex"), "ffd8", `${poster} is a JPEG`);
  }
  assert.match(readFileSync(new URL("../app/resolute/tonight/screen.tsx", import.meta.url), "utf8"), /poster=\{video\.poster\?\?undefined\}/);
});
