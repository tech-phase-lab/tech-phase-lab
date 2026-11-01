/** Wrong codes lock the check for a while. Pure, so it can be tested without a database. */
export const MAX_FAILURES = 5;
export const LOCK_MS = 15 * 60_000;
export type Attempts = { failures: number; lockedUntil: number };

export function isLocked(state: Attempts, now: number): boolean { return state.lockedUntil > now; }

export function afterFailure(state: Attempts, now: number): Attempts {
  const failures = state.failures + 1;
  return failures >= MAX_FAILURES ? { failures: 0, lockedUntil: now + LOCK_MS } : { failures, lockedUntil: state.lockedUntil };
}

export const afterSuccess = (): Attempts => ({ failures: 0, lockedUntil: 0 });
