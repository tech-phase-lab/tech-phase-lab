"use client";
import { useEffect, useRef, useState } from "react";
import s from "./lp.module.css";

const PAGES = [
 ["01", "私が守りたい投資"],
 ["02", "情報に背中を押されたら"],
 ["03", "暮らしを相場に預けない"],
 ["04", "下落した日に開くページ"],
 ["05", "迷ったら この一冊に戻る"],
] as const;

function Page({ n }: { n: number }) {
 const page = PAGES[n];
 return <div className={s.pageFace}>
  <p className={s.pageTop}><span>RESOLUTE</span><span>MY RULES</span></p>
  {page ? <p className={s.pageTitle}><i>{page[0]}</i>{page[1]}</p> : null}
  <p className={s.pageFoot}><span>自分との約束</span><span>{page ? page[0] : ""}</span></p>
 </div>;
}

/** The personal edition: closed → cover opens to a spread → pages turn one by one → closes, on a loop.
 * It starts from the cover when it scrolls into view, and stays on the cover when motion is reduced. */
export default function Book() {
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
 return <div ref={ref} className={s.bookStage} aria-hidden="true">
  <div className={`${s.book} ${playing ? s.bookPlay : ""}`}>
   <div className={`${s.leaf} ${s.leafCover}`}>
    <div className={`${s.face} ${s.cover}`}>
     <span className={s.ribbon} />
     <div className={s.coverFrame}>
      <p className={s.coverBrand}>RESOLUTE</p>
      <p className={s.coverSub}>THE PERSONAL EDITION</p>
      <span className={s.diamond}><i>R</i></span>
      <p className={s.coverTitle}>相場に揺れない 私のルール</p>
      <p className={s.coverNote}>自分の答えからつくる 迷った日に立ち戻る一冊</p>
     </div>
    </div>
    <div className={`${s.face} ${s.back}`}><Page n={-1} /></div>
   </div>
   <div className={`${s.leaf} ${s.leaf1}`}><div className={`${s.face} ${s.front}`}><Page n={0} /></div><div className={`${s.face} ${s.back}`}><Page n={1} /></div></div>
   <div className={`${s.leaf} ${s.leaf2}`}><div className={`${s.face} ${s.front}`}><Page n={2} /></div><div className={`${s.face} ${s.back}`}><Page n={3} /></div></div>
   <div className={`${s.leaf} ${s.leaf3}`}><div className={`${s.face} ${s.front}`}><Page n={4} /></div><div className={`${s.face} ${s.back}`}><Page n={-1} /></div></div>
   <div className={`${s.leaf} ${s.leafBase}`}><div className={`${s.face} ${s.front}`}><Page n={-1} /></div></div>
  </div>
 </div>;
}
