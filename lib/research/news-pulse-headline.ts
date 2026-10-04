import type { Language } from './data';
import type { OfficialUpdate, MarketUpdate } from './general-news';
import type { AnalystUpdate } from './analyst-news';

// The header is an editorial headline, even when a wide screen has room for prose.
// This bounds candidate selection only; it never truncates or alters the text.
const headlineUnits = (text: string) => Array.from(text).reduce((n, char) => n + (char.codePointAt(0)! > 255 ? 2 : 1), 0);
const choices = (values: (string | undefined | null)[]) => [...new Set(values.filter((value): value is string => !!value?.trim() && !/[\r\n]/.test(value) && headlineUnits(value.trim()) <= 64).map(value => value.trim()))];
const subject = (tickers: string[]) => tickers.length === 1 ? tickers[0] : '';
const topic = (name: string, text: string, lang: Language) => name ? `${name}${lang === 'ja' ? '：' : ': '}${text}` : text;

/** Select whole editorial alternatives. Never slice words, numbers or clauses. */
export function fitPulseHeadline(headlines: readonly string[], width: number, measure: (text: string) => number) {
  return headlines.find(text => measure(text) <= width) ?? '';
}

/** Only the exact published structured grammar can supply a shorter main claim.
 * A changed qualifier, period or negation falls back to its reported topic.
 * Full approved bodies remain unchanged in the lower news list. */
