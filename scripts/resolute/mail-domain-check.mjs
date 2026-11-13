/** Read-only operator check of the mail sender: provider key validity and sending-domain authentication.
 * Never sends mail, never writes, never prints keys, addresses or DNS record values: only names and booleans.
 *   - Resend `GET /domains` (read): does the key work, and is the From domain registered and `verified`?
 *   - DNS TXT lookups (read): SPF present, DKIM selector present, DMARC present for the From domain.
 * A sending-only Resend key cannot list domains; that is reported as `key-restricted`, not as a pass.
 * Run only by an operator, with the key supplied through the environment. Disabled unless RESOLUTE_MAIL_DOMAIN_CHECK=true.
 */
import {resolveTxt} from 'node:dns/promises';
import {pathToFileURL} from 'node:url';
const EMAIL = /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@([A-Za-z0-9.-]+\.[A-Za-z]{2,})$/;

async function txt(resolver, name) {
  try { return (await resolver(name)).map(parts => parts.join('')); } catch { return []; }
}

export async function checkMailDomain(env = process.env, deps = {}) {
  const request = deps.request ?? fetch, resolver = deps.resolver ?? resolveTxt;
  const from = env.RESOLUTE_MAIL_FROM ?? '', key = env.RESOLUTE_RESEND_API_KEY ?? '';
  const match = EMAIL.exec(from);
  if (!match || from.length > 320 || !/^re_[A-Za-z0-9_-]{10,200}$/.test(key)) throw Error('Invalid mail configuration');
  const domain = match[1].toLowerCase();
  const checks = [];
  let provider = 'unavailable';
  try {
    const response = await request('https://api.resend.com/domains', {method: 'GET', redirect: 'error', cache: 'no-store',
      signal: AbortSignal.timeout(15000), headers: {Authorization: 'Bearer ' + key}});
    if (response.status === 200) {
      const body = await response.json();
      const list = Array.isArray(body?.data) ? body.data : [];
      const found = list.find(d => typeof d?.name === 'string' && (domain === d.name.toLowerCase() || domain.endsWith('.' + d.name.toLowerCase())));
      provider = !found ? 'domain-not-registered' : found.status === 'verified' ? 'verified' : 'not-verified';
      checks.push({name: 'provider-key-valid', ok: true});
    } else if (response.status === 401 || response.status === 403) {
      // Restricted (sending-only) keys answer 401/403 here although they can send: not a pass, not proof of invalidity.
      provider = 'key-restricted';
      checks.push({name: 'provider-key-valid', ok: false});
    } else checks.push({name: 'provider-key-valid', ok: false});
  } catch { checks.push({name: 'provider-key-valid', ok: false}); }
  checks.push({name: 'provider-domain-verified', ok: provider === 'verified'});
  const roots = [domain, ...(domain.split('.').length > 2 ? [domain.split('.').slice(1).join('.')] : [])];
  let spf = false, dkim = false, dmarc = false;
  for (const name of roots) {
    spf ||= (await txt(resolver, name)).some(v => /^v=spf1\s/i.test(v));
    dmarc ||= (await txt(resolver, '_dmarc.' + name)).some(v => /^v=DMARC1/i.test(v));
  }
  for (const name of roots) dkim ||= (await txt(resolver, 'resend._domainkey.' + name)).some(v => /^p=|v=DKIM1/i.test(v));
  checks.push({name: 'dns-spf', ok: spf}, {name: 'dns-dkim', ok: dkim}, {name: 'dns-dmarc', ok: dmarc});
  return {event: 'RESOLUTE_MAIL_DOMAIN_CHECK', provider, checks, allPassed: checks.every(c => c.ok),
    note: 'Provider acceptance and DNS records do not prove inbox placement; ja/en mailbox acceptance still needs a real owner-only test message.'};
}

export async function main(env = process.env, deps = {}) {
  if (env.RESOLUTE_MAIL_DOMAIN_CHECK !== 'true') return {event: 'RESOLUTE_MAIL_DOMAIN_CHECK_DISABLED'};
  return checkMailDomain(env, deps);
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().then(r => { console.log(JSON.stringify(r)); if (r.allPassed === false) process.exitCode = 1; })
    .catch(() => { console.error('RESOLUTE_MAIL_DOMAIN_CHECK_FAILED'); process.exitCode = 1; });
}
