import "server-only";
import { auth, clerkClient } from "@clerk/nextjs/server";
import { cookies } from "next/headers";
import { isOwnerAccount } from "../membership/entitlements.ts";
import { newSecret, otpauthUri, verifyTotp } from "./totp.ts";
import { open, seal, signProof, verifyProof, PROOF_SECONDS } from "./seal.ts";
import { afterFailure, afterSuccess, isLocked } from "./lockout.ts";

/** The owner's second factor, kept by us instead of by Clerk (Clerk's MFA needs its paid plan).
 * It only ever applies to the approved owner account. State lives in Clerk private metadata (server-side only). */
export const PROOF_COOKIE = "tp-owner-2fa";
type Stored = { sealed?: string | null; pending?: string | null; lastStep?: number; failures?: number; lockedUntil?: number };
const env = () => ({ enc: process.env.OWNER_2FA_ENC_KEY_HEX, proof: process.env.OWNER_2FA_PROOF_KEY_HEX });

export function ownerTwoFactorConfigured() {
  const { enc, proof } = env();
  return /^[0-9a-f]{64}$/i.test(enc ?? "") && /^[0-9a-f]{64}$/i.test(proof ?? "");
}

/** The signed-in owner, or null. Never trusts anything but Clerk's verified session. */
export async function signedInOwner(): Promise<string | null> {
  const { userId } = await auth();
  return userId && isOwnerAccount(userId) ? userId : null;
}

async function read(userId: string): Promise<{ stored: Stored; email: string }> {
  const user = await (await clerkClient()).users.getUser(userId);
  const stored = (user.privateMetadata.ownerTotp ?? {}) as Stored;
  const email = user.emailAddresses.find(e => e.id === user.primaryEmailAddressId)?.emailAddress ?? "owner";
  return { stored, email };
}
async function write(userId: string, stored: Stored) {
  await (await clerkClient()).users.updateUserMetadata(userId, { privateMetadata: { ownerTotp: stored } });
}

export async function status(userId: string, now = Date.now()) {
  const { stored } = await read(userId);
  return { enabled: Boolean(stored.sealed), pending: Boolean(stored.pending), locked: isLocked({ failures: stored.failures ?? 0, lockedUntil: stored.lockedUntil ?? 0 }, now) };
}

/** Starts (or restarts) setup. Refused once enabled: a lost authenticator is reset by hand in Clerk, never from this page. */
export async function begin(userId: string) {
  const { stored, email } = await read(userId);
  if (stored.sealed) throw new Error("ALREADY_ENABLED");
  const secret = newSecret();
  await write(userId, { ...stored, pending: seal(secret, env().enc, userId + ":pending") });
  return { secret, uri: otpauthUri(secret, email) };
}

async function check(userId: string, code: string, which: "pending" | "sealed", now: number): Promise<"ok" | "wrong" | "locked" | "missing"> {
  const { stored } = await read(userId);
  const attempts = { failures: stored.failures ?? 0, lockedUntil: stored.lockedUntil ?? 0 };
  if (isLocked(attempts, now)) return "locked";
  const blob = stored[which];
  if (!blob) return "missing";
  const secret = open(blob, env().enc, userId + (which === "pending" ? ":pending" : ":active"));
  const step = verifyTotp(secret, code, now, stored.lastStep ?? -1);
  if (step === null) {
    await write(userId, { ...stored, ...afterFailure(attempts, now) });
    return "wrong";
  }
  const base = { ...stored, ...afterSuccess(), lastStep: step };
  await write(userId, which === "pending"
    ? { ...base, sealed: seal(secret, env().enc, userId + ":active"), pending: null }
    : base);
  return "ok";
}

export const confirmSetup = (userId: string, code: string, now = Date.now()) => check(userId, code, "pending", now);
export const verifyCode = (userId: string, code: string, now = Date.now()) => check(userId, code, "sealed", now);

export async function grantProofCookie(userId: string, now = Date.now()) {
  (await cookies()).set(PROOF_COOKIE, signProof(userId, now, env().proof), {
    httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "strict", path: "/", maxAge: PROOF_SECONDS,
  });
}

/** True when the request carries a valid second-factor proof for this user. */
export async function hasOwnerProof(userId: string, now = Date.now()): Promise<boolean> {
  if (!ownerTwoFactorConfigured()) return false;
  return verifyProof((await cookies()).get(PROOF_COOKIE)?.value, userId, now, env().proof);
}
