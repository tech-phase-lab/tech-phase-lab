import { parsePlanMutation, PlanInputError } from "./plan-data.ts";
export const PLAN_BODY_LIMIT = 16384;
export class PlanBodyError extends Error {
  readonly status: number;
  constructor(status: number) { super(status === 413 ? "BODY_TOO_LARGE" : status === 415 ? "JSON_REQUIRED" : "INVALID_PLAN"); this.status = status; }
}
export async function readPlanMutation(request: Request, method: "PUT" | "DELETE") {
  if (request.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase() !== "application/json")
    throw new PlanBodyError(415);
  const reader = request.body?.getReader();
  if (!reader) throw new PlanBodyError(400);
  const parts: Uint8Array[] = []; let size = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read(); if (done) break;
      size += value.byteLength;
      if (size > PLAN_BODY_LIMIT) { await reader.cancel(); throw new PlanBodyError(413); }
      parts.push(value);
    }
  } finally { reader.releaseLock(); }
  try { return parsePlanMutation(method, JSON.parse(Buffer.concat(parts).toString("utf8"))); }
  catch (error) { if (error instanceof PlanInputError) throw error; throw new PlanBodyError(400); }
}
