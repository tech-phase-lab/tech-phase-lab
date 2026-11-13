/** The glow on a number that changed: the first value shown never glows, a rise glows green, a fall red. `scope` names what the number is (another
 * symbol or period starts over, so switching never glows). The same state object comes back when nothing changed. */
export type Flash = { scope: string; value: number | null; dir: "up" | "down" | null; n: number };
export const startFlash = (scope: string, value: number | null): Flash => ({ scope, value, dir: null, n: 0 });
export function nextFlash(state: Flash, scope: string, value: number | null): Flash {
  if (scope !== state.scope) return startFlash(scope, value);
  if (value === null || value === state.value) return state;
  if (state.value === null) return { ...state, value }; // the first value to arrive is a first display
  return { scope, value, dir: value > state.value ? "up" : "down", n: state.n + 1 };
}
