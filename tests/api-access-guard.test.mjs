import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

// Every API route is either on the explicit public list below (with the reason it may be public) or it must visibly check who is asking
// (sign-in, membership, owner, or the monitor's token). A new route that does neither fails here, so a PRO feature cannot ship open by accident.
const PUBLIC = {
  'research/macro': 'public FRED rates, no member data',
  'research/earnings-consensus': 'public EPS consensus (Twelve Data display licence, attribution shown)',
  'research/market/board': 'public market quotes (Twelve Data display licence)',
  'research/market/chart': 'public market chart',
  'research/market/period-bases': 'public closes a stock page measures its period change from',
  'research/market/facts': 'public market facts',
  'research/market/quotes': 'public market quotes',
  'research/news/stream': 'change signal only, short-lived origin-bound ticket',
  'research/price-targets/stream': 'change signal only, short-lived origin-bound ticket',
  'research/news': 'public news feed (FREE limits are applied by the feed builder)',
  'research/price-targets': 'public price-target feed',
  'research/company-wire': 'public company wire',
  'research/live': 'public live feed',
  'research/freshness': 'public freshness stamps',
  'research/stocks': 'public stock directory',
  'resolute/receive': 'guest checkout receipt (switch-gated, origin-checked)',
};
const GUARD = /getMembership\w*\(|auth\(\)|currentUser|ownerIdentity|accountIdentity|riskProxy|handleLiveBilling|handleSandboxBilling|validSyncToken|createRecoveryCheck|requireOwner|isOwnerAccount|Bearer|getResoluteEntitlements|canUseTools|\.\.\.action|routes\./;
function routes(dir) {
  return readdirSync(dir).flatMap(name => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? routes(path) : name === 'route.ts' ? [path] : [];
  });
}
const all = routes('app/api').map(path => ({ path, id: relative('app/api', path).replace(/\/route\.ts$/, '') }));
test('every API route checks who is asking, or is on the public list', () => {
  const open = all.filter(route => !(route.id in PUBLIC) && !GUARD.test(readFileSync(route.path, 'utf8'))).map(route => route.id);
  assert.deepEqual(open, [], `these routes neither check the caller nor appear on the public list: ${open.join(', ')}`);
});
test('the public list has no stale entries', () => {
  const ids = new Set(all.map(route => route.id));
  assert.deepEqual(Object.keys(PUBLIC).filter(id => !ids.has(id)), []);
});
test('the PRO-only notification route rejects non-PRO callers before touching the monitor', () => {
  const source = readFileSync('app/api/research/notifications/route.ts', 'utf8');
  assert.match(source, /member\.plan !== "pro"/);
  assert.match(source, /pro-required/);
});
