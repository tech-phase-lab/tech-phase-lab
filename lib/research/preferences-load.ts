/** Why reading a device's notification choices failed, as a short code that is safe to log (no member, device or key in it). */
export type PreferencesFailure =
  | "aborted" // our own request was cancelled (a newer check, leaving the page, our timeout)
  | "interrupted" // the browser cut the request: an iPhone app sent to the background ends fetches with "Load failed" or AbortError
  | "offline"
  | "timeout" // our own 15-second limit ran out while the app was shown
  | "network" // the request failed while the app was shown and online
  | "sign-in" // 401: the sign-in cookie lapsed and is renewed a moment later
  | `http-${number}`
  | `refused-${string}`
  | "bad-response";

/** How many quiet retries a load gets before a real failure is shown. */
export const PREFERENCES_RETRIES = 2;
export const PREFERENCES_RETRY_MS = [1500, 4000];

export function preferencesFailure(input: { error?: unknown; status?: number; body?: unknown; aborted: boolean; timedOut?: boolean; hidden: boolean; online: boolean }): PreferencesFailure {
  // Our 15-second limit running out while the app is shown is a slow server, not a cancellation.
  if (input.aborted) return input.timedOut && !input.hidden ? "timeout" : "aborted";
  if (input.error !== undefined) {
    const name = (input.error as { name?: unknown } | null)?.name;
    // An AbortError or a TimeoutError we did not ask for, or any failure while the app is not shown, is the browser stopping the request.
    if (input.hidden || name === "AbortError" || name === "TimeoutError") return "interrupted";
    if (!input.online) return "offline";
    return name === "TypeError" ? "network" : "bad-response";
  }
  const status = input.status ?? 0;
  if (status === 401) return "sign-in";
  if (status < 200 || status >= 300) return `http-${status}`;
  const body = input.body as { ok?: unknown; error?: unknown; preferences?: unknown } | null | undefined;
  if (body && body.ok === false && typeof body.error === "string" && /^[a-z-]{1,40}$/.test(body.error)) return `refused-${body.error}`;
  return "bad-response";
}

/** What to do next: wait until the app is shown (or online) again, try again soon, renew the sign-in and try again, or show the error. */
export type PreferencesStep = "wait" | "retry" | "renew" | "show";
export function preferencesNextStep(failure: PreferencesFailure, attempt: number, hidden = false): PreferencesStep {
  // The page's own check runs again when the app is shown or back online, so these never show the error.
  if (failure === "aborted" || failure === "offline") return "wait";
  if (failure === "interrupted") return !hidden && attempt < PREFERENCES_RETRIES ? "retry" : "wait";
  if (failure === "sign-in") return attempt === 0 ? "renew" : "show";
  // A refusal that names its reason will not change on a retry.
  if (failure.startsWith("refused-") || failure === "http-403") return "show";
  return attempt < PREFERENCES_RETRIES ? "retry" : "show";
}
