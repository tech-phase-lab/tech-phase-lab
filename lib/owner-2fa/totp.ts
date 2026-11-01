import { createHmac, timingSafeEqual, randomBytes } from "node:crypto";

/** RFC 6238 time-based one-time passwords (SHA-1, 6 digits, 30 s), as every authenticator app expects. No dependency. */
const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
export const STEP_SECONDS = 30;

export function base32Encode(bytes: Uint8Array): string {
  let bits = 0, value = 0, out = "";
  for (const byte of bytes) {
    value = (value << 8) | byte; bits += 8;
    while (bits >= 5) { out += ALPHABET[(value >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(text: string): Buffer {
  const clean = text.replace(/[\s=-]/g, "").toUpperCase();
  let bits = 0, value = 0;
  const out: number[] = [];
  for (const char of clean) {
    const index = ALPHABET.indexOf(char);
    if (index < 0) throw new Error("invalid base32");
    value = (value << 5) | index; bits += 5;
    if (bits >= 8) { out.push((value >>> (bits - 8)) & 255); bits -= 8; }
  }
  return Buffer.from(out);
}

export function newSecret(): string { return base32Encode(randomBytes(20)); }

export function hotp(secret: Buffer, counter: number): string {
  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(BigInt(counter));
  const digest = createHmac("sha1", secret).update(message).digest();
  const offset = digest[digest.length - 1] & 15;
  const code = ((digest[offset] & 127) << 24) | (digest[offset + 1] << 16) | (digest[offset + 2] << 8) | digest[offset + 3];
  return String(code % 1_000_000).padStart(6, "0");
}

export function stepAt(now: number): number { return Math.floor(now / 1000 / STEP_SECONDS); }

/** The matching step (so a code can never be used twice), or null. Accepts one step either side for clock drift. */
export function verifyTotp(secretBase32: string, code: string, now: number, lastUsedStep = -1): number | null {
  if (!/^\d{6}$/.test(code)) return null;
  const secret = base32Decode(secretBase32);
  const current = stepAt(now);
  let matched: number | null = null;
  for (const step of [current - 1, current, current + 1]) {
    const expected = Buffer.from(hotp(secret, step));
    // Every candidate is compared in constant time; the loop never exits early.
    if (timingSafeEqual(expected, Buffer.from(code)) && step > lastUsedStep && matched === null) matched = step;
  }
  return matched;
}

export function otpauthUri(secretBase32: string, account: string, issuer = "Tech Phase"): string {
  return `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(account)}?secret=${secretBase32}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=${STEP_SECONDS}`;
}
