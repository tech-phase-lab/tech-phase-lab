"use client";
import { useEffect, useRef, useState } from "react";
import s from "./lp.module.css";

const PAGES_JA = [
 { no: "01", title: "私が守りたい投資", head: "コツコツ積み上げ型", rows: [["投資期間", "10年以上"], ["目標", "着実に増やす"]], text: "決まった手順を守るのが得意なタイプです。値下がりしても続けるかどうかを、先に決めておきましょう。" },
 { no: "02", title: "情報に背中を押されたら", head: "自分が動く理由を知る", rows: [["買う日", "毎月同じ日"], ["株価を見る頻度", "週に数回"], ["主な保有", "投信・ETF"]], text: "他人のおすすめを、自分のルールの代わりにしない。" },
 { no: "03", title: "暮らしを相場に預けない", head: "守るお金を先に決める", rows: [["手をつけないお金", "150万円"], ["3年以内に使うお金", "0円"], ["投資に回せるお金", "900万円"], ["今の投資額", "300万円"]], text: "生活費で、追加の投資をしない。" },
 { no: "04", title: "下落した日に開くページ", head: "30%下落を見直しの合図に", rows: [["耐えられる損失", "90万円"]], note: "生活費の3.6か月分", text: "不安な1日だけで、予定の金額や上限を変えない。" },
 { no: "05", title: "迷ったら この一冊に戻る" },
] as const;
type Locale = "ja" | "en";
type BookPage = { no: string; title: string; head?: string; rows?: readonly (readonly [string, string])[]; note?: string; text?: string };
const PAGES_EN = [
 { no: "01", title: "My investing approach", head: "Steady builder", rows: [["Time horizon", "10+ years"], ["Goal", "Steady growth"]], text: "You’re good at following a routine. Decide in advance whether to keep investing when prices fall, so you have a plan to follow." },
 { no: "02", title: "When the news makes you want to act", head: "Know what makes you act", rows: [["When I buy:", "Same day each month"], ["Check prices:", "A few times a week"], ["Main holdings:", "Funds · ETFs"]], text: "Don’t let someone else’s recommendation replace your own rules." },
 { no: "03", title: "Don’t put your livelihood at the mercy of the market", head: "Decide what money to protect first", rows: [["Money to keep untouched", "$10,000"], ["Money needed within 3 years", "$0"], ["Available to invest", "$60,000"], ["Currently invested", "$20,000"]], text: "Never use money you need for living expenses to buy more investments." },
 { no: "04", title: "The page to open on a down day", head: "Use a 30% drop as the cue to review", rows: [["Loss I can tolerate", "$6,000"]], note: "3.6 months of living costs", text: "Don’t change your planned purchase amounts or limits because of one anxious day." },
 { no: "05", title: "When in doubt, come back to this book" },
] as const;

function PageEn({ n, locale = "en" }: { n: number; locale?: Locale }) {
 const list: readonly BookPage[] = locale === "en" ? PAGES_EN : PAGES_JA;
 const page: BookPage | undefined = list[n];
 return <div className={s.pageFace}>
  <p className={s.pageTop}><span>RESOLUTE</span><span>MY RULES</span></p>
  {page ? <div className={s.pageEn}>
   <p className={s.pageTitle}><i>{page.no}</i>{page.title}</p>
   {page.head ? <>
    <b className={s.pageHead}>{page.head}</b>
    <dl className={s.pageRows}>{(page.rows ?? []).map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
    {page.note ? <small className={s.pageNote}>{page.note}</small> : null}
    <p className={s.pageText}>{page.text}</p>
   </> : null}
  </div> : null}
  <p className={s.pageFoot}><span>{locale === "en" ? "A promise to myself" : "自分との約束"}</span><span>{page ? page.no : ""}</span></p>
 </div>;
}

function Page({ n, locale }: { n: number; locale: Locale }) {
 return <PageEn n={n} locale={locale} />;
}

/** The personal edition: closed → cover opens to a spread → pages turn one by one → closes, on a loop.
 * It starts from the cover when it scrolls into view, and stays on the cover when motion is reduced. */
export default function Book({ locale = "ja" }: { locale?: Locale }) {
 const ref = useRef<HTMLDivElement>(null);
 const [playing, setPlaying] = useState(false);
 useEffect(() => {
  const node = ref.current;
  if (!node || typeof IntersectionObserver === "undefined") return;
  const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  if (reduced) return;
  const watcher = new IntersectionObserver(entries => { for (const entry of entries) if (entry.isIntersecting) { setPlaying(true); watcher.disconnect(); } }, { threshold: 0.5 });
  watcher.observe(node);
  return () => watcher.disconnect();
 }, []);
 return <div ref={ref} className={locale === "en" ? `${s.bookStage} ${s.bookEn}` : s.bookStage} aria-hidden="true">
  <div className={`${s.book} ${playing ? s.bookPlay : ""}`}>
   <div className={`${s.leaf} ${s.leafCover}`}>
    <div className={`${s.face} ${s.cover}`}>
     <span className={s.ribbon} />
     <div className={s.coverFrame}>
      <p className={s.coverBrand}>RESOLUTE</p>
      <p className={s.coverSub}>THE PERSONAL EDITION</p>
      <span className={s.diamond}><i>R</i></span>
      <p className={s.coverTitle}>{locale === "en" ? "Rules that hold when markets shake" : "相場に揺れない 私のルール"}</p>
      <p className={s.coverNote}>{locale === "en" ? "Built from your answers, a book to return to" : "自分の答えからつくる 迷った日に立ち戻る一冊"}</p>
     </div>
    </div>
    <div className={`${s.face} ${s.back}`}><Page locale={locale} n={-1} /></div>
   </div>
   <div className={`${s.leaf} ${s.leaf1}`}><div className={`${s.face} ${s.front}`}><Page locale={locale} n={0} /></div><div className={`${s.face} ${s.back}`}><Page locale={locale} n={1} /></div></div>
   <div className={`${s.leaf} ${s.leaf2}`}><div className={`${s.face} ${s.front}`}><Page locale={locale} n={2} /></div><div className={`${s.face} ${s.back}`}><Page locale={locale} n={3} /></div></div>
   <div className={`${s.leaf} ${s.leaf3}`}><div className={`${s.face} ${s.front}`}><Page locale={locale} n={4} /></div><div className={`${s.face} ${s.back}`}><Page locale={locale} n={-1} /></div></div>
   <div className={`${s.leaf} ${s.leafBase}`}><div className={`${s.face} ${s.front}`}><Page locale={locale} n={-1} /></div></div>
  </div>
 </div>;
}
