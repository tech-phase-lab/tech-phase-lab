"use client";
import Link from "next/link";
import ProTag from "../pro-experience/pro-tag";
import type { Copy } from "@/lib/research/data";
import type { Dive, DiveCard, DiveHistory, DiveNumbers, DiveSection } from "@/lib/research/watch-earnings";
import { diveMoney, divePerShare, diveScaled, diveUnit, type DiveCurrency } from "@/lib/research/dive-money";
import styles from "./earnings-dive.module.css";

type Lang = "ja" | "en";
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const releasedLabel = (releasedOn: string, lang: Lang) => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(releasedOn); return !m ? "" : lang === "ja" ? `${Number(m[2])}/${Number(m[3])}発表` : `Reported ${MONTHS[Number(m[2]) - 1]} ${Number(m[3])}`; };
const trim = (value: number, places: number) => { const text = value.toFixed(places); return text.includes(".") ? text.replace(/0+$/, "").replace(/\.$/, "") : text; };
const pctText = (value: number) => `${value > 0 ? "+" : value < 0 ? "−" : ""}${Math.abs(value).toFixed(1)}%`;
const LABELS: Record<DiveSection["key"], Copy> = {
  happened: { ja: "何が起きたか", en: "What happened" }, good: { ja: "いい点", en: "The good" }, watch: { ja: "気をつける点", en: "Watch out" },
  means: { ja: "どうなるか", en: "What it means" }, view: { ja: "見方", en: "How to read it" },
};
const CARD_HEADINGS: Record<"growth" | "change" | "caution" | "next", Copy> = {
  growth: { ja: "01　成長の中身", en: "01  WHAT DROVE GROWTH" }, change: { ja: "02　前回からの変化", en: "02  CHANGE FROM LAST QUARTER" },
  caution: { ja: "03　注意点", en: "03  POINTS OF CAUTION" }, next: { ja: "04　次に見るポイント", en: "04  WHAT TO WATCH NEXT" },
};

function Bar({ label, value, width, tone }: { label: string; value: string; width: number; tone: "blue" | "gold" | "red" }) {
  return <div className={styles.barRow}><div className={styles.barHead}><span>{label}</span><b className={tone === "red" ? styles.redText : undefined}>{value}</b></div>
    <div className={styles.track}><i className={styles[tone]} style={{ width: `${Math.max(2, Math.min(100, width))}%` }} /></div></div>;
}
function Details({ card, lang }: { card: DiveCard; lang: Lang }) {
  return <details className={styles.more}>
    <summary>{lang === "ja" ? "詳しい解説" : "Details"}</summary>
    <div className={styles.moreBody}>
      {card.sections.map(section => <section key={section.key}><h4 className={styles[`h_${section.key}`]}>{LABELS[section.key][lang]}</h4><p>{section.text[lang]}</p></section>)}
    </div>
  </details>;
}
function Chips({ card, lang }: { card: DiveCard; lang: Lang }) {
  return <div className={styles.chips}>{card.chips.map((chip, i) => <span key={i} className={`${styles.chip} ${styles[`chip_${chip.tone}`]}`}>{chip.text[lang]}</span>)}</div>;
}
function Shell({ id, heading, card, lang, children, tail }: { id: string; heading: Copy; card: DiveCard; lang: Lang; children?: React.ReactNode; tail?: React.ReactNode }) {
  return <section className={styles.card} aria-labelledby={`dive-${id}`}>
    <p className={styles.cardNo} id={`dive-${id}`}>{heading[lang]}</p>
    <h3 className={styles.headline}>{card.headline[lang]}</h3>
    {children}
    <Chips card={card} lang={lang} />
    {tail}
    <Details card={card} lang={lang} />
  </section>;
}

