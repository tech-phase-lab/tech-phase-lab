export type ResolutePreferences = { locale: "ja" | "en"; timezone: string };
export type PreferencesSnapshot = { locale: "ja" | "en" | null; timezone: string | null; configured: boolean };

function timezone(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 100 ||
      (value !== "UTC" && !/^[A-Za-z][A-Za-z0-9_+-]*(\/[A-Za-z0-9_+-]+)+$/.test(value))) return null;
  try { return new Intl.DateTimeFormat("en", { timeZone: value }).resolvedOptions().timeZone; }
  catch { return null; }
}

export function readPreferences(metadata: unknown): PreferencesSnapshot {
  const m = metadata && typeof metadata === "object" && !Array.isArray(metadata)
    ? metadata as Record<string, unknown> : {};
  const locale = m.locale === "ja" || m.locale === "en" ? m.locale : null;
  const zone = timezone(m.timezone);
  return { locale, timezone: zone, configured: locale !== null && zone !== null };
}

export function parsePreferences(value: unknown): ResolutePreferences | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const keys = Object.keys(value);
  if (keys.length !== 2 || !keys.includes("locale") || !keys.includes("timezone")) return null;
  const snapshot = readPreferences(value);
  return snapshot.locale && snapshot.timezone ? { locale: snapshot.locale, timezone: snapshot.timezone } : null;
}
