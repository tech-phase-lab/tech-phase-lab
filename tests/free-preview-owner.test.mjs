import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Previewing FREE must look exactly like FREE (owner, Nov 12): the owner role counts only while the owner is actually on PRO.
const source = readFileSync('app/research/member-display-provider.tsx', 'utf8');
test('the owner role is shown only while the plan reads PRO (server answer, remembered hint and first render)', () => {
  assert.match(source, /setOwner\(member\.status === "signed-in" && member\.isAdmin === true && pro\)/);
  assert.match(source, /setOwner\(hint\.owner && hint\.plan === "pro"\)/);
  assert.match(source, /useState\(\(initial\?\.owner \?\? false\) && initial\?\.plan === "pro"\)/);
  assert.ok(source.indexOf('const pro = member.status') < source.indexOf('setOwner(member.status'), 'pro is computed before it is used');
});
