import type { OfficialUpdate } from './general-news';
import type { Language } from './data';
import type { ResultBrief, ResultFact } from './market-results';
import { resultFactText } from './result-news.ts';
import { additionalNewsDetail } from './news-detail.ts';

/** Fold short, unambiguous result comparisons beside their already-visible actual.
 * Facts stay source-bound. Conflicting values or longer prose keep their detail. */
export function inlineNewsComparisons(title: string, item: OfficialUpdate, lang: Language, briefs: ResultBrief[]) {
  const identities = [item, ...(item.sources ?? [])];
  const facts = briefs.filter(brief => brief.kind === 'economic' && identities.some(source =>
    source.id === brief.id && source.url === brief.url)).flatMap(brief => brief.facts);
  const groups = new Map<string, ResultFact[]>();
  for (const fact of facts) {
    const group = groups.get(fact[lang]) ?? [];
    group.push(fact); groups.set(fact[lang], group);
  }
  const visibleFacts: string[] = [];
  const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  for (const group of groups.values()) {
    if (new Set(group.map(fact => fact.value)).size !== 1) continue;
    const compared = group.filter(fact => fact.comparisons && Object.keys(fact.comparisons).length);
    const variants = [...new Set(compared.map(fact => resultFactText(fact, lang)))];
    // Do not pick one forecast or combine differing reporting into a consensus.
    if (variants.length !== 1) continue;
    const fact = compared[0], full = variants[0];
    // Match a complete metric clause, never a suffix of another population or
    // basis (for example youth unemployment versus overall unemployment).
    const pattern = new RegExp(`(^|[;；／\\n])\\s*${escape(fact[lang])}\\s*[:：]?\\s*${escape(fact.value)}(?![\\p{L}\\p{N}.%$+\\-])`, 'giu');
    const matches = [...title.matchAll(pattern)];
    if (matches.length !== 1) continue;
    if (!additionalNewsDetail(title, full)) {
      visibleFacts.push(...group.map(fact => resultFactText(fact, lang)));
      continue;
    }
    const base = resultFactText({ ...fact, comparisons: undefined }, lang);
    const suffix = full.slice(base.length);
    const end = matches[0].index! + matches[0][0].length;
    if (/^\s*[（(]/.test(title.slice(end)) || title.length + suffix.length > 260) continue;
    title = title.replace(pattern, match => match + suffix);
    visibleFacts.push(...group.map(fact => resultFactText(fact, lang)));
  }
  return { title, visibleFacts };
}
