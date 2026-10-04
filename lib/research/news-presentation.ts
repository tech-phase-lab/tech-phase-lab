import { NEWS_BRIEF_TITLE_SUFFIXES, type OfficialUpdate } from './general-news.ts';
import type { Language } from './data';
import type { ResultBrief } from './market-results';
import { inlineNewsComparisons } from './news-inline-comparisons.ts';
import { officialHeadlineJa } from './official-news-ja.ts';
import { additionalNewsDetail } from './news-detail.ts';

/** Categories describe the story. Publisher identity remains source metadata. */
export function officialNewsDisplay(item: OfficialUpdate, lang: Language, briefs: ResultBrief[] = []) {
  const ja = lang === 'ja';
  const economic = item.tickers.includes('ECON') || new URL(item.url).hostname === 'www.bea.gov';
  const briefLabel = item.brief?.scope === 'sector' ? (ja ? '業界短報' : 'Industry brief')
    : (ja ? '企業短報' : 'Company brief');
  const label = item.brief ? `${briefLabel}${item.tickers.length ? ' · ' + item.tickers.join(' · ') : ''} · ${ja ? '詳細は確認中' : 'Details awaiting review'}`
    : economic ? (ja ? '経済指標' : 'Economic indicators')
    : `${ja ? '企業ニュース' : 'Company news'}${item.tickers.length ? ' · ' + item.tickers.join(' · ') : ''}`;
  const sourceTitle = ja ? officialHeadlineJa(item.url) ?? item.translationJa ?? (item.brief ? briefLabel : '企業ニュース') : item.title;
  const suffix = NEWS_BRIEF_TITLE_SUFFIXES[lang];
  const title = item.brief && sourceTitle.endsWith(suffix) ? sourceTitle.slice(0, -suffix.length) : sourceTitle;
  const compact = inlineNewsComparisons(title, item, lang, briefs);
  return { label, title: compact.title, body: additionalNewsDetail([label, compact.title, ...(item.brief ? [sourceTitle] : []), ...compact.visibleFacts], ja ? item.bodyJa : item.bodyEn, item.sources?.map(source => source.publisher)) };
}
