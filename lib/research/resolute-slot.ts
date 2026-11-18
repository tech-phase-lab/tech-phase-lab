/** Where RESOLUTE's home bar is drawn: the bottom menu's dock slot registers itself here when it mounts (a callback ref) and
 * leaves when it unmounts, and the bar follows whatever slot is registered. The bar used to look the slot up once when it
 * appeared; if the menu's slot was not there yet (or was replaced) at that moment, nothing looked again and the bar stayed
 * missing on the first screen after a cold start until a page change remounted it (owner, Nov 18). */
let slot: HTMLElement | null = null;
const listeners = new Set<() => void>();

function set(next: HTMLElement | null) {
  if (slot === next) return;
  slot = next;
  for (const notify of [...listeners]) notify();
}

/** Callback ref for the dock's slot (stable, so React calls it only on mount and unmount). */
export function registerResoluteSlot(element: HTMLElement | null) {
  if (!element) return;
  set(element);
  // Only the slot that registered may clear it: a newer slot that already took its place stays.
  return () => { if (slot === element) set(null); };
}

export function subscribeResoluteSlot(notify: () => void) {
  listeners.add(notify);
  return () => { listeners.delete(notify); };
}

export const resoluteSlot = () => slot;
export const noResoluteSlot = () => null;
