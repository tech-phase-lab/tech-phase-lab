/** Theme Ranking: one request for a genre's per-stock returns, with an outcome the screen can always show (owner, Nov 18: the
 * screen stayed on 「データを読み込み中…」 for over a minute). A refused request used to leave the screen on "loading" and wait for the
 * membership display to flip, which it does not always do; a request that keeps being refused looped without end. */
export type ThemePayload = { stocks: { ticker: string; returns: Record<string, number> }[]; asOf: string; fetchedAt: number; marketOpen: boolean; validUntil: number };
export type ThemeOutcome =
  | { kind: "ready"; data: ThemePayload }
  | { kind: "not-connected" }
  | { kind: "denied"; reason: "sign-in" | "pro-required" }
  | { kind: "error" };

/** Longest the browser waits for one answer. The server stops collecting at 40 seconds and its limit is 60. */
export const THEME_REQUEST_MS = 55_000;

type Deps = {
  fetch: (url: string, init: RequestInit) => Promise<Response>;
  /** Renews the sign-in session before the request (`force` skips the cached token). Failure is not fatal: the request still goes. */
  refresh: (force?: boolean) => Promise<unknown>;
  signal: AbortSignal;
};

/** Never throws for a server answer: every response ends in one of the four outcomes. Throws only when `signal` is aborted. */
export async function fetchThemeData(group: string, { fetch, refresh, signal }: Deps): Promise<ThemeOutcome> {
  const renew = async (force: boolean) => { try { await refresh(force); } catch { /* identity still loading or offline: try the request anyway */ } signal.throwIfAborted(); };
  const ask = async () => {
    const response = await fetch(`/api/research/themes?group=${encodeURIComponent(group)}`, { cache: "no-store", signal });
    let body: unknown = null;
    try { body = await response.json(); } catch { signal.throwIfAborted(); /* a gateway page instead of JSON */ }
    signal.throwIfAborted();
    return { status: response.status, ok: response.ok, body: (body && typeof body === "object" ? body : {}) as Record<string, unknown> };
  };
  try {
    // The home-screen app often opens with an expired session token: renew it first, as the membership check does.
    await renew(false);
    let answer = await ask();
    if (answer.status === 401 || answer.status === 403) {
      // Once more with a freshly issued token before saying no.
      await renew(true);
      answer = await ask();
    }
    if (answer.status === 401) return { kind: "denied", reason: "sign-in" };
    if (answer.status === 403) return { kind: "denied", reason: "pro-required" };
    if (answer.body.error === "not-connected") return { kind: "not-connected" };
    const body = answer.body;
    if (!answer.ok || body.ok !== true || !Array.isArray(body.stocks)) return { kind: "error" };
    return { kind: "ready", data: { stocks: body.stocks as ThemePayload["stocks"], asOf: typeof body.asOf === "string" ? body.asOf : "", fetchedAt: Number(body.fetchedAt) || 0, marketOpen: body.marketOpen === true, validUntil: Number(body.validUntil) || 0 } };
  } catch (error) {
    if (signal.aborted) throw error;
    return { kind: "error" };
  }
}
