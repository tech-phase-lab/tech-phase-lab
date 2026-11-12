import "server-only";
import { getMembership } from "@/lib/membership/server";
import { isFullAccess } from "./tech-news-access";

/** Decided on the server from the session, never from the browser. Any failure is FREE. */
export async function viewerHasFullNews(): Promise<boolean> {
  try { return isFullAccess(await getMembership()); } catch { return false; }
}

/** PRO and FREE answers must never share a cache entry. */
export const PRIVATE_HEADERS = { "Cache-Control": "private, no-store", Vary: "Cookie", "X-Content-Type-Options": "nosniff" } as const;

/** One read from the monitor, same checks as the public routes. */
export async function readMonitor(path: "news" | "company-wire", maxBytes: number, timeoutMs: number): Promise<unknown> {
  const base = process.env.RESEARCH_MONITOR_URL;
  const token = process.env.RESEARCH_MONITOR_TOKEN;
  if (!base || !token) throw new Error("Not configured");
  const url = new URL(base);
  if (url.username || url.password || (url.protocol !== "https:" && !(process.env.NODE_ENV !== "production" && ["localhost", "127.0.0.1"].includes(url.hostname)))) throw new Error("Invalid monitor");
  url.pathname = `${url.pathname.replace(/\/$/, "")}/${path}`; url.search = ""; url.hash = "";
  if (path === "news" && process.env.VERCEL_ENV === "preview") url.searchParams.set("originalPreview", "1");
  const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store", signal: AbortSignal.timeout(timeoutMs) });
  if (!response.ok) throw new Error("Unavailable");
  const text = await response.text();
  if (new TextEncoder().encode(text).length > maxBytes) throw new Error("Oversized response");
  return JSON.parse(text);
}
