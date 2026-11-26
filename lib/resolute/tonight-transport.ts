import { validSessionDate } from "./thermometer.ts";
import { TONIGHT_ANSWERS, type TonightAnswer, type TonightQuestions, type TonightRecord } from "./tonight.ts";
import type { Copy } from "../research/data.ts";

/** 今夜のひと息: the member's record and tonight's questions, through resolute-api with the member's own session (POST
 * /internal/v1/tonight). The answer is re-validated on both sides; anything unexpected is dropped. */
export type TonightResponse = { record: TonightRecord; questions: TonightQuestions | null };
const text = (v: unknown, max: number): v is string => typeof v === "string" && v.length > 0 && v.length <= max && !/[…\r\n]/.test(v);
const copy = (v: unknown, max: number): Copy | null => {
  const c = v as Copy;
  return c && typeof c === "object" && text(c.ja, max) && text(c.en, max * 3) ? { ja: c.ja, en: c.en } : null;
};
export function parseTonightResponse(raw: unknown): TonightResponse {
  const v = raw as { record?: Record<string, unknown>; questions?: Record<string, unknown> | null };
  const r = v?.record;
  if (!r || !Number.isInteger(r.total) || (r.total as number) < 0 || (r.total as number) > 100000 || typeof r.tonight !== "boolean" ||
      !Number.isInteger(r.pastCalm) || (r.pastCalm as number) < 0 || !Array.isArray(r.nights) || r.nights.length > 3) throw new Error("Invalid tonight response");
  const nights = r.nights.map(n => {
    const x = n as Record<string, unknown>;
    if (!validSessionDate(x.night) || !(x.stars === null || Number.isInteger(x.stars) && (x.stars as number) >= 0 && (x.stars as number) <= 5) ||
        typeof x.alert !== "boolean" || !(x.answer === null || TONIGHT_ANSWERS.includes(x.answer as TonightAnswer))) throw new Error("Invalid tonight response");
    return { night: x.night as string, stars: x.stars as number | null, alert: x.alert, answer: x.answer as TonightAnswer | null };
  });
  let questions: TonightQuestions | null = null;
  const q = v.questions;
  if (q && validSessionDate(q.night) && (q.source === "ai" || q.source === "fixed") && Array.isArray(q.questions) && q.questions.length === 3) {
    const list = q.questions.map(item => {
      const x = item as { ask?: unknown; note?: unknown };
      const ask = copy(x.ask, 40), note = x.note === null ? null : copy(x.note, 60);
      return ask && (x.note === null || note) ? { ask, note } : null;
    });
    if (list.every(Boolean)) questions = { night: q.night as string, source: q.source, questions: list as TonightQuestions["questions"] };
  }
  return { record: { total: r.total as number, tonight: r.tonight, pastCalm: Math.min(r.pastCalm as number, r.total as number), nights }, questions };
}
export async function postTonight(token: string, base: string | undefined, secret: string | undefined, body: string, fetcher: typeof fetch = fetch) {
  if (!base || !secret || secret.length < 43 || !token || token.length > 16384 || body.length > 1024) throw new Error("Unavailable");
  const url = new URL(base);
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash || url.pathname !== "/" || !url.hostname.endsWith(".up.railway.app")) throw new Error("Unavailable");
  url.pathname = "/internal/v1/tonight";
  const response = await fetcher(url, { method: "POST", cache: "no-store", redirect: "error", signal: AbortSignal.timeout(30000), body,
    headers: { Authorization: `Bearer ${token}`, "X-Resolute-Service-Token": secret, Accept: "application/json", "Content-Type": "application/json" } });
  if (response.status === 200) {
    const raw = await response.text();
    if (raw.length > 16384) throw new Error("Unavailable");
    const parsed = JSON.parse(raw);
    return { status: 200, body: parsed && typeof parsed === "object" && "recorded" in parsed ? { recorded: parsed.recorded === true } : parseTonightResponse(parsed) };
  }
  await response.body?.cancel();
  if ([400, 401, 403, 429].includes(response.status)) return { status: response.status, body: { error: response.status === 400 ? "INVALID_REQUEST" : response.status === 401 ? "AUTH_REQUIRED" : response.status === 403 ? "ACCESS_DENIED" : "RATE_LIMITED" } };
  throw new Error("Unavailable");
}
/** Browser side: the site route. */
export async function requestTonight(input: object, signal?: AbortSignal) {
  const r = await fetch("/api/resolute/tonight", { method: "POST", cache: "no-store", credentials: "same-origin", redirect: "error", signal,
    headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) });
  if (!r.ok) throw new Error(r.status === 403 ? "denied" : "unavailable");
  return r.json();
}
