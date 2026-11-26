import { gunzipSync, gzipSync } from "node:zlib";

/** How a durable copy travels to the Railway monitor (lib/research/twelve-copies.ts; no server-only import, so it can be tested directly).
 * A value over COMPRESS_AT bytes of JSON is sent gzip-compressed and base64-encoded ({"$gz": ...}); one over PART_BYTES even then is sent in
 * parts the monitor puts together (its gateway takes 64 KB request bodies; scripts/research/twelve_copies.py MAX_VALUE_BYTES = 48 KB). */
export const COMPRESS_AT = 16 * 1024, PART_BYTES = 40 * 1024, MAX_PARTS = 32;
export type Wire = { value: unknown } | { chunks: string[] };
export function encodeValue(value: unknown): Wire | null {
  const text = JSON.stringify(value ?? null);
  if (text.length < COMPRESS_AT) return { value: value ?? null };
  const packed = gzipSync(Buffer.from(text, "utf8")).toString("base64");
  if (packed.length <= PART_BYTES) return { value: { $gz: packed } };
  const chunks: string[] = [];
  for (let i = 0; i < packed.length; i += PART_BYTES) chunks.push(packed.slice(i, i + PART_BYTES));
  return chunks.length <= MAX_PARTS ? { chunks } : null;
}
export function decodeValue(value: unknown): unknown {
  if (value && typeof value === "object" && !Array.isArray(value) && Object.keys(value).length === 1 && typeof (value as { $gz?: unknown }).$gz === "string")
    return JSON.parse(gunzipSync(Buffer.from((value as { $gz: string }).$gz, "base64")).toString("utf8"));
  return value;
}
