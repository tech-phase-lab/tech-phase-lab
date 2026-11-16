import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { JSDOM } from "jsdom";
const dom = new JSDOM("<!doctype html><html><body></body></html>", { pretendToBeVisual: true });
for (const key of ["window", "document", "navigator", "Node", "HTMLElement", "MutationObserver", "DOMParser", "getComputedStyle", "requestAnimationFrame", "cancelAnimationFrame"]) Object.defineProperty(globalThis, key, { configurable: true, value: key === "window" ? dom.window : typeof dom.window[key] === "function" && ["getComputedStyle", "requestAnimationFrame", "cancelAnimationFrame"].includes(key) ? dom.window[key].bind(dom.window) : dom.window[key] });
dom.window.Range.prototype.getClientRects = () => [];
dom.window.Range.prototype.getBoundingClientRect = () => ({ top: 0, left: 0, bottom: 0, right: 0, width: 0, height: 0 });
const { Editor } = await import("@tiptap/core");
const StarterKit = (await import("@tiptap/starter-kit")).default;
const { DeskLongPress, LONG_PRESS_MS, LONG_PRESS_SLOP, movedBeyondSlop, wordAt } = await import("../app/research/desk/long-press.ts");
const read = path => readFile(new URL(path, import.meta.url), "utf8");
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const word = (text, at) => { const range = wordAt(text, at); return range && text.slice(range.from, range.to); };

test("Japanese and English words under the finger (Intl.Segmenter, ja)", () => {
  const text = "今日はとても良い天気です。Nvidia earnings beat.";
  assert.equal(word(text, text.indexOf("天気")), "天気");
  assert.equal(word(text, text.indexOf("天気") + 1), "天気");
  assert.equal(word(text, text.indexOf("earnings") + 3), "earnings");
  assert.equal(word(text, text.indexOf("earnings") + "earnings".length), "earnings", "the end of a word selects that word");
  assert.equal(word(text, 0), "今日");
  assert.equal(word("。 、", 1), null, "punctuation and space alone select nothing");
  assert.equal(word("", 0), null);
  assert.equal(word("abc", 9), null);
  assert.equal(word("a￼b", 1), "a", "a hard-break placeholder is never a word");
});

test("a moving finger is a scroll, not a long press", () => {
  assert.equal(LONG_PRESS_MS, 450);
  assert.equal(LONG_PRESS_SLOP, 8);
  assert.equal(movedBeyondSlop({ x: 10, y: 10 }, { x: 15, y: 15 }), false);
  assert.equal(movedBeyondSlop({ x: 10, y: 10 }, { x: 10, y: 19 }), true);
});

function touch(target, type, x = 0, y = 0) {
  const event = new dom.window.Event(type, { bubbles: true, cancelable: true });
  const point = { identifier: 1, clientX: x, clientY: y };
  const list = type === "touchend" || type === "touchcancel" ? [] : [point];
  for (const [key, value] of [["touches", list], ["targetTouches", list], ["changedTouches", [point]]]) Object.defineProperty(event, key, { value });
  target.dispatchEvent(event);
  return event;
}
function setup(delay = 30) {
  const element = document.createElement("div"); document.body.append(element);
  const editor = new Editor({ element, extensions: [StarterKit, DeskLongPress.configure({ delay })], content: "<p>今日はとても良い天気です。Nvidia earnings</p>" });
  // JSDOM has no layout: a point's x is the document position under it.
  editor.view.posAtCoords = ({ left }) => ({ pos: left, inside: -1 });
  const at = needle => editor.state.doc.textContent.indexOf(needle) + 1;
  const selected = () => editor.state.doc.textBetween(editor.state.selection.from, editor.state.selection.to);
  return { editor, dom: editor.view.dom, at, selected, done: () => { editor.destroy(); element.remove(); } };
}

