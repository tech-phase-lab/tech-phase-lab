import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

// Every API route is either on the explicit public list below (with the reason it may be public) or it must visibly check who is asking
// (sign-in, membership, owner, or the monitor's token). A new route that does neither fails here, so a PRO feature cannot ship open by accident.
const PUBLIC = {
  'research/macro': 'public FRED rates, no member data',
  'research/economic-history': 'public FRED history of the economic indicators for the calendar bars (FREE; no member data)',
  'research/economic-results': 'public stored economic indicator results for the calendar (FREE under the Oct 25 policy; official figures, no member data)',
  'research/capital-map': 'public reported 13F / issuer holdings for 資本マップ (FREE), the same data the page draws',
  'research/earnings-consensus': 'public EPS consensus (Twelve Data display licence, attribution shown)',
  'research/market/board': 'public market quotes (Twelve Data display licence)',
  'research/market/chart': 'public market chart',
  'research/market/period-bases': 'public closes a stock page measures its period change from',
  'research/market/facts': 'public market facts',
  'research/market/quotes': 'public market quotes',
  'research/market/snapshot': 'public market quotes and first charts of every マーケット tab from the shared snapshot (Twelve Data display licence)',
  'research/market/leveraged': 'public quotes of long 2x / 3x ETFs for the マーケット レバETF tab (Twelve Data display licence)',
  'research/news/stream': 'change signal only, short-lived origin-bound ticket',
  'research/price-targets/stream': 'change signal only, short-lived origin-bound ticket',
  'research/news': 'public news feed (FREE limits are applied by the feed builder)',
  'research/earnings-results': 'public earnings results of a month for the calendar (FREE under the Oct 25 policy; no member data)',
  'research/company-earnings': 'the 監視銘柄 pages\' earnings key figures (FREE under the Oct 25 policy) and yes/no checks of the dive, for the monitor\'s earnings patrol; no member data',
  'research/price-targets': 'public price-target feed',
  'research/company-wire': 'public company wire',
  'research/live': 'public live feed',
  'research/freshness': 'public freshness stamps',
  'research/radar/freshness': 'tickers and codes of radar companies behind their SEC filing (no figures, no dates); cached an hour',
  'research/stocks': 'public stock directory',
  'resolute/receive': 'guest checkout receipt (switch-gated, origin-checked)',
  'csp-report': 'browsers post CSP report-only violations; write-only, logs directive and blocked host only, rate limited',
  'webhooks/clerk': 'Clerk user.deleted webhook: Svix signature (CLERK_WEBHOOK_SIGNING_SECRET) checked before anything, owner accounts refused, off unless MEMBER_ERASURE_ENABLED=true',
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
  // Nov 17 (owner): PRO, or RESOLUTE rights confirmed on the server (pushAccessDecision); anyone else is refused before the monitor.
  assert.match(source, /member\.plan === "pro"/);
  assert.match(source, /pushAccessDecision\(access\)/);
  assert.match(source, /pro-required/);
});
