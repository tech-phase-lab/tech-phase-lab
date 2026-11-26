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
  // Owner, Nov 25: click the video to play, a play button in the middle (gone while playing), a bar with play/pause, seek, time and
  // full screen. The old small play mark at the bottom right was a page overlay (not in the cover image or the video) and is gone.
  const screen = readFileSync(new URL("../app/resolute/tonight/screen.tsx", import.meta.url), "utf8");
  assert.match(screen, /<TonightVideo key=\{video\.url\}/, "switching video or language remounts the player");
  assert.match(screen, /\{!playing\?<button type="button" className=\{s\.bigPlay\}/);
  assert.match(screen, /requestFullscreen/);
  const css = readFileSync(new URL("../app/resolute/tonight/reference.module.css", import.meta.url), "utf8");
  assert.match(css, /\.bigPlay \{ position:absolute; left:50%; top:50%;/, "the play button is in the middle");
  assert.doesNotMatch(css + screen, /coverPlay/);
  for (const id of ["breathe", "steady", "history"]) for (const lang of ["ja", "en"]) assert.match(source, new RegExp(`${id}-${lang}\\.jpg' as string\\|null,seconds:\\d+\\}`));
});
