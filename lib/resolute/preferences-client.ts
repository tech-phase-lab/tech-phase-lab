import { parsePreferences, readPreferences } from "./preferences-data.ts";
import type { PreferencesSnapshot, ResolutePreferences } from "./preferences-data.ts";

export class PreferencesError extends Error {
  readonly kind: "signed-out" | "invalid" | "unavailable";
  constructor(kind: PreferencesError["kind"]) { super(kind); this.kind = kind; }
}

function snapshot(value: unknown): PreferencesSnapshot {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new PreferencesError("unavailable");
  const v = value as Record<string, unknown>;
  const parsed = readPreferences(v);
  if (Object.keys(v).length !== 3 || v.locale !== parsed.locale || v.timezone !== parsed.timezone ||
      v.configured !== parsed.configured) throw new PreferencesError("unavailable");
  return parsed;
}

/** Browser calls only the same-origin API. Never forwards identity, membership or service keys. */
export async function requestPreferences(preferences?: ResolutePreferences, signal?: AbortSignal,
  fetcher: typeof fetch = fetch): Promise<PreferencesSnapshot> {
  if (preferences && !parsePreferences(preferences)) throw new PreferencesError("invalid");
  try {
    const timeout = AbortSignal.timeout(12000);
    const res = await fetcher("/api/resolute/preferences", {
      method: preferences ? "PUT" : "GET", credentials: "same-origin", cache: "no-store", redirect: "error",
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
      ...(preferences ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify(preferences) } : {}),
    });
    if (res.status === 401) throw new PreferencesError("signed-out");
    if (res.status === 400) throw new PreferencesError("invalid");
    if (!res.ok || res.headers.get("content-type")?.split(";", 1)[0] !== "application/json")
      throw new PreferencesError("unavailable");
    const result = snapshot(await res.json());
    const expected = preferences ? parsePreferences(preferences) : null;
    if (expected && (result.locale !== expected.locale || result.timezone !== expected.timezone))
      throw new PreferencesError("unavailable");
    return result;
  } catch (error) {
    if (error instanceof PreferencesError) throw error;
    throw new PreferencesError("unavailable");
  }
}
