import { createCipheriv, createDecipheriv, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/** The owner's authenticator secret is stored encrypted (AES-256-GCM) and a verified second factor is carried as a short signed
 * proof (HMAC-SHA-256). Keys come from the environment and are never logged. */
function key(hex: string | undefined): Buffer {
  if (!hex || !/^[0-9a-f]{64}$/i.test(hex)) throw new Error("OWNER_2FA_NOT_CONFIGURED");
  return Buffer.from(hex, "hex");
}

export function seal(plain: string, encKeyHex: string | undefined, context: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(encKeyHex), iv);
  cipher.setAAD(Buffer.from(context));
  const body = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), body]).toString("base64url");
}

export function open(sealed: string, encKeyHex: string | undefined, context: string): string {
  const raw = Buffer.from(sealed, "base64url");
  if (raw.length < 29) throw new Error("OWNER_2FA_BAD_DATA");
  const decipher = createDecipheriv("aes-256-gcm", key(encKeyHex), raw.subarray(0, 12));
  decipher.setAAD(Buffer.from(context));
  decipher.setAuthTag(raw.subarray(12, 28));
  return Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString("utf8");
}

export const PROOF_SECONDS = 8 * 3600;

function mac(proofKeyHex: string | undefined, userId: string, expires: number): string {
  return createHmac("sha256", key(proofKeyHex)).update(`owner-2fa.v1.${userId}.${expires}`).digest("base64url");
}

export function signProof(userId: string, now: number, proofKeyHex: string | undefined, seconds = PROOF_SECONDS): string {
  const expires = Math.floor(now / 1000) + seconds;
  return `v1.${expires}.${mac(proofKeyHex, userId, expires)}`;
}

/** True only for an unexpired proof that was signed for exactly this user. */
export function verifyProof(proof: string | undefined | null, userId: string, now: number, proofKeyHex: string | undefined): boolean {
  if (!proof || proof.length > 200) return false;
  const parts = proof.split(".");
  if (parts.length !== 3 || parts[0] !== "v1" || !/^\d{1,12}$/.test(parts[1])) return false;
  const expires = Number(parts[1]);
  if (!Number.isSafeInteger(expires) || expires * 1000 <= now) return false;
  let expected: Buffer;
  try { expected = Buffer.from(mac(proofKeyHex, userId, expires)); } catch { return false; }
  const given = Buffer.from(parts[2]);
  return given.length === expected.length && timingSafeEqual(given, expected);
}
