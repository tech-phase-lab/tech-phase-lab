import { parsePreferences, readPreferences } from "./preferences-data.ts";
import type { ResolutePreferences } from "./preferences-data.ts";
export { parsePreferences, readPreferences } from "./preferences-data.ts";
export type { ResolutePreferences } from "./preferences-data.ts";
type Services = {
  authenticatedUser: () => Promise<string | null>;
  read: (userId: string) => Promise<unknown>;
  save: (userId: string, preferences: ResolutePreferences) => Promise<unknown>;
};

const headers = { "Cache-Control": "private, no-store", Vary: "Cookie",
  "X-Content-Type-Options": "nosniff" };
const json = (value: unknown, status = 200) => Response.json(value, { status, headers });
const unavailable = () => json({ error: "PREFERENCES_UNAVAILABLE" }, 503);

export function createPreferencesHandlers(services: Services) {
  return {
    async GET() {
      try {
        const userId = await services.authenticatedUser();
        if (!userId) return json({ error: "AUTH_REQUIRED" }, 401);
        return json(readPreferences(await services.read(userId)));
      } catch { return unavailable(); }
    },
    async PUT(request: Request) {
      // Browser writes must come from this origin. Neither user IDs nor arbitrary metadata are accepted.
      if (request.headers.get("origin") !== new URL(request.url).origin)
        return json({ error: "ORIGIN_REJECTED" }, 403);
      if (request.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase() !== "application/json")
        return json({ error: "JSON_REQUIRED" }, 415);
      try {
        const userId = await services.authenticatedUser();
        if (!userId) return json({ error: "AUTH_REQUIRED" }, 401);
        const reader = request.body?.getReader();
        if (!reader) return json({ error: "INVALID_PREFERENCES" }, 400);
        const chunks: Uint8Array[] = []; let size = 0;
        try {
          while (true) {
            const { value, done } = await reader.read();
            if (done) break;
            size += value.byteLength;
            if (size > 1024) {
              await reader.cancel();
              return json({ error: "BODY_TOO_LARGE" }, 413);
            }
            chunks.push(value);
          }
        } finally { reader.releaseLock(); }
        let value: unknown;
        try { value = JSON.parse(Buffer.concat(chunks).toString("utf8")); }
        catch { return json({ error: "INVALID_PREFERENCES" }, 400); }
        const preferences = parsePreferences(value);
        if (!preferences) return json({ error: "INVALID_PREFERENCES" }, 400);
        const result = readPreferences(await services.save(userId, preferences));
        if (result.locale !== preferences.locale || result.timezone !== preferences.timezone)
          return unavailable();
        return json(result);
      } catch { return unavailable(); }
    },
  };
}