export function officialPulseHeadlines(item: OfficialUpdate, lang: Language, title: string, compact?: string | null) {
  const ja = lang === 'ja', name = subject(item.tickers);
  if (item.newsCategory === 'policy') {
    return choices([compact, ja ? item.shortTitleJa : item.shortTitleEn, title, ja ? '政策ニュース' : 'Policy news']);
  }
  if (item.brief) {
    const pending = ja ? '詳細確認中' : 'details pending';
    return choices([`${compact ?? title} · ${pending}`, topic(name, ja ? '短報・確認中' : 'brief; pending', lang), ja ? '短報・確認中' : 'Brief; pending']);
  }
  const candidates: string[] = [];
  const firstJa = item.bodyJa?.split(/\n\s*\n/, 1)[0];
  const firstEn = item.bodyEn?.split(/\n\s*\n/, 1)[0];
  if (item.publisher === 'Reported company news' && /^[A-Z][A-Z0-9.-]*: Reported buyback recap$/.test(item.title)) {
    const en = /^According to the report, ([A-Za-z][A-Za-z .’'&-]{0,60}) bought back its own shares for ((?:nearly |about )?[$¥]\d+(?:\.\d+)?(?: (?:billion|million|trillion))?) during the previous (quarter|year)\.(?: The amount was equivalent to (?:about |nearly )?\d+(?:\.\d+)?% of free cash flow\.)?$/.exec(firstEn ?? '');
    const jp = /^報道によると、(.+)は(前四半期|昨年)に((?:約)?\d+(?:\.\d+)?(?:兆|億|万)(?:ドル|円)(?:弱)?)の自社株を買い戻した。(?:金額はフリーキャッシュフローの(?:約)?\d+(?:\.\d+)?%(?:弱)?に相当した。)?$/.exec(firstJa ?? '');
    if (en && jp && jp[1] === en[1] && jp[2] === (en[3] === 'quarter' ? '前四半期' : '昨年')) {
      const issuer = en[1];
      const money = en[2].replace(' billion', 'B').replace(' million', 'M').replace(' trillion', 'T');
      candidates.push(...(ja ? [
        `${issuer}、${jp[2]}に${jp[3]}買戻しと報道`,
        `${issuer}、${jp[2]}の買戻し報道`,
      ] : [
        `${issuer}: ${money} repurchased prior ${en[3] === 'quarter' ? 'qtr' : 'year'} (report)`,
        `${issuer}: prior-${en[3] === 'quarter' ? 'qtr' : 'year'} buyback report`,
      ]));
    }
    candidates.push(topic(name, ja ? '自社株買い実績の報道' : 'buyback recap report', lang));
  }
  if (item.publisher === 'Reported company news' && /^[A-Z][A-Z0-9.-]*: Broker business and industry outlook$/.test(item.title)) {
    const en = /^Reported view of ([A-Za-z][A-Za-z .’'&-]{0,60}): Memory supply is expected to stay constrained through (20\d{2})\.$/.exec(firstEn ?? '');
    const jp = /^(.+)の見方として報じられた内容：メモリー供給は(20\d{2})年まで逼迫が続くと見込む。$/.exec(firstJa ?? '');
    if (en && jp && en[1] === jp[1] && en[2] === jp[2]) candidates.push(...(ja ? [
      `${jp[1]}：${jp[2]}年までメモリー逼迫予想`, `${jp[1]}：メモリー逼迫予想`,
    ] : [`${en[1]} sees tight memory supply through ${en[2]}`, `${en[1]} sees tight memory supply`, `${en[1]}: memory outlook`]));
    candidates.push(ja ? '証券会社の業界見通し' : 'Broker industry outlook');
  }
  const energy = /^([A-Za-z][A-Za-z .&-]{0,40}) Announces Commitment to Absorb \$[\d,.]+ (?:Million|Billion) in Rising ([A-Za-z][A-Za-z -]{0,50}) Energy Costs for [A-Za-z][A-Za-z -]{0,70} Residents$/.exec(item.title);
  if (energy) candidates.push(...(ja ? [
    `${energy[1]}、${energy[2]}の電力費負担計画`, `${energy[1]}、電力費負担の計画`,
  ] : [`${energy[1]}: ${energy[2]} energy-cost commitment`, `${energy[1]}: energy-cost commitment`]));
  return choices([...candidates, compact, title, topic(name, ja ? '企業ニュース' : 'company news', lang), ja ? '企業ニュース' : 'Company news']);
}

export function marketPulseHeadlines(item: MarketUpdate, lang: Language, title: string, compact?: string) {
  const ja = lang === 'ja', candidates: string[] = [];
  if (/^米国10年物国債利回りが再び急上昇中$/.test(item.titleJa)
    && /^U\.S\. 10-Year Treasury Yield (?:Rising Sharply Again|ripping again)$/i.test(item.titleEn)) {
    candidates.push(ja ? '米10年債利回り、再び急上昇' : 'U.S. 10Y yield surges again');
  }
  if (item.titleJa === '米国債、10年間の成績が史上最悪に'
    && item.titleEn === 'U.S. Treasuries suffer their worst 10-year period in history') {
    // Preserve the duration phrase: "10年間" must never look like bond maturity.
    return choices([ja ? item.titleJa : item.titleEn, ja ? '国債ニュース' : 'Treasury news']);
  }
  const topics = ja ? {'government-bonds':'国債ニュース','crude-oil':'原油ニュース','index-membership':'指数構成銘柄のニュース'}
    : {'government-bonds':'Treasury news','crude-oil':'Oil news','index-membership':'Index membership news'};
  return choices([...candidates, compact, title, topics[item.topic]]);
}

export function analystPulseHeadlines(item: AnalystUpdate, lang: Language, title: string) {
  const ja = lang === 'ja';
  const kinds = ja ? {'initiation':'調査開始の報道','upgrade':'格上げの報道','downgrade':'格下げの報道','top-pick':'Top Pickの報道','conviction-list':'推奨リストの報道','tactical-list':'短期推奨の報道'}
    : {'initiation':'coverage report','upgrade':'upgrade report','downgrade':'downgrade report','top-pick':'Top Pick report','conviction-list':'conviction-list report','tactical-list':'tactical-list report'};
  return choices([title, topic(item.ticker, kinds[item.action], lang), topic(item.ticker, ja ? 'アナリスト報道' : 'analyst report', lang)]);
}

export function generalPulseHeadlines(tickers: string[], lang: Language, title: string, compact?: string) {
  return choices([compact, title, topic(subject(tickers), lang === 'ja' ? '企業ニュース' : 'company news', lang), lang === 'ja' ? '企業ニュース' : 'Company news']);
}
