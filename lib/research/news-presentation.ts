import type { OfficialUpdate } from './general-news';
import type { Language } from './data';
import type { ResultBrief } from './market-results';
import { inlineNewsComparisons } from './news-inline-comparisons.ts';
import { officialHeadlineJa } from './official-news-ja.ts';
import { additionalNewsDetail } from './news-detail.ts';

/** Categories describe the story. Publisher identity remains source metadata. */
export function officialNewsDisplay(item: OfficialUpdate, lang: Language, briefs: ResultBrief[] = []) {
  const ja = lang === 'ja';
  const economic = item.tickers.includes('ECON') || new URL(item.url).hostname === 'www.bea.gov';
  const label = economic ? (ja ? '経済指標' : 'Economic indicators')
    : `${ja ? '企業ニュース' : 'Company news'}${item.tickers.length ? ' · ' + item.tickers.join(' · ') : ''}`;
  const title = ja ? officialHeadlineJa(item.url) ?? item.translationJa ?? '企業ニュース' : item.title;
  const compact = inlineNewsComparisons(title, item, lang, briefs);
  return { label, title: compact.title, body: additionalNewsDetail([label, compact.title, ...compact.visibleFacts], ja ? item.bodyJa : item.bodyEn, item.sources?.map(source => source.publisher)) };
}
