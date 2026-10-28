"use client";
import { useState } from "react";
import s from "./lp.module.css";

type Locale = "ja" | "en";
/** A phone notification; tapping it opens the sample mail it stands for. */
export default function AlertSample({ locale = "ja" }: { locale?: Locale }) {
 const [open, setOpen] = useState(false);
 const en = locale === "en";
 return <div className={s.alert}>
  <button type="button" className={s.push} aria-expanded={open} aria-controls="lp-alert-mail" onClick={() => setOpen(true)} hidden={open}>
   <span className={s.pushHead}><b>{en ? "RESOLUTE · Closing-price alert" : "RESOLUTE ・ 終値アラート"}</b><time>7:00</time></span>
   <span className={s.pushTitle}>{en ? "Your price alerts were triggered" : "計画のラインに届いた銘柄があります"}</span>
   <span className={s.pushBody}>{en ? "NVDA −10.2% · PLTR +41.5%" : "NVDA −10.2% ・ PLTR +41.5%"}</span>
   <small className={s.tap}>{en ? "Tap to see details" : "タップして詳細を見る"}</small>
  </button>
  {open && (en ? <div id="lp-alert-mail" className={s.mail}>
   <p className={s.mailTitle}>[RESOLUTE] Your downside and upside alerts were triggered</p>
   <p>We checked January 14 closing prices in the U.S. market against your alert levels.</p>
   <ul>
    <li>NVDA closed at $118.40 (10.2% below your reference price)<br />Downside alert triggered: −10%</li>
    <li>PLTR closed at $96.10 (41.5% above your reference price)<br />Your upside alert level was reached</li>
   </ul>
   <p>A downside alert is your cue to pause and reread your rules. An upside alert is your cue to check whether one holding now makes up too much of your portfolio.</p>
   <button type="button" className={s.mailClose} onClick={() => setOpen(false)}>Close</button>
  </div> : <div id="lp-alert-mail" className={s.mail}>
   <p className={s.mailTitle}>【RESOLUTE】あなたの計画のラインと上昇の目安に届いた銘柄があります</p>
   <p>1月14日(米国市場)の終値を、あなたの計画と照らしました。</p>
   <ul>
    <li><b>NVDA</b> 終値 $118.40(基準から −10.2%)<br />新しく届いたライン −10%</li>
    <li><b>PLTR</b> 終値 $96.10(基準から +41.5%)<br />決めておいた上昇の目安に届きました</li>
   </ul>
   <p>下落のラインは立ち止まってルールを見直す合図。上昇の目安は持ち分の偏りを確かめる合図です。</p>
   <button type="button" className={s.mailClose} onClick={() => setOpen(false)}>閉じる</button>
  </div>)}
 </div>;
}
