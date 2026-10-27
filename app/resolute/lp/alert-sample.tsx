"use client";
import { useState } from "react";
import s from "./lp.module.css";

/** A phone notification; tapping it opens the sample mail it stands for. */
export default function AlertSample() {
 const [open, setOpen] = useState(false);
 return <div className={s.alert}>
  <button type="button" className={s.push} aria-expanded={open} aria-controls="lp-alert-mail" onClick={() => setOpen(true)} hidden={open}>
   <span className={s.pushHead}><b>RESOLUTE ・ 終値アラート</b><time>7:00</time></span>
   <span className={s.pushTitle}>計画のラインに届いた銘柄があります</span>
   <span className={s.pushBody}>NVDA −10.2% ・ PLTR +41.5%</span>
   <small className={s.tap}>タップして詳細を見る</small>
  </button>
  {open && <div id="lp-alert-mail" className={s.mail}>
   <p className={s.mailTitle}>【RESOLUTE】あなたの計画のラインと上昇の目安に届いた銘柄があります</p>
   <p>1月14日(米国市場)の終値を、あなたの計画と照らしました。</p>
   <ul>
    <li><b>NVDA</b> 終値 $118.40(基準から −10.2%)<br />新しく届いたライン −10%</li>
    <li><b>PLTR</b> 終値 $96.10(基準から +41.5%)<br />決めておいた上昇の目安に届きました</li>
   </ul>
   <p>下落のラインは立ち止まってルールを見直す合図。上昇の目安は持ち分の偏りを確かめる合図です。</p>
   <button type="button" className={s.mailClose} onClick={() => setOpen(false)}>閉じる</button>
  </div>}
 </div>;
}
