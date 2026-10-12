import { PlanInputError } from "./plan-data.ts";
import { readPlanMutation, PlanBodyError } from "./plan-http.ts";
import { fetchResolutePlan } from "./plan-transport.ts";
const headers = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff", Vary: "Cookie" };
const json = (body: unknown, status = 200) => Response.json(body, { status,
  headers: status === 429 ? { ...headers, "Retry-After": "60" } : headers });
type Services = {
  session: () => Promise<string | null>;
  forward: (token: string, method: "GET" | "PUT" | "DELETE", mutation?: Awaited<ReturnType<typeof readPlanMutation>>) => ReturnType<typeof fetchResolutePlan>;
};
export function createPlanRoutes(services: Services) {
  const handle = async (request: Request, method: "GET" | "PUT" | "DELETE") => {
    if (new URL(request.url).search) return json({ error: "INVALID_PLAN" }, 400);
    if (method !== "GET" && request.headers.get("origin") !== new URL(request.url).origin)
      return json({ error: "ORIGIN_REJECTED" }, 403);
    try {
      const token = await services.session(); if (!token) return json({ error: "AUTH_REQUIRED" }, 401);
      const mutation = method === "GET" ? undefined : await readPlanMutation(request, method);
      const response = await services.forward(token, method, mutation);
      return json(response.body, response.status);
    } catch (error) {
      if (error instanceof PlanBodyError) return json({ error: error.message }, error.status);
      if (error instanceof PlanInputError) return json({ error: "INVALID_PLAN" }, 400);
      return json({ error: "PLAN_UNAVAILABLE" }, 503);
    }
  };
  return { GET: (request: Request) => handle(request, "GET"), PUT: (request: Request) => handle(request, "PUT"),
    DELETE: (request: Request) => handle(request, "DELETE") };
}
