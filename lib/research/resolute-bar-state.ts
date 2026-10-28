/** What the RESOLUTE bar remembers on the device, so it can appear the moment the app opens (owner, Oct 26).
 * `owned` is the last answer about an active RESOLUTE purchase; `anon` says it was learned while signed out;
 * `dismissedAt` is the "×" (hidden for seven days). Nothing here grants access: it only decides whether to draw the bar. */
export const BAR_STATE_KEY = "tech-phase:resolute-bar-state:v1";
export const BAR_DISMISS_KEY = "tech-phase:resolute-bar-dismissed";
export const BAR_EVENT = "tech-phase:resolute-bar";
export const DISMISS_MS = 7 * 24 * 3_600_000;
export const REFRESH_MS = 10 * 60_000;

export type BarState = { owned: boolean; anon: boolean; at: number };

export function parseBarState(raw: string | null): BarState | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Partial<BarState>;
    return typeof value.owned === "boolean" && typeof value.anon === "boolean" && Number.isFinite(value.at) ? { owned: value.owned, anon: value.anon, at: value.at as number } : null;
  } catch { return null; }
}

export function writeBarState(state: { owned: boolean; anon: boolean }) {
  try {
    localStorage.setItem(BAR_STATE_KEY, JSON.stringify({ ...state, at: Date.now() }));
    window.dispatchEvent(new Event(BAR_EVENT));
  } catch { /* storage may be blocked */ }
}

/** Pure: should the bar be drawn? Never for a purchaser; not while dismissed. Someone signed out cannot have
 * bought anything under an account, so the bar needs no remembered answer for them; a signed-in person with
 * nothing (or only a signed-out answer) remembered waits for the real answer. */
export function barVisible(state: BarState | null, dismissedAt: number, signedIn: boolean, now: number) {
  if (state?.owned) return false;
  if (!state ? signedIn : state.anon && signedIn) return false;
  return !(dismissedAt > 0 && now - dismissedAt < DISMISS_MS);
}

/** Pure: does the remembered answer need asking again? An answer learned while signed out is stale as soon as
 * the member check shows someone is signed in, however recent it is. */
export function needsRefresh(state: BarState | null, signedInKnown: boolean, now: number) {
  if (!state) return true;
  if (state.anon && signedInKnown) return true;
  return now - state.at >= REFRESH_MS;
}
