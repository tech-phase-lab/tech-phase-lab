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
  const label = item.newsCategory === 'policy'
    ? `${ja ? '政策ニュース' : 'Policy news'}${item.tickers.length ? ' · ' + item.tickers.join(' · ') : ''}`
    : item.newsCategory === 'economic' ? (ja ? '経済ニュース' : 'Economic news')
    : item.brief ? `${briefLabel}${item.tickers.length ? ' · ' + item.tickers.join(' · ') : ''} · ${ja ? '詳細は確認中' : 'Details awaiting review'}`
    : economic ? (ja ? '経済指標' : 'Economic indicators')
    : `${ja ? '企業ニュース' : 'Company news'}${item.tickers.length ? ' · ' + item.tickers.join(' · ') : ''}`;
  const reviewedJa = ja ? officialHeadlineJa(item.url) ?? item.translationJa : undefined;
  // Policy B (owner decision): when one language is not ready or was held by
  // validation, publish the available original now and mark it, rather than
  // hiding the story or showing a generic placeholder.
  const pendingTranslation = ja && !reviewedJa && !item.brief;
  const sourceTitle = ja ? reviewedJa ?? (item.brief ? briefLabel : item.title) : item.title;
  const suffix = NEWS_BRIEF_TITLE_SUFFIXES[lang];
  const title = item.brief && sourceTitle.endsWith(suffix) ? sourceTitle.slice(0, -suffix.length) : sourceTitle;
  const compact = inlineNewsComparisons(title, item, lang, briefs);
  const body = ja ? item.bodyJa ?? (pendingTranslation ? item.bodyEn : undefined) : item.bodyEn;
  return { label: pendingTranslation ? `${label} · 翻訳準備中（原文）` : label, title: compact.title, pendingTranslation, fullBody: body,
    body: additionalNewsDetail([label, compact.title, ...(item.brief ? [sourceTitle] : []), ...compact.visibleFacts], body, item.sources?.map(source => source.publisher)) };
}

/** A headline-only company item must say who did what: a bare product or
 * blog heading ("Next-Generation Scale-Up Networking for AI Fabrics") with no
 * body and no company name tells a reader nothing (owner, Oct 7). */
export function informativeOfficial(item: OfficialUpdate) {
  if (item.bodyJa || item.bodyEn || item.brief || item.newsCategory || item.generalSource || item.researchId) return true;
  const text = `${item.title} ${item.translationJa ?? ''}`.toLowerCase();
  const names = [...item.tickers, item.publisher.split(/\s+/)[0]].filter(name => name && name.length > 1);
  if (names.some(name => text.includes(name.toLowerCase()))) return true;
  return /\b(?:results?|earnings|acquir\w*|merger|dividend|guidance|revenue|buyback|repurchase|offering|appoint\w*|ceo|cfo)\b|決算|買収|配当|売上|自社株/i.test(text);
}
