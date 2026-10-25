export type ReactionCounts = Record<string, { count: number; selected: boolean }>;
// Separate the user's latest intent from server acknowledgements. Late responses
// cannot overwrite a second tap, and every request sets a value (never increments).
export function reactionState(initial: ReactionCounts, draw: (counts: ReactionCounts) => void, save: (key: string, selected: boolean) => Promise<ReactionCounts>, failed: () => void) {
  let confirmed = initial, running = false;
  const desired = new Map<string, boolean>();
  function render() {
    const next = Object.fromEntries(Object.entries(confirmed).map(([key, value]) => [key, { ...value }]));
    for (const [key, selected] of desired) {
      const previous = confirmed[key] ?? { count: 0, selected: false };
      next[key] = { selected, count: Math.max(0, previous.count + Number(selected) - Number(previous.selected)) };
    }
    draw(next);
  }
  async function flush() {
    if (running) return;
    running = true;
    try {
      while (desired.size) {
        const [key, selected] = desired.entries().next().value!;
        try {
          confirmed = await save(key, selected);
          if (desired.get(key) === selected) desired.delete(key);
        } catch { desired.delete(key); failed(); }
        render();
      }
    } finally { running = false; }
  }
  return { toggle(key: string) {
    if (!Object.hasOwn(confirmed, key)) return;
    desired.set(key, !(desired.get(key) ?? confirmed[key].selected));
    render(); void flush();
  } };
}
