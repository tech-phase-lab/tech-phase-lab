/** Whether new information is still arriving, reduced from the monitor's public live state (owner, Oct 22:
 * a platform outage must show readers that the page is behind instead of looking up to date). */
export type FreshnessStatus = "ok" | "delayed" | "unreachable";
export type Freshness = { status: FreshnessStatus; lastCycleAt?: string };

const DELAY_ISSUES = new Set(["monitor-stale", "discovery-poll-stale", "body-fetch-stale"]);
const record = (value: unknown): Record<string, unknown> | null => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;

export function assessFreshness(payload: unknown, now = Date.now()): Freshness {
  const live = record(payload);
  const monitor = record(live?.monitor);
  if (!live || live.ok !== true || live.mode !== "automatic" || !monitor) return { status: "unreachable" };
  const at = typeof monitor.lastCycleAt === "string" && Number.isFinite(Date.parse(monitor.lastCycleAt)) ? monitor.lastCycleAt : undefined;
  const health = record(monitor.health);
  const issues = Array.isArray(health?.issues) ? health.issues : [];
  const staleAfter = typeof health?.monitorStaleAfterSeconds === "number" && health.monitorStaleAfterSeconds > 0 ? health.monitorStaleAfterSeconds : 900;
  const age = typeof monitor.lastCycleAgeSeconds === "number" ? monitor.lastCycleAgeSeconds : at ? (now - Date.parse(at)) / 1000 : Infinity;
  const delayed = issues.some(issue => typeof issue === "string" && DELAY_ISSUES.has(issue)) || age > staleAfter;
  return delayed ? { status: "delayed", ...(at ? { lastCycleAt: at } : {}) } : { status: "ok", ...(at ? { lastCycleAt: at } : {}) };
}
