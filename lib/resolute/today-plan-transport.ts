import { parseTodayPlan } from "./today-plan-validate.ts";
import type { TodayPlan } from "./today-plan.ts";

/** 「今日やること」: Vercel → resolute-api (same service credential and session JWT as 「今日のお知らせ」). `{plan:null}` = nothing
 * stored for the latest close yet: the screen shows fixedTodayPlan. Off unless RESOLUTE_TODAY_PLAN_ENABLED=true on the site too. */
export const todayPlanEnabled = (env: Record<string, string | undefined> = process.env) => env.RESOLUTE_TODAY_PLAN_ENABLED === "true";
export function parseTodayPlanSnapshot(value: unknown): { plan: TodayPlan | null } {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).join() !== "plan") throw new Error("Invalid today plan");
  const plan = (value as { plan: unknown }).plan;
  return { plan: plan === null ? null : parseTodayPlan(plan) };
}
export async function fetchTodayPlan(token: string, base: string | undefined, secret: string | undefined, fetcher: typeof fetch = fetch) {
  if (!base || !secret || secret.length < 43 || !token || token.length > 16384) throw new Error("Unavailable");
  const url = new URL(base);
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash || url.pathname !== "/" || !url.hostname.endsWith(".up.railway.app")) throw new Error("Unavailable");
  url.pathname = "/internal/v1/today-plan";
  const response = await fetcher(url, { method: "GET", cache: "no-store", redirect: "error", signal: AbortSignal.timeout(20000),
    headers: { Authorization: `Bearer ${token}`, "X-Resolute-Service-Token": secret, Accept: "application/json" } });
  if (response.status === 200) {
    const text = await response.text();
    if (text.length > 16384) throw new Error("Unavailable");
    return { status: 200, body: parseTodayPlanSnapshot(JSON.parse(text)) };
  }
  await response.body?.cancel();
  if ([401, 403, 429].includes(response.status)) return { status: response.status, body: { error: response.status === 401 ? "AUTH_REQUIRED" : response.status === 403 ? "ACCESS_DENIED" : "RATE_LIMITED" } };
  throw new Error("Unavailable");
}
