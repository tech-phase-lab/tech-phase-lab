import test from "node:test";
import assert from "node:assert/strict";
import { base32Decode, base32Encode, hotp, newSecret, otpauthUri, stepAt, verifyTotp } from "../lib/owner-2fa/totp.ts";
import { open, seal, signProof, verifyProof } from "../lib/owner-2fa/seal.ts";
import { MAX_FAILURES, afterFailure, afterSuccess, isLocked } from "../lib/owner-2fa/lockout.ts";

const RFC_SECRET = Buffer.from("12345678901234567890");
const ENC = "11".repeat(32), PROOF = "22".repeat(32), OTHER = "33".repeat(32);

test("TOTP matches the RFC 6238 SHA-1 test vectors (last six digits)", () => {
  // RFC 6238 Appendix B, 8-digit values 94287082 / 07081804 / 14050471 at T=59, 1111111109, 1111111111.
  assert.equal(hotp(RFC_SECRET, Math.floor(59 / 30)), "287082");
  assert.equal(hotp(RFC_SECRET, Math.floor(1111111109 / 30)), "081804");
  assert.equal(hotp(RFC_SECRET, Math.floor(1111111111 / 30)), "050471");
});

test("base32 round-trips and the secret is 160 bits", () => {
  const secret = newSecret();
  assert.match(secret, /^[A-Z2-7]{32}$/);
  assert.equal(base32Encode(base32Decode(secret)), secret);
  assert.equal(base32Encode(RFC_SECRET), "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ");
});

test("a code is accepted within one step of drift, once, and never otherwise", () => {
  const secret = base32Encode(RFC_SECRET);
  const now = 1111111109_000;
  const code = hotp(RFC_SECRET, stepAt(now));
  const step = verifyTotp(secret, code, now);
  assert.equal(step, stepAt(now));
  assert.equal(verifyTotp(secret, code, now, step), null, "the same step cannot be used twice");
  assert.equal(verifyTotp(secret, code, now + 30_000), step, "one step of drift is allowed");
  assert.equal(verifyTotp(secret, code, now + 120_000), null, "an old code is rejected");
  assert.equal(verifyTotp(secret, "000000", now), null);
  assert.equal(verifyTotp(secret, "12345", now), null);
  assert.equal(verifyTotp(secret, "１２３４５６", now), null, "only ASCII digits");
});

test("the authenticator link carries the secret, issuer and a six digit 30 s period", () => {
  const uri = otpauthUri("ABCDEFGH", "owner");
  assert.match(uri, /^otpauth:\/\/totp\/Tech%20Phase:owner\?secret=ABCDEFGH&issuer=Tech%20Phase&algorithm=SHA1&digits=6&period=30$/);
});

test("the stored secret is encrypted, bound to its context and fails when altered", () => {
  const sealed = seal("SECRETVALUE", ENC, "user_1");
  assert.ok(!sealed.includes("SECRETVALUE"));
  assert.equal(open(sealed, ENC, "user_1"), "SECRETVALUE");
  assert.throws(() => open(sealed, ENC, "user_2"));
  assert.throws(() => open(sealed, OTHER, "user_1"));
  const tampered = sealed.slice(0, -2) + (sealed.endsWith("AA") ? "BB" : "AA");
  assert.throws(() => open(tampered, ENC, "user_1"));
  assert.notEqual(sealed, seal("SECRETVALUE", ENC, "user_1"), "a fresh nonce each time");
});

test("missing or malformed keys fail closed", () => {
  assert.throws(() => seal("x", undefined, "c"), /OWNER_2FA_NOT_CONFIGURED/);
  assert.throws(() => seal("x", "zz", "c"), /OWNER_2FA_NOT_CONFIGURED/);
  assert.equal(verifyProof("v1.9999999999.abc", "u", 0, undefined), false);
});

test("the proof is for one user, expires, and cannot be forged or extended", () => {
  const now = 1_800_000_000_000;
  const proof = signProof("user_1", now, PROOF);
  assert.equal(verifyProof(proof, "user_1", now + 1000, PROOF), true);
  assert.equal(verifyProof(proof, "user_2", now + 1000, PROOF), false);
  assert.equal(verifyProof(proof, "user_1", now + 8 * 3600_000 + 1000, PROOF), false);
  assert.equal(verifyProof(proof, "user_1", now + 1000, OTHER), false);
  const [v, exp, mac] = proof.split(".");
  assert.equal(verifyProof(`${v}.${Number(exp) + 3600}.${mac}`, "user_1", now + 1000, PROOF), false, "expiry is covered by the signature");
  for (const bad of ["", "v1", "v2.1.x", "v1.abc.x", null, undefined, "x".repeat(300)]) assert.equal(verifyProof(bad, "user_1", now, PROOF), false);
});

test("five wrong codes lock the check for 15 minutes; success clears the count", () => {
  let state = afterSuccess();
  const now = 1_000_000;
  for (let i = 1; i < MAX_FAILURES; i++) { state = afterFailure(state, now); assert.equal(isLocked(state, now), false); }
  state = afterFailure(state, now);
  assert.equal(isLocked(state, now), true);
  assert.equal(isLocked(state, now + 15 * 60_000 + 1), false);
  assert.deepEqual(afterSuccess(), { failures: 0, lockedUntil: 0 });
});

import { readFile } from "node:fs/promises";
const src = path => readFile(new URL(path, import.meta.url), "utf8");

test("every owner 2FA route goes through the same guard, and POSTs need same-origin JSON", async () => {
  for (const name of ["status", "begin", "confirm", "verify"]) {
    const route = await src(`../app/api/research/account/owner-2fa/${name}/route.ts`);
    assert.match(route, /guard\(request, (true|false)\)/, name);
    assert.match(route, /dynamic = "force-dynamic"/, name);
  }
  const guard = await src("../lib/owner-2fa/route.ts");
  assert.match(guard, /request\.headers\.get\("origin"\) !== new URL\(request\.url\)\.origin/);
  assert.match(guard, /signedInOwner\(\)/);
  assert.match(guard, /ownerTwoFactorConfigured\(\)/);
  assert.match(guard, /Cache-Control": "private, no-store"/);
});

test("setup is refused once enabled, the secret is stored encrypted, and codes cannot be replayed", async () => {
  const server = await src("../lib/owner-2fa/server.ts");
  assert.match(server, /ALREADY_ENABLED/);
  assert.match(server, /seal\(secret, env\(\)\.enc/);
  assert.match(server, /lastStep/);
  assert.match(server, /httpOnly: true/);
  assert.match(server, /sameSite: "strict"/);
  assert.match(server, /isOwnerAccount\(userId\)/);
  // The secret is never written to a log or cookie.
  assert.doesNotMatch(server, /console\./);
});

test("the setup page never keeps the secret in browser storage", async () => {
  const screen = await src("../app/research/account/owner-2fa/screen.tsx");
  assert.doesNotMatch(screen, /localStorage|sessionStorage|document\.cookie/);
  assert.match(screen, /one-time-code/);
});

test("the owner's account screen links to the code page", async () => {
  const view = await src("../app/research/account/account-view.tsx");
  assert.match(view, /href: "\/research\/account\/owner-2fa"/);
});