function Growth({ card, numbers, currency, lang }: { card: DiveCard; numbers: DiveNumbers; currency: DiveCurrency; lang: Lang }) {
  const seg = numbers.segments?.find(s => s.key === card.segment);
  const max = seg ? Math.max(seg.revenue, seg.previous) * 1.05 : 1;
  return <Shell id="growth" heading={CARD_HEADINGS.growth} card={card} lang={lang}>
    {seg && <><Bar label={lang === "ja" ? "前四半期" : "Previous quarter"} value={diveMoney(seg.previous, currency, lang)} width={seg.previous / max * 100} tone="blue" />
      <Bar label={lang === "ja" ? "今四半期" : "This quarter"} value={diveMoney(seg.revenue, currency, lang)} width={seg.revenue / max * 100} tone="gold" /></>}
  </Shell>;
}
function Change({ card, numbers, history, periodQuarter, currency, lang }: { card: DiveCard; numbers: DiveNumbers; history: DiveHistory[]; periodQuarter: number; currency: DiveCurrency; lang: Lang }) {
  const bars = [...history.map(h => ({ label: h.label, value: h.value })), { label: `Q${periodQuarter}`, value: numbers.revenue.current }];
  const max = Math.max(...bars.map(b => b.value));
  return <Shell id="change" heading={CARD_HEADINGS.change} card={card} lang={lang}>
    {history.length >= 3 && <figure className={styles.chart}>
      <figcaption>{lang === "ja" ? `売上高の推移(${diveUnit(currency, lang)})` : `Revenue trend (${diveUnit(currency, lang)})`}</figcaption>
      <div className={styles.bars} style={{ gridTemplateColumns: `repeat(${bars.length}, minmax(0, 1fr))` }} role="img"
        aria-label={bars.map(b => `${b.label} ${diveScaled(b.value, currency, lang)}`).join(", ")}>
        {bars.map((b, i) => <div key={i}><i className={i === bars.length - 1 ? styles.gold : styles.blue} style={{ height: `${Math.max(4, b.value / max * 100)}%` }} /><span>{b.label}</span></div>)}
      </div>
    </figure>}
  </Shell>;
}
function Caution({ card, numbers, marginLabel, lang }: { card: DiveCard; numbers: DiveNumbers; marginLabel: Copy; lang: Lang }) {
  const seg = numbers.segments?.find(s => s.key === card.segment);
  const gm = numbers.grossMargin, guide = numbers.guidance?.grossMarginPercent;
  const below = gm && guide != null ? guide < gm.current : null;
  const lower = gm && guide != null ? <div className={styles.lower}>
      <Bar label={lang === "ja" ? `${marginLabel.ja} 今回の実績` : `${marginLabel.en}: this quarter`} value={`${trim(gm.current, 2)}%`} width={gm.current} tone="blue" />
      <Bar label={lang === "ja" ? `${marginLabel.ja} 次期の見通し` : `${marginLabel.en}: next quarter outlook`} value={`${lang === "ja" ? "約" : "~"}${trim(guide, 2)}%`} width={guide} tone={below ? "red" : "gold"} />
      <p className={styles.note}>{lang === "ja" ? `見通しは、今回の実績を${below ? "下回" : "上回"}ります` : `The outlook is ${below ? "below" : "above"} this quarter's result`}</p>
    </div> : null;
  return <Shell id="caution" heading={CARD_HEADINGS.caution} card={card} lang={lang} tail={gm && guide != null ? lower : null}>
    {seg && <><Bar label={lang === "ja" ? "前四半期" : "Previous quarter"} value={`${trim(seg.previousOperatingMargin, 1)}%`} width={seg.previousOperatingMargin} tone="blue" />
      <Bar label={lang === "ja" ? "今四半期" : "This quarter"} value={`${trim(seg.operatingMargin, 1)}%`} width={seg.operatingMargin} tone="red" /></>}
  </Shell>;
}
function Next({ card, numbers, currency, lang }: { card: DiveCard; numbers: DiveNumbers; currency: DiveCurrency; lang: Lang }) {
  const guide = numbers.guidance;
  const cur = numbers.revenue.current;
  const lo = guide ? Math.min(cur, guide.low) * 0.92 : 0, hi = guide ? guide.high * 1.06 : 1;
  // MU's English edges keep one decimal ($60.0); smaller issuers need two ($0.62).
  const edgePlaces = lang === "ja" || (guide && guide.high < 10_000) || currency === "KRW" ? 2 : 1;
  const at = (v: number) => `${Math.max(0, Math.min(100, (v - lo) / (hi - lo) * 100))}%`;
  return <Shell id="next" heading={CARD_HEADINGS.next} card={card} lang={lang}>
    {guide && <figure className={styles.range}>
      <figcaption>{lang === "ja" ? `次期の売上見通し(${diveUnit(currency, lang)})` : `Next quarter revenue outlook (${diveUnit(currency, lang)})`}</figcaption>
      <div className={styles.rangeTrack}>
        <span className={styles.nowLabel} style={{ left: at(cur) }}>{lang === "ja" ? `今期 ${diveScaled(cur, currency, lang)}` : `This qtr ${diveScaled(cur, currency, lang)}`}</span>
        <i className={styles.now} style={{ left: at(cur) }} />
        {guide.low === guide.high
          ? <><i className={styles.span} style={{ left: at(guide.low), width: "1.5%" }} /><span className={styles.edge} style={{ left: at(guide.low) }}>{diveScaled(guide.low, currency, lang, edgePlaces)}</span></>
          : <><i className={styles.span} style={{ left: at(guide.low), width: `${(guide.high - guide.low) / (hi - lo) * 100}%` }} />
            <span className={styles.edge} style={{ left: at(guide.low) }}>{diveScaled(guide.low, currency, lang, edgePlaces)}</span>
            <span className={styles.edge} style={{ left: at(guide.high) }}>{diveScaled(guide.high, currency, lang, edgePlaces)}</span></>}
      </div>
    </figure>}
  </Shell>;
}
function EpsCard({ numbers, currency, lang }: { numbers: DiveNumbers; currency: DiveCurrency; lang: Lang }) {
  // Built only when an analyst estimate was read; a missing estimate means no card, never an empty one.
  if (numbers.epsEstimate == null || numbers.adjustedEPS == null || numbers.epsEstimate <= 0) return null;
  const diff = (numbers.adjustedEPS / numbers.epsEstimate - 1) * 100, beat = diff >= 0, max = Math.max(numbers.epsEstimate, numbers.adjustedEPS) * 1.05;
  return <section className={styles.card} aria-labelledby="dive-eps">
    <p className={styles.cardNo} id="dive-eps">{lang === "ja" ? "EPS　予想との差" : "EPS VS. ESTIMATE"}</p>
    <h3 className={styles.headline}>{lang === "ja" ? `調整後EPSは、予想を${beat ? "上回" : "下回"}りました` : `Adjusted EPS ${beat ? "beat" : "missed"} estimates`}</h3>
    <Bar label={lang === "ja" ? "予想(アナリスト平均)" : "Estimate (analyst average)"} value={divePerShare(numbers.epsEstimate, currency, lang)} width={numbers.epsEstimate / max * 100} tone="blue" />
    <Bar label={lang === "ja" ? "実績" : "Actual"} value={divePerShare(numbers.adjustedEPS, currency, lang)} width={numbers.adjustedEPS / max * 100} tone="gold" />
    <div className={styles.chips}><span className={`${styles.chip} ${beat ? styles.chip_up : styles.chip_down}`}>{lang === "ja" ? `${pctText(diff)} ${beat ? "上回る" : "下回る"}` : `${beat ? "Beat" : "Missed"} by ${Math.abs(diff).toFixed(1)}%`}</span></div>
    <details className={styles.more}><summary>{lang === "ja" ? "EPSとは" : "What is EPS?"}</summary><div className={styles.moreBody}><p>{lang === "ja"
      ? "EPS＝1株あたり利益。調整後の数字です"
      : "EPS = earnings per share (adjusted)."}</p></div></details>
  </section>;
}

