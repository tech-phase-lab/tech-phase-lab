import type { OfficialUpdate } from './general-news';
import type { Language } from './data';
import { officialHeadlineJa } from './official-news-ja.ts';

/** Categories describe the story. Publisher identity remains source metadata. */
export function officialNewsDisplay(item: OfficialUpdate, lang: Language) {
  const ja = lang === 'ja';
  const economic = item.tickers.includes('ECON') || new URL(item.url).hostname === 'www.bea.gov';
  const label = economic ? (ja ? '経済指標' : 'Economic indicators')
    : `${ja ? '企業ニュース' : 'Company news'}${item.tickers.length ? ' · ' + item.tickers.join(' · ') : ''}`;
  const title = ja ? officialHeadlineJa(item.url) ?? item.translationJa ?? '企業ニュース' : item.title;
  return { label, title, body: (ja ? item.bodyJa : item.bodyEn) ?? title };
}
