import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { OWNER_ACCOUNT_ID, PRODUCTION_OWNER_ACCOUNT_ID, isOwnerAccount } from "../lib/membership/entitlements.ts";

// Production QA, Nov 24: the operator pages were readable without signing in (noindex, but open).
// Now anyone but the owner gets the 404 page; both owner accounts keep access in every environment.
const read = path => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const PAGES = ["app/research/review/page.tsx", "app/research/editorial/page.tsx", "app/research/questions/page.tsx", "app/research/intake/page.tsx"];

test("operator pages check the owner on the server before rendering anything", () => {
  for (const path of PAGES) {
    const source = read(path);
    assert.match(source, /import \{ requireOperatorPage \} from "@\/lib\/membership\/operator-page";/, path);
    assert.match(source, /export const dynamic = "force-dynamic";/, path);
    // The check is the first statement of the page component, before any data is read or rendered.
    assert.match(source, /export default async function \w+\(\) \{\s*await requireOperatorPage\(\);/, path);
    assert.doesNotMatch(source, /^"use client"/, path);
  }
});

test("the operator check: verified session, owner accounts only, 404 for everyone else", () => {
  const helper = read("lib/membership/operator-page.ts");
  assert.match(helper, /from "@clerk\/nextjs\/server"/);
  assert.match(helper, /await auth\(\)\.then\(session => session\.userId, \(\) => null\)/);
  assert.match(helper, /if \(!isOwnerAccount\(userId\)\) notFound\(\);/);
  // The owner always keeps access (AGENTS.md: operator access), including while trying the app as FREE.
  assert.equal(isOwnerAccount(OWNER_ACCOUNT_ID), true);
  assert.equal(isOwnerAccount(PRODUCTION_OWNER_ACCOUNT_ID), true);
  for (const id of [null, undefined, "", "user_other"]) assert.equal(isOwnerAccount(id), false);
});

test("the operator pages are still covered by the auth proxy", () => {
  const matcher = read("proxy.ts").match(/"\/research\/\(\(\?!\(\?:([^)]*)\)/)?.[1] ?? "";
  for (const name of ["review", "editorial", "questions", "intake"]) assert.ok(!matcher.split("|").includes(name), name);
});
