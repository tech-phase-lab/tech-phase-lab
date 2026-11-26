// Owner, 11/26: no NEW label anywhere on the site (the green dot is enough).
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const root = new URL("../", import.meta.url).pathname;
const files = (dir, ext) => readdirSync(join(root, dir)).flatMap(name => {
  const path = join(dir, name);
  return statSync(join(root, path)).isDirectory() ? files(path, ext) : ext.some(e => name.endsWith(e)) ? [path] : [];
});
const read = path => readFileSync(join(root, path), "utf8");

test("no NEW label is rendered anywhere in the app", () => {
  for (const file of files("app", [".tsx"])) {
    // A JSX text node or string that is exactly NEW (comments and words such as NEWS are not labels).
    assert.doesNotMatch(read(file), />\s*NEW\s*<|["'`]NEW["'`]/, file);
  }
  // 速報's unread mark in the side menu is a green dot, as on the phone's bottom bar.
  assert.match(read("app/research/home-sidebar.tsx"), /badge: unread \? <em className=\{styles\.freshDot\}/);
});