const MU_MARGIN: Copy = { ja: "調整後粗利益率", en: "Adj. gross margin" }, MU_EPS: Copy = { ja: "調整後EPS", en: "Adjusted EPS" };
/** What the dive needs from MU's live snapshot (WatchEarnings) or from a reviewed lib/research/dives/<TICKER>.json. */
export type DiveLive = { period: string; releasedOn: string; publicAt?: string | null; dive: Dive | null };
type Props = {
  lang: Lang; name: string; ticker: string; live: DiveLive | null; unlocked: boolean; history?: DiveHistory[]; failed: boolean;
  /** The issuer's currency (amounts in millions of it). MU: USD. */
  currency?: DiveCurrency;
  /** The quarter on the chart's last bar; MU reads it from its "FQ4 2026" label. */
  periodQuarter?: number;
  /** A reviewed file's review date. No longer shown: the green "reflected" pills were removed (owner, 11/26). */
  reviewedOn?: string;
  /** The margin and EPS labels from the file's `basis` (TIFRS, US GAAP, non-GAAP…). MU: 調整後粗利益率 / 調整後EPS. */
  marginLabel?: Copy; epsLabel?: Copy;
};
export default function EarningsDive({ lang, name, ticker, live, unlocked, history = [], failed, currency = "USD", periodQuarter, marginLabel = MU_MARGIN, epsLabel = MU_EPS }: Props) {
  const ja = lang === "ja";
  const dive = live?.dive ?? null, numbers = dive?.numbers ?? null, summary = dive?.summary ?? null;
  const period = /^FQ([1-4]) (20\d{2})$/.exec(live?.period ?? "");
  const lastQuarter = periodQuarter ?? (period ? Number(period[1]) : 4);
  const perShare = (value: number) => divePerShare(value, currency, lang);
  /** "600〜630" (億ドル) / "$60–63B"; under $10B two places ("$0.62–0.65B"). */
  const range = (low: number, high: number) => {
    if (low === high) return ja ? diveScaled(low, currency, lang) : diveMoney(low, currency, lang);
    if (ja) return `${diveScaled(low, currency, lang)}〜${diveScaled(high, currency, lang)}`;
    const places = high >= 10_000 && currency !== "KRW" ? 0 : 2, unit = diveUnit(currency, lang);
    return `${unit.slice(0, -1)}${diveScaled(low, currency, lang, places)}–${diveScaled(high, currency, lang, places)}${unit.slice(-1)}`;
  };
  const header = <header className={styles.top}>
    <div className={styles.titleRow}><h2>{ja ? "決算の深掘り" : "Earnings Deep Dive"}</h2><ProTag /></div>
    {live && <p className={styles.sub}>{name} ({ticker}){ja ? "　" : "  "}{live.period}{ja ? "　" : "  "}{releasedLabel(live.releasedOn, lang)}</p>}
  </header>;
  if (!unlocked) return <section className={styles.dive}>{header}<p className={styles.lock}><Link href="/research/account">{ja ? "ログイン・プランを確認" : "Sign in / View your plan"} →</Link></p></section>;
  if (!numbers) return <section className={styles.dive} aria-busy="true">{header}
    <div className={styles.pills}><span className={`${styles.pill} ${styles.wait}`}><i />{ja ? "準備中" : "Coming soon"}</span><span className={`${styles.pill} ${styles.wait}`}><i />{ja ? "まとめ 確認中" : "Summary checking"}</span></div>
    <p className={styles.checking} role="status">{ja ? "準備中" : "Coming soon"}</p></section>;
  const tiles: { label: string; value: string; unit: string; note: string; tone?: string }[] = [
    { label: ja ? "売上高" : "Revenue", value: ja ? diveScaled(numbers.revenue.current, currency, lang) : diveMoney(numbers.revenue.current, currency, lang), unit: ja ? diveUnit(currency, lang) : "",
      note: ja ? `前期比 ${pctText((numbers.revenue.current / numbers.revenue.previous - 1) * 100)}` : `${pctText((numbers.revenue.current / numbers.revenue.previous - 1) * 100)} QoQ`, tone: numbers.revenue.current >= numbers.revenue.previous ? "up" : "down" },
    ...(numbers.adjustedEPS != null ? [{ label: epsLabel[lang], value: ja ? perShare(numbers.adjustedEPS).replace(/[^\d.,−]+$/, "") : perShare(numbers.adjustedEPS), unit: ja ? perShare(numbers.adjustedEPS).replace(/^[−\d.,]+/, "") : "",
      note: numbers.epsEstimate ? (ja ? `予想比 ${pctText((numbers.adjustedEPS / numbers.epsEstimate - 1) * 100)}` : `${pctText((numbers.adjustedEPS / numbers.epsEstimate - 1) * 100)} vs. est.`) : "", tone: "up" }] : []),
    ...(numbers.guidance ? [{ label: ja ? "次期の見通し" : "Next quarter", value: range(numbers.guidance.low, numbers.guidance.high),
      unit: ja ? `${diveUnit(currency, lang)}(売上)` : "", note: ja ? "会社の予定" : "Company outlook" }] : []),
  ];
  return <section className={styles.dive}>
    {header}
    {/* The green "reflected" pills were a maker's check; members see only the waiting pill (owner, 11/26). */}
    {!summary && <div className={styles.pills} role="status">
      <span className={`${styles.pill} ${styles.wait}`}><i />{dive?.failed ? (ja ? "まとめ 確認中" : "Summary checking") : (ja ? "まとめ 準備中" : "Summary in progress")}</span>
    </div>}
    {summary && <section className={`${styles.card} ${styles.takeaway}`} aria-labelledby="dive-takeaway">
      <p className={styles.cardNo} id="dive-takeaway">{ja ? "結論" : "Takeaway"}</p>
      {summary.conclusion.map((paragraph, i) => <p key={i} className={styles.conclusion}>{paragraph[lang]}</p>)}
      <div className={styles.tiles} style={{ gridTemplateColumns: `repeat(${tiles.length}, minmax(0, 1fr))` }}>{tiles.map(tile => <div key={tile.label}><span>{tile.label}</span><strong>{tile.value}</strong>{tile.unit && <small>{tile.unit}</small>}<em className={tile.tone ? styles[`t_${tile.tone}`] : undefined}>{tile.note}</em></div>)}</div>
    </section>}
    {!summary && <div className={styles.tiles} style={{ gridTemplateColumns: `repeat(${tiles.length}, minmax(0, 1fr))` }}>{tiles.map(tile => <div key={tile.label}><span>{tile.label}</span><strong>{tile.value}</strong>{tile.unit && <small>{tile.unit}</small>}<em>{tile.note}</em></div>)}</div>}
    <EpsCard numbers={numbers} currency={currency} lang={lang} />
    {summary?.cards.growth && <Growth card={summary.cards.growth} numbers={numbers} currency={currency} lang={lang} />}
    {summary?.cards.change && <Change card={summary.cards.change} numbers={numbers} history={history} periodQuarter={lastQuarter} currency={currency} lang={lang} />}
    {summary?.cards.caution && <Caution card={summary.cards.caution} numbers={numbers} marginLabel={marginLabel} lang={lang} />}
    {summary?.cards.next && <Next card={summary.cards.next} numbers={numbers} currency={currency} lang={lang} />}
    {failed && <p className={styles.checking}>{ja ? "更新を完了できていない項目があります。" : "Some updates are incomplete."}</p>}
  </section>;
}
