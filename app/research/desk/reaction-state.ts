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
