import 'server-only';
import { getMembership } from '@/lib/membership/server';
import { parseCompanyWire } from './company-wire';
import { projectTechNews } from './tech-news-access';
import type { GeneralNewsFeed } from './general-news';

export async function hasProNewsAccess() {
  try { return (await getMembership()).plan === 'pro'; }
  catch { return false; }
}

export async function audienceNews(feed: GeneralNewsFeed) {
  if (await hasProNewsAccess()) return projectTechNews(feed, {}, true);
  let wire = {};
  try {
    const url = new URL(process.env.RESEARCH_MONITOR_URL ?? '');
    if (!process.env.RESEARCH_MONITOR_TOKEN || url.username || url.password
      || (url.protocol !== 'https:' && !(process.env.NODE_ENV !== 'production' && ['localhost', '127.0.0.1'].includes(url.hostname)))) throw Error('Invalid monitor');
    url.pathname = `${url.pathname.replace(/\/$/, '')}/company-wire`; url.search = ''; url.hash = '';
    const reply = await fetch(url, { headers: { Authorization: `Bearer ${process.env.RESEARCH_MONITOR_TOKEN}` }, cache: 'no-store', signal: AbortSignal.timeout(2500) });
    if (!reply.ok) throw Error('Unavailable');
    const text = await reply.text();
    if (new TextEncoder().encode(text).length > 400000) throw Error('Oversized');
    wire = parseCompanyWire(JSON.parse(text)).items;
  } catch { /* Optional headlines never block verified news or free results. */ }
  return projectTechNews(feed, wire, false);
}
