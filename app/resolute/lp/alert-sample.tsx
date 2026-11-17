"use client";
import { useState } from "react";
import { latestAlertView, type LatestAlert } from "@/lib/resolute/latest-alert";
import { resoluteAlertPushBody } from "@/lib/resolute/push-notice";
import s from "./lp.module.css";

type Locale = "ja" | "en";
/** 届く通知の例 (owner, Nov 17): the phone notification (title RESOLUTE, one line) and, on a tap, the 「今日のお知らせ」 page it opens,
 * worded by the same functions as the real notice and page. Example numbers only. */
const SAMPLE: LatestAlert = { date: "2027-01-14", items: [
  { kind: "line_reached", symbol: "NVDA", close: 118.4, dropPct: 10.2, newLines: [10] },
  { kind: "surge_cap", symbol: "PLTR", close: 96.1, risePct: 41.5 },
] };
export default function AlertSample({ locale = "ja" }: { locale?: Locale }) {
 const [open, setOpen] = useState(false);
 const en = locale === "en";
 const body = resoluteAlertPushBody(SAMPLE.items.map(i => ({ ...i, date: SAMPLE.date, referencePrice: 0 })), locale);
 const v = latestAlertView(SAMPLE, locale);
 return <div className={s.alert}>
  <button type="button" className={s.push} aria-expanded={open} aria-controls="lp-alert-mail" onClick={() => setOpen(true)} hidden={open}>
   <span className={s.pushHead}><b>RESOLUTE</b><time>{en ? "5:00 PM" : "7:00"}</time></span>
   <span className={s.pushTitle}>{body}</span>
   <small className={s.tap}>{en ? "Tap to open Today's alert" : "タップして「今日のお知らせ」を開く"}</small>
  </button>
  {open && <div id="lp-alert-mail" className={s.mail}>
   <p className={s.mailTitle}>{v.title}</p>
   <p>{v.date}</p>
   {v.notes.map(note => <p key={note}>{note}</p>)}
   <ul>{v.cards.map(card => <li key={card.symbol}><b>{card.symbol}</b> {card.text}<br />{card.chip}</li>)}</ul>
   <p>{v.check}</p>
   <p>{v.disclaimer}</p>
   <button type="button" className={s.mailClose} onClick={() => setOpen(false)}>{en ? "Close" : "閉じる"}</button>
  </div>}
 </div>;
}
