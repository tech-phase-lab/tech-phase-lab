import { Extension } from "@tiptap/core";
import { Plugin, PluginKey, TextSelection } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";

/**
 * Long-press word selection for the ひとりごと editor (owner, Nov 16).
 *
 * On an iPhone, touch-and-hold inside an editable area is the system's cursor gesture (loupe and caret), not word
 * selection, so a long press on the post box never showed a blue range. Read-only text (posted notes) keeps the
 * native long press. Inside the editor, a finger held still for LONG_PRESS_MS selects the word under it as a
 * ProseMirror selection, so B / 赤 / マーカー apply to it. Scrolling is never blocked: touchstart and touchmove are
 * passive, and only the touchend of a press that already selected a word is cancelled (so the tap does not move
 * the caret over the new selection).
 */
export const LONG_PRESS_MS = 450;
export const LONG_PRESS_SLOP = 8;

type Segment = { segment: string; index: number; isWordLike?: boolean };
const segmenters = new Map<string, Intl.Segmenter>();
function segments(text: string, locale: string): Segment[] {
  if (typeof Intl === "undefined" || typeof Intl.Segmenter !== "function") return fallbackSegments(text);
  let segmenter = segmenters.get(locale);
  if (!segmenter) { segmenter = new Intl.Segmenter(locale, { granularity: "word" }); segmenters.set(locale, segmenter); }
  return Array.from(segmenter.segment(text));
}
// Without Intl.Segmenter (very old engines): runs of letters/digits of one script.
function fallbackSegments(text: string): Segment[] {
  const out: Segment[] = [];
  for (const match of text.matchAll(/\p{Script=Han}+|[\p{Script=Hiragana}ー]+|[\p{Script=Katakana}ー]+|[\p{L}\p{N}_]+|\s+|./gu)) out.push({ segment: match[0], index: match.index!, isWordLike: /^[\p{L}\p{N}_ー]/u.test(match[0]) });
  return out;
}

/**
 * The word at `offset` in `text` (offsets are UTF-16 code units, as in a ProseMirror text block), or null when the
 * finger is on space or punctuation with no word on either side. A point at the end of a word selects that word.
 */
export function wordAt(text: string, offset: number, locale = "ja"): { from: number; to: number } | null {
  if (!text || offset < 0 || offset > text.length) return null;
  const parts = segments(text, locale);
  const containing = (at: number) => parts.find(part => at >= part.index && at < part.index + part.segment.length);
  for (const at of [offset, offset - 1]) {
    const part = at >= 0 ? containing(at) : undefined;
    if (part?.isWordLike && part.segment !== "￼") return { from: part.index, to: part.index + part.segment.length };
  }
  return null;
}

/** True once a finger has moved far enough from where it started to be a scroll or drag, not a long press. */
export const movedBeyondSlop = (start: { x: number; y: number }, now: { x: number; y: number }, slop = LONG_PRESS_SLOP) =>
  Math.hypot(now.x - start.x, now.y - start.y) > slop;

/** The document range of the word under a screen point, or null. */
export function wordRangeAtPoint(view: EditorView, x: number, y: number) {
  const hit = view.posAtCoords({ left: x, top: y });
  if (!hit) return null;
  const $pos = view.state.doc.resolve(hit.pos);
  const block = $pos.parent;
  if (!block.isTextblock) return null;
  // One placeholder character per leaf (hard break), so string offsets equal positions inside the block.
  const text = block.textBetween(0, block.content.size, undefined, "￼");
  const word = wordAt(text, $pos.parentOffset);
  if (!word) return null;
  const start = $pos.start();
  return { from: start + word.from, to: start + word.to };
}

export const longPressKey = new PluginKey("deskLongPress");

export function longPressPlugin({ delay = LONG_PRESS_MS, slop = LONG_PRESS_SLOP }: { delay?: number; slop?: number } = {}) {
  return new Plugin({
    key: longPressKey,
    view(view) {
      let timer: ReturnType<typeof setTimeout> | undefined;
      let start: { x: number; y: number; scroll: number } | null = null;
      let selected: { from: number; to: number } | null = null;
      let before = "";
      const later: ReturnType<typeof setTimeout>[] = [];
      const cancel = () => { if (timer !== undefined) clearTimeout(timer); timer = undefined; start = null; };
      const apply = (range: { from: number; to: number }) => {
        if (view.isDestroyed || range.to > view.state.doc.content.size) return;
        const current = view.state.selection;
        if (current.from === range.from && current.to === range.to) return;
        view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, range.from, range.to)).setMeta(longPressKey, true));
      };
      const nativeRange = () => {
        const native = view.dom.ownerDocument.getSelection();
        if (!native || native.isCollapsed || !view.dom.contains(native.anchorNode)) return "";
        return [native.anchorOffset, native.focusOffset, native.toString()].join(":");
      };
      const fire = () => {
        timer = undefined;
        if (!start || !view.editable || view.isDestroyed) return;
        if (Math.abs(window.scrollY - start.scroll) > slop) { start = null; return; }
        // A range the system itself selected during this press (another engine or a future iOS) is left alone.
        const native = nativeRange();
        if (native && native !== before) { start = null; return; }
        const range = wordRangeAtPoint(view, start.x, start.y);
        if (!range) { start = null; return; }
        selected = range;
        apply(range);
      };
      const down = (event: TouchEvent) => {
        cancel(); selected = null; later.splice(0).forEach(clearTimeout);
        if (event.touches.length !== 1 || !view.editable) return;
        const touch = event.touches[0];
        start = { x: touch.clientX, y: touch.clientY, scroll: window.scrollY };
        before = nativeRange();
        timer = setTimeout(fire, delay);
      };
      const move = (event: TouchEvent) => {
        if (!start) return;
        const touch = event.touches[0];
        if (event.touches.length !== 1 || !touch || movedBeyondSlop(start, { x: touch.clientX, y: touch.clientY }, slop)) cancel();
      };
      const up = (event: TouchEvent) => {
        cancel();
        const range = selected; selected = null;
        if (!range) return;
        // The press already chose a word: keep the system from turning the lift into a caret tap, focus the editor
        // inside this user gesture (so the selection is drawn with handles) and put the word back if anything collapsed it.
        if (event.cancelable) event.preventDefault();
        if (!view.hasFocus()) view.focus();
        apply(range);
        for (const ms of [0, 120, 300]) later.push(setTimeout(() => { if (view.state.selection.empty) apply(range); }, ms));
      };
      const lost = () => { cancel(); selected = null; };
      view.dom.addEventListener("touchstart", down, { passive: true });
      view.dom.addEventListener("touchmove", move, { passive: true });
      view.dom.addEventListener("touchend", up, { passive: false });
      view.dom.addEventListener("touchcancel", lost);
      return {
        destroy() {
          cancel(); later.forEach(clearTimeout);
          view.dom.removeEventListener("touchstart", down);
          view.dom.removeEventListener("touchmove", move);
          view.dom.removeEventListener("touchend", up);
          view.dom.removeEventListener("touchcancel", lost);
        },
      };
    },
  });
}

export const DeskLongPress = Extension.create<{ delay: number; slop: number }>({
  name: "deskLongPress",
  addOptions() { return { delay: LONG_PRESS_MS, slop: LONG_PRESS_SLOP }; },
  addProseMirrorPlugins() { return [longPressPlugin(this.options)]; },
});
