import "server-only";
import { PARSE_PROMPT, extractJson, normalizeParsed, type Parsed } from "./parse.ts";

/** Reads one holdings screenshot with the AI (OpenAI if its key is set, else Claude). The picture is sent for this one request and never stored or logged here. */
const openaiKey = () => process.env.PORTFOLIO_OPENAI_API_KEY || process.env.RESOLUTE_OPENAI_API_KEY;
export const visionConfigured = () => !!(openaiKey() || process.env.ANTHROPIC_API_KEY);
const OPENAI_MODEL = process.env.PORTFOLIO_VISION_MODEL || "gpt-5.4-mini";
const CLAUDE_MODEL = process.env.PORTFOLIO_VISION_MODEL || "claude-sonnet-5-5";
export const MAX_IMAGE_BYTES = 3_500_000;
const TYPES = ["image/jpeg", "image/png", "image/webp"] as const;

export function decodeImage(dataUrl: unknown): { mediaType: (typeof TYPES)[number]; data: string } | null {
  if (typeof dataUrl !== "string" || dataUrl.length > MAX_IMAGE_BYTES * 1.4) return null;
  const match = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl);
  if (!match) return null;
  return { mediaType: match[1] as (typeof TYPES)[number], data: match[2] };
}

/** A short, safe reason for a failed provider call: the status and the provider's error code only (never the body, key or image). */
async function providerReason(response: Response): Promise<string> {
  let code = "";
  try {
    const body = await response.json() as { error?: { code?: unknown; type?: unknown } };
    const raw = String(body?.error?.code ?? body?.error?.type ?? "");
    code = /^[a-z0-9_.-]{1,48}$/i.test(raw) ? `:${raw}` : "";
  } catch { /* no readable body */ }
  return `vision-${response.status}${code}`;
}

type Image = { mediaType: string; data: string };
async function viaOpenAI(image: Image | Image[], key: string, prompt = PARSE_PROMPT): Promise<string> {
  const images = Array.isArray(image) ? image : [image];
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST", cache: "no-store", redirect: "error", signal: AbortSignal.timeout(45_000),
    headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
    body: JSON.stringify({ model: OPENAI_MODEL, store: false, reasoning: { effort: "none" }, max_output_tokens: 2000, input: [{ role: "user", content: [
      { type: "input_text", text: prompt },
      ...images.map(i => ({ type: "input_image", image_url: `data:${i.mediaType};base64,${i.data}` })),
    ] }] }),
  });
  if (!response.ok) throw new Error(await providerReason(response));
  const body = await response.json() as { status?: string; output?: { content?: { type?: string; text?: string }[] }[] };
  if (body.status !== "completed") throw new Error(`vision-${body.status ?? "unknown"}`);
  return (body.output ?? []).flatMap(item => item.content ?? []).filter(part => part.type === "output_text").map(part => part.text ?? "").join("\n");
}

async function viaClaude(image: Image | Image[], key: string, prompt = PARSE_PROMPT): Promise<string> {
  const images = Array.isArray(image) ? image : [image];
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST", cache: "no-store", signal: AbortSignal.timeout(45_000),
    headers: { "content-type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({ model: CLAUDE_MODEL, max_tokens: 2000, temperature: 0, messages: [{ role: "user", content: [
      ...images.map(i => ({ type: "image", source: { type: "base64", media_type: i.mediaType, data: i.data } })),
      { type: "text", text: prompt },
    ] }] }),
  });
  if (!response.ok) throw new Error(await providerReason(response));
  const body = await response.json() as { content?: { type?: string; text?: string }[] };
  return (body.content ?? []).filter(part => part.type === "text").map(part => part.text ?? "").join("\n");
}

/** OpenAI is used when its key is present (the account already in use); otherwise Anthropic. */
export async function readHoldings(image: { mediaType: string; data: string }): Promise<Parsed> {
  const openai = openaiKey(), claude = process.env.ANTHROPIC_API_KEY;
  if (!openai && !claude) throw new Error("not-configured");
  const text = openai ? await viaOpenAI(image, openai) : await viaClaude(image, claude!);
  return normalizeParsed(extractJson(text));
}

/** The model's text answer for a prompt and zero or more pictures (the Shock Gauge owner's added news, owner Nov 27). The pictures are
 * sent for this one request only and never stored or logged; the same provider choice as readHoldings. */
export async function readImagesText(images: Image[], prompt: string): Promise<string> {
  const openai = openaiKey(), claude = process.env.ANTHROPIC_API_KEY;
  if (!openai && !claude) throw new Error("not-configured");
  return openai ? viaOpenAI(images, openai, prompt) : viaClaude(images, claude!, prompt);
}