test("a finger held still on a word selects it; on lift the editor is focused with the word kept, and B applies", async () => {
  const { editor, dom: surface, at, selected, done } = setup();
  try {
    const x = at("天気");
    touch(surface, "touchstart", x, 20);
    await wait(10);
    assert.equal(selected(), "", "nothing before the hold time");
    await wait(60);
    assert.equal(selected(), "天気");
    const end = touch(surface, "touchend", x, 20);
    assert.equal(end.defaultPrevented, true, "the lift of a word press does not become a caret tap");
    await wait(10);
    assert.equal(selected(), "天気");
    editor.commands.toggleBold();
    assert.match(editor.getHTML(), /<strong>天気<\/strong>/);
    // A second press on another word, while the first is still selected.
    touch(surface, "touchstart", at("earnings") + 2, 20); await wait(60); touch(surface, "touchend", at("earnings") + 2, 20); await wait(10);
    assert.equal(selected(), "earnings");
  } finally { done(); }
});

test("scrolling, quick taps, two fingers and a read-only editor never select or cancel the touch", async () => {
  const { editor, dom: surface, at, selected, done } = setup();
  try {
    const x = at("天気");
    touch(surface, "touchstart", x, 20); const move = touch(surface, "touchmove", x, 40); await wait(60);
    assert.equal(move.defaultPrevented, false, "scroll gestures are never cancelled");
    assert.equal(selected(), "");
    assert.equal(touch(surface, "touchend", x, 40).defaultPrevented, false);
    touch(surface, "touchstart", x, 20); await wait(5);
    assert.equal(touch(surface, "touchend", x, 20).defaultPrevented, false, "a tap stays a tap");
    await wait(60); assert.equal(selected(), "");
    const two = new dom.window.Event("touchstart", { bubbles: true, cancelable: true });
    Object.defineProperty(two, "touches", { value: [{ clientX: x, clientY: 0 }, { clientX: x + 1, clientY: 0 }] });
    surface.dispatchEvent(two); await wait(60); assert.equal(selected(), "", "pinch is left alone");
    editor.setEditable(false);
    touch(surface, "touchstart", x, 20); await wait(60); assert.equal(selected(), "", "a locked editor (posting) does not select");
  } finally { done(); }
});

test("the post box editor carries the long press; listeners are passive and the 選択 button stays", async () => {
  const editor = await read("../app/research/desk/rich-editor.tsx");
  assert.match(editor, /import \{ DeskLongPress \} from "\.\/long-press";/);
  assert.match(editor, /useState\(\(\) => \[\.\.\.deskExtensions\(\(\) => 6000 - reserved\.current\), DeskLongPress\]\)/);
  assert.match(editor, /aria-label="本文を全選択".*onClick=\{selectText\}/);
  const plugin = await read("../app/research/desk/long-press.ts");
  assert.match(plugin, /addEventListener\("touchstart", down, \{ passive: true \}\)/);
  assert.match(plugin, /addEventListener\("touchmove", move, \{ passive: true \}\)/);
  assert.match(plugin, /new Intl\.Segmenter\(locale, \{ granularity: "word" \}\)/);
  assert.match(plugin, /view\.posAtCoords\(/);
  assert.match(plugin, /TextSelection\.create\(/);
});

test("posted notes keep the native long press: nothing between the text and <html> turns selection off", async () => {
  const columns = await read("../app/research/columns/styles.module.css");
  const format = await read("../app/research/desk/format.module.css");
  const shell = await read("../app/research/research.module.css");
  const tools = await read("../app/research/research-tools.module.css");
  const globals = await read("../app/globals.css");
  const chain = /(?:^|[},])\s*(?:\.article|\.note|\.noteBubble|\.text|\.body|\.app|\.main|\.desk|html|body)\b[^{}]*\{[^}]*(?:user-select:\s*none|-webkit-touch-callout:\s*none)/;
  for (const [name, css] of Object.entries({ columns, format, shell, tools, globals })) assert.doesNotMatch(css, chain, name);
  const columnsPage = await read("../app/research/columns/columns.tsx");
  assert.doesNotMatch(columnsPage, /selectionchange|removeAllRanges|onContextMenu|onTouchStart/);
});
