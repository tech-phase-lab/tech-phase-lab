export type ReactionCounts = Record<string, { count: number; selected: boolean }>;
// One intent for the whole post. A late acknowledgement must never restore an
// older choice while a newer tap is waiting to be saved.
export function reactionState(initial: ReactionCounts, draw: (counts: ReactionCounts) => void, save: (key: string, selected: boolean) => Promise<ReactionCounts>, failed: () => void) {
  let confirmed = initial, running = false, version = 0;
  let desired: { key: string; selected: boolean; version: number } | null = null;
  function snapshot() {
    return Object.fromEntries(Object.entries(confirmed).map(([key, value]) => {
      const selected = desired ? desired.selected && desired.key === key : value.selected;
      return [key, { selected, count: Math.max(0, value.count + Number(selected) - Number(value.selected)) }];
    }));
  }
  async function flush() {
    if (running) return;
    running = true;
    try {
      while (desired) {
        const sent = desired;
        try {
          // A → B → undo B may happen before A is acknowledged. Clear the
          // server's acknowledged choice, even when B was never sent.
          const key = sent.selected ? sent.key : Object.keys(confirmed).find(key => confirmed[key].selected) ?? sent.key;
          confirmed = await save(key, sent.selected);
        }
        catch { failed(); }
        if (desired.version === sent.version) desired = null;
        draw(snapshot());
      }
    } finally { running = false; }
  }
  return { toggle(key: string) {
    if (!Object.hasOwn(confirmed, key)) return;
    desired = { key, selected: !snapshot()[key].selected, version: ++version };
    draw(snapshot()); void flush();
  } };
}
// Reaction counts under 1,000 are shown as they are; from 1,000 they are shortened
// to one decimal place with "k" ("1k", "1.2k", "12.3k"), rounded down so a count is never overstated.
export function shortCount(count: number) {
  if (!Number.isFinite(count) || count < 1000) return String(Math.max(0, Math.floor(count || 0)));
  const tenths = Math.floor(count / 100);
  return `${tenths % 10 ? (tenths / 10).toFixed(1) : tenths / 10}k`;
}

/** The five reactions, in the order of the face button's popover. */
export const REACTION_KEYS = ["like", "smile", "sad", "angry", "fire"] as const;
/** One note's counts from a desk-reactions answer, or null when the answer is not a usable one. */
export function readReactions(data: unknown): ReactionCounts | null {
  const body = data as { ok?: unknown; reactions?: unknown } | null;
  if (!body || body.ok !== true || !body.reactions || typeof body.reactions !== "object") return null;
  const reactions = body.reactions as Record<string, { count: number; selected: boolean } | undefined>;
  return Object.fromEntries(REACTION_KEYS.map(key => [key, reactions[key] ?? { count: 0, selected: false }]));
}
/** How long the page waits for the notes' reactions before it shows the notes anyway (the rest then arrive on their own). */
export const REACTION_PRELOAD_MS = 1500;
/** Every note's reactions at once, so the notes appear with their badges in one step instead of each badge popping in and pushing
 * the notes below down (owner, Nov 18: the desk opened in three visible stages). A note whose answer is late or failed is left out. */
export async function preloadReactions(ids: readonly string[], read: (id: string) => Promise<unknown>, waitMs = REACTION_PRELOAD_MS): Promise<Record<string, ReactionCounts>> {
  const found: Record<string, ReactionCounts> = {};
  const all = Promise.all(ids.map(async id => { try { const counts = readReactions(await read(id)); if (counts) found[id] = counts; } catch { /* left to the note itself */ } }));
  let timer: ReturnType<typeof setTimeout> | undefined;
  await Promise.race([all, new Promise(resolve => { timer = setTimeout(resolve, waitMs); })]);
  clearTimeout(timer);
  return { ...found };
}
