import { NEWS_BRIEF_TITLE_SUFFIXES, type OfficialUpdate } from './general-news.ts';
import type { Language } from './data';
import type { ResultBrief } from './market-results';
import { inlineNewsComparisons } from './news-inline-comparisons.ts';
import { officialHeadlineJa } from './official-news-ja.ts';
import { additionalNewsDetail } from './news-detail.ts';

/** Categories describe the story. Publisher identity remains source metadata. */
export function officialNewsDisplay(item: OfficialUpdate, lang: Language, briefs: ResultBrief[] = []) {
  const ja = lang === 'ja';
  const economic = item.tickers.includes('ECON') || ['www.bea.gov', 'www.bls.gov'].includes(new URL(item.url).hostname);
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

/** Owner, Oct 9: the Japanese view never shows English. A story without a
 * checked Japanese headline is listed in the English view only. */
export function shownInLanguage(item: OfficialUpdate, lang: Language) {
  return lang !== 'ja' || !officialNewsDisplay(item, 'ja').pendingTranslation;
}

/** A headline-only company item must say who did what: a bare product or
 * blog heading ("Next-Generation Scale-Up Networking for AI Fabrics") with no
 * body and no company name tells a reader nothing (owner, Oct 7). */
/** A company's own X account also posts events and greetings ("Builders & Brews tour wrapped up", owner Oct 16):
 * such a post is listed only when it says something about the business. */
const BUSINESS = /\b(?:results?|earnings|acquir\w*|merger|dividend|guidance|revenue|buyback|repurchase|offering|appoint\w*|ceo|cfo|partner\w*|agreement|contract|launch\w*|available|announc\w*|data ?cent\w*|capacity|gpu\w*|cluster|raises?|funding|billion|million|price|pricing|customers?)\b|決算|買収|配当|売上|自社株|提携|契約|発表|提供|開始|資金|データセンター|億|増資/i;
export function socialChatter(item: OfficialUpdate) {
  let host = '';
  try { host = new URL(item.url).hostname; } catch { /* not a link */ }
  if (host !== 'x.com' || /^\/(?:tipranks|theflynews|wallstengine|fabymetal4|trade_the_news|trendspider|barchart)\//i.test(new URL(item.url).pathname)) return false;
  return !BUSINESS.test(`${item.title} ${item.translationJa ?? ''}`);
}

/** Posts that are not news for readers (owner, Oct 23): a conference session blog ("GTC: How ... ") and an
 * earnings "highlights" page, which repeats the earnings release already listed with the results. */
const NOT_NEWS = /^\s*(?:GTC|Computex|OCP)(?:\s+\w+)?\s*[:：]|\b(?:Q[1-4]|first|second|third|fourth)\b.{0,30}\bhighlights?\b|\bhighlights?\b.{0,40}\b(?:Q[1-4]|quarter)\b|\bfuture workforce\b|\b(?:community college|apprenticeship|scholarship)\b|労働力が育つ|人材育成|\bweek in review\b|\bweekly (?:news )?(?:roundup|digest|recap|wrap)\b|\bthis week(?:['’]s)? (?:top|key|main|biggest|major)\b|\bwhat happened this week\b|今週の(?:主な)?(?:動向|ニュース|まとめ)|週間(?:まとめ|ニュース|動向)/i;
export const isNotNews = (item: OfficialUpdate) => NOT_NEWS.test(item.title) || NOT_NEWS.test(item.translationJa ?? '');

export function informativeOfficial(item: OfficialUpdate) {
  if (socialChatter(item) || isNotNews(item)) return false;
  if (item.bodyJa || item.bodyEn || item.brief || item.newsCategory || item.generalSource || item.researchId) return true;
  const text = `${item.title} ${item.translationJa ?? ''}`.toLowerCase();
  const names = [...item.tickers, item.publisher.split(/\s+/)[0]].filter(name => name && name.length > 1);
  if (names.some(name => text.includes(name.toLowerCase()))) return true;
  return /\b(?:results?|earnings|acquir\w*|merger|dividend|guidance|revenue|buyback|repurchase|offering|appoint\w*|ceo|cfo)\b|決算|買収|配当|売上|自社株/i.test(text);
}
