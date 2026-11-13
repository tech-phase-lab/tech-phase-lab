/** Keeps the comparison's fresh Twelve Data reads from using up the shared per-minute credits (plan limit 610, shared by prices, alerts,
 * the thermometer and monitoring). No server-only / Next imports so it can be tested directly. */

export const COMPARISON_CREDIT_BUDGET = 350; // used this minute + this read's cost must stay under this
export const BUNDLE_CREDIT_COST = 251; // income_statement 100 + cash_flow 100 + statistics 50 + time_series 1
export const GATE_MAX_WAIT_MS = 25_000;
export const GATE_POLL_MS = 5_000;

export class TwelveBusyError extends Error { constructor() { super("twelve-busy"); } }

type Gate = { readUsage: () => Promise<number | null>; sleep: (ms: number) => Promise<void>; now: () => number;
  budget?: number; cost?: number; maxWaitMs?: number; pollMs?: number };

/** Resolves when the minute's usage leaves room for the read; polls every few seconds, and throws TwelveBusyError after the maximum wait.
 * If the usage cannot be read the read goes ahead (the comparison must not stop because the meter did). */
export async function waitForCredits(gate: Gate): Promise<void> {
  const budget = gate.budget ?? COMPARISON_CREDIT_BUDGET, cost = gate.cost ?? BUNDLE_CREDIT_COST;
  const deadline = gate.now() + (gate.maxWaitMs ?? GATE_MAX_WAIT_MS), poll = gate.pollMs ?? GATE_POLL_MS;
  for (;;) {
    let used: number | null = null;
    try { used = await gate.readUsage(); } catch { used = null; }
    if (used === null || !Number.isFinite(used) || used + cost <= budget) return;
    if (gate.now() + poll > deadline) throw new TwelveBusyError();
    await gate.sleep(poll);
  }
}

/** Parses /api_usage; null when the answer is not the expected shape. */
export const parseUsage = (body: unknown): number | null => {
  const used = body && typeof body === "object" ? (body as { current_usage?: unknown }).current_usage : undefined;
  return typeof used === "number" && Number.isFinite(used) && used >= 0 ? used : null;
};

/** The same key asked for while a read is running shares that read; the entry is dropped when it settles (a failure is never kept). */
export function shareInflight<T>(running: Map<string, Promise<T>>, key: string, start: () => Promise<T>): Promise<T> {
  const existing = running.get(key);
  if (existing) return existing;
  const promise = start().finally(() => { running.delete(key); });
  running.set(key, promise);
  return promise;
}

/** One patient retry on a rate-limit answer, never more: a chain of retries holds the queue and re-spends credits. */
export async function retryOnceIfLimited<T>(attempt: () => Promise<{ limited: boolean; value: T }>, sleep: (ms: number) => Promise<void>, waitMs = 20_000): Promise<T> {
  const first = await attempt();
  if (!first.limited) return first.value;
  await sleep(waitMs);
  return (await attempt()).value;
}
