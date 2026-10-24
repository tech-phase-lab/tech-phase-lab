import type { Copy, ResearchEvent } from './data';
import providers from './providers.json' with { type: 'json' };

function articleUrl(value: string, ticker: string): string | null {
  const url=new URL(value), provider=providers.find(p=>p.ticker===ticker);
  return url.protocol==='https:' && !url.username && !url.password && !url.port && !url.search && !url.hash
    && provider?.articleRules.some(r=>r.host===url.hostname && new RegExp(r.pattern).test(url.pathname)) ? url.href : null;
}

// The monitor API is server-authenticated; validate again before exposing any
// metadata. Private purpose/analysis is stripped by publicEvent on the page.
export function officialResultEvents(value: unknown): ResearchEvent[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 20) throw Error('Invalid issuer notes');
  return value.map(raw => {
    if (!raw || typeof raw !== 'object') throw Error('Invalid issuer note');
    const r = raw as Record<string, unknown>;
    const str = (key: string, max = 400) => {
      const v = r[key];
      if (typeof v !== 'string' || !v.trim() || v.length > max || v.includes('\0')) throw Error('Invalid issuer field');
      return v;
    };
    const copy = (v: unknown): Copy => {
      if (!v || typeof v !== 'object') throw Error('Invalid issuer copy');
      const c = v as Record<string, unknown>;
      if (typeof c.ja !== 'string' || typeof c.en !== 'string' || !c.ja.trim() || !c.en.trim()
        || c.ja.length > 400 || c.en.length > 400 || `${c.ja}${c.en}`.includes('\0')) throw Error('Invalid issuer copy');
      return { ja: c.ja, en: c.en };
    };
    const id = str('id', 40), ticker = str('ticker', 10), kind = str('kind', 20);
    const url = str('url', 500);
    if (!/^ir-result-\d+$/.test(id) || !['acquisition', 'earnings', 'partnership', 'product'].includes(kind)
      || articleUrl(url, ticker) !== url) throw Error('Invalid issuer source');
    const publishedOn = str('publishedOn', 10), publicAt = str('publicAt', 50);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(publishedOn) || !Number.isFinite(Date.parse(publishedOn))
      || !/T.*(?:Z|[+-]\d\d:\d\d)$/.test(publicAt) || !Number.isFinite(Date.parse(publicAt))) throw Error('Invalid issuer date');
    if (!['publication', 'detection'].includes(str('dateBasis', 15))) throw Error('Invalid date basis');
    if (!Array.isArray(r.facts) || r.facts.length < 3 || r.facts.length > 5) throw Error('Invalid issuer facts');
    const factual = r.facts.map(f => ({ text: copy(f), sourceIds: [id] }));
    return {
      id, ticker, company: ticker, category: ['NBIS','CRWV','MSFT','GOOGL','ORCL','PLTR'].includes(ticker) ? 'cloud' : ['MU','SKHY','SNDK','NVDA','AMD','ARM','TSM','ASML'].includes(ticker) ? 'memory' : 'other',
      kind: kind as ResearchEvent['kind'], dateBasis: r.dateBasis as ResearchEvent['dateBasis'], publishedOn, reviewedOn: publicAt.slice(0,10),
      title: copy(r.title), summary: copy(r.summary), change: copy(r.summary), facts: factual,
      interpretation: copy(r.purpose),
      unknown: { ja: '売上や利益への影響は、今後の決算で確認します。', en: 'The effect on revenue and profit remains to be checked in subsequent earnings.' },
      next: { ja: '発表した内容の進捗を追います。', en: 'Follow the progress of the announced changes.' },
      sources: [{ id, url, title: str('sourceTitle', 500), publisher: `${ticker} IR`, publishedOn,
        location: r.dateBasis === 'detection' ? '取得日 / Detection date; company announcement' : 'Company announcement' }],
      metrics: [],
    };
  });
}
