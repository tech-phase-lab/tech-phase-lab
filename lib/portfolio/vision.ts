import "server-only";
import { PARSE_PROMPT, extractJson, normalizeParsed, type Parsed } from "./parse.ts";

/** Reads one holdings screenshot with the AI. The picture is sent for this one request and never stored or logged here. */
export const visionConfigured = () => !!process.env.ANTHROPIC_API_KEY;
const MODEL = process.env.PORTFOLIO_VISION_MODEL || "claude-sonnet-5-5";
export const MAX_IMAGE_BYTES = 3_500_000;
const TYPES = ["image/jpeg", "image/png", "image/webp"] as const;

export function decodeImage(dataUrl: unknown): { mediaType: (typeof TYPES)[number]; data: string } | null {
  if (typeof dataUrl !== "string" || dataUrl.length > MAX_IMAGE_BYTES * 1.4) return null;
  const match = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl);
  if (!match) return null;
  return { mediaType: match[1] as (typeof TYPES)[number], data: match[2] };
}

export async function readHoldings(image: { mediaType: string; data: string }): Promise<Parsed> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error("not-configured");
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST", cache: "no-store", signal: AbortSignal.timeout(45_000),
    headers: { "content-type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({ model: MODEL, max_tokens: 2000, temperature: 0, messages: [{ role: "user", content: [
      { type: "image", source: { type: "base64", media_type: image.mediaType, data: image.data } },
      { type: "text", text: PARSE_PROMPT },
    ] }] }),
  });
  if (!response.ok) { await response.body?.cancel(); throw new Error(`vision-${response.status}`); }
  const body = await response.json() as { content?: { type?: string; text?: string }[] };
  const text = (body.content ?? []).filter(part => part.type === "text").map(part => part.text ?? "").join("\n");
  return normalizeParsed(extractJson(text));
}
