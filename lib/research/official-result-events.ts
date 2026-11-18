import type { Copy, ResearchEvent } from './data';
import providers from './providers.json' with { type: 'json' };

function articleUrl(value: string, ticker: string): string | null {
  const url=new URL(value), provider=providers.find(p=>p.ticker===ticker);
  return url.protocol==='https:' && !url.username && !url.password && !url.port && !url.search && !url.hash
    && provider?.articleRules.some(r=>r.host===url.hostname && new RegExp(r.pattern).test(url.pathname)) ? url.href : null;
}

// Owner, Nov 18: the monitor writes note-specific "still unknown" / "next"
// lines in the same model call and sends them only after its checks. Older
// notes, or lines that failed a check, get a short line for the note's kind.
const FALLBACK: Record<'acquisition' | 'earnings' | 'partnership' | 'product', { unknown: Copy; next: Copy }> = {
  acquisition: {
    unknown: { ja: '買収が売上や利益にどの程度寄与するかは、この発表からは分かりません。', en: 'The release does not show how much the acquisition will add to revenue or profit.' },
    next: { ja: '買収完了の時期と、その後の決算での扱いを確認します。', en: 'Check when the acquisition closes and how later earnings reports treat it.' },
  },
  earnings: {
    unknown: { ja: '数字の内訳や背景の詳しい説明は、この発表だけでは分かりません。', en: 'The release alone does not explain the breakdown and drivers of the figures in detail.' },
    next: { ja: '次回の決算発表で、今回の数字からの変化を確認します。', en: 'Check how the figures change in the next earnings release.' },
  },
  partnership: {
    unknown: { ja: '提携の金額条件や売上への寄与は、この発表からは分かりません。', en: 'The release does not show the financial terms of the partnership or its revenue contribution.' },
    next: { ja: '提携の具体的な成果が、今後の発表や決算で示されるかを確認します。', en: 'Check whether later releases or earnings reports show concrete results from the partnership.' },
  },
  product: {
    unknown: { ja: '製品の販売規模や売上への寄与は、この発表からは分かりません。', en: 'The release does not show the sales scale of the product or its revenue contribution.' },
    next: { ja: '提供開始の時期と、今後の決算での言及を確認します。', en: 'Check when the product becomes available and whether later earnings reports mention it.' },
  },
};

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
    // An optional generated line; anything malformed falls back, never fails the note.
    const line = (v: unknown): Copy | undefined => {
      if (v === undefined) return undefined;
      try {
        const c = copy(v);
        return c.ja.length <= 240 && c.en.length <= 240 && !/https?:\/\//i.test(`${c.ja} ${c.en}`) ? c : undefined;
      } catch { return undefined; }
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
      unknown: line(r.unknown) ?? FALLBACK[kind as keyof typeof FALLBACK].unknown,
      next: line(r.next) ?? FALLBACK[kind as keyof typeof FALLBACK].next,
      sources: [{ id, url, title: str('sourceTitle', 500), publisher: `${ticker} IR`, publishedOn,
        location: r.dateBasis === 'detection' ? 'Detection date; company announcement' : 'Company announcement' }],
      metrics: [],
    };
  });
}
