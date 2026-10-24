import { parsePlanMutation, parsePlanSnapshot, type PlanInput, type PlanSnapshot } from "./plan-data.ts";
export class PlanClientError extends Error {
 readonly kind: "signed-out"|"denied"|"conflict"|"invalid"|"rate-limited"|"unavailable";
 readonly snapshot?: PlanSnapshot;
 constructor(kind: PlanClientError["kind"], snapshot?: PlanSnapshot) { super(kind); this.kind = kind; this.snapshot = snapshot; }
}
export async function requestPlan(mutation?: { plan: PlanInput; baseRevision: number }, signal?: AbortSignal,
 fetcher: typeof fetch = fetch): Promise<PlanSnapshot> {
 try {
  const body = mutation ? JSON.stringify(parsePlanMutation("PUT",mutation)) : undefined;
  if (body && new TextEncoder().encode(body).length > 16384) throw new PlanClientError("invalid");
  const timeout = AbortSignal.timeout(25000);
  const response = await fetcher("/api/resolute/plan", { method: mutation ? "PUT" : "GET", credentials: "same-origin",
   cache: "no-store", redirect: "error", signal: signal ? AbortSignal.any([signal,timeout]) : timeout,
   ...(body ? { headers: { "Content-Type": "application/json" }, body } : {}) });
  if (response.status === 401) throw new PlanClientError("signed-out");
  if (response.status === 403) throw new PlanClientError("denied");
  if (response.status === 400 || response.status === 413) throw new PlanClientError("invalid");
  if (response.status === 429) throw new PlanClientError("rate-limited");
  if (![200,409].includes(response.status) || !response.headers.get("content-type")?.startsWith("application/json")) throw new PlanClientError("unavailable");
  const reader = response.body?.getReader(); if (!reader) throw new PlanClientError("unavailable");
  const decoder = new TextDecoder("utf-8",{fatal:true}); let size=0, text="";
  try { for (;;) { const {done,value}=await reader.read(); if(done) break;
   size+=value.byteLength; if(size>18432) throw new PlanClientError("unavailable"); text+=decoder.decode(value,{stream:true}); }
   text+=decoder.decode();
  } catch(e) { await reader.cancel(); throw e; }
  const snapshot = parsePlanSnapshot(JSON.parse(text));
  if(response.status===409) throw new PlanClientError("conflict",snapshot);
  if(mutation && (snapshot.revision !== mutation.baseRevision + 1 || snapshot.plan === null)) throw new PlanClientError("unavailable");
  return snapshot;
 } catch(e) { if(e instanceof PlanClientError) throw e; throw new PlanClientError("unavailable"); }
}
