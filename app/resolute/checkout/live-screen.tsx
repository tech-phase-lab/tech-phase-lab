"use client";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { checkoutUrl, liveApprovalUrl, liveCheckoutRequest, liveOrder, type LiveOrder } from "@/lib/resolute/live-checkout";
import type { CheckoutProps } from "./screen";
import styles from "./styles.module.css";
import AgreeButton, { CheckoutLines, RESOLUTE_CHECKOUT_LINES, termsHref } from "../../legal/agree-button";
import Disclaimer from "../disclaimer";
const errors: Record<string,[string,string]> = {
 GUEST_SESSION_REQUIRED:["購入時と同じブラウザで開いてください。解決しない場合は注文番号を添えてお問い合わせください。","Open this page in the browser you used to purchase. If you still need help, contact support with your order number."],
 PAYMENT_DISABLED:["現在、購入の受付を停止しています。","Checkout is currently closed."],
 ALREADY_PURCHASED:["RESOLUTEは購入済みです。","You’ve already purchased RESOLUTE."],
 INITIAL_PURCHASE_REQUIRED:["更新するには、初回購入が必要です。","Purchase RESOLUTE before renewing your alerts."],
 PRICE_CHANGED:["価格または会員資格が変わりました。新しい注文で金額を確認してください。","Your price or membership has changed. Check the price with a new order."],
 ORDER_EXPIRED:["注文の有効期限が切れました。新しい注文を作成してください。","This order has expired. Please start a new order."],
 PAYMENT_NOT_APPROVED:["PayPalでの承認が確認できません。","PayPal hasn’t confirmed your approval yet."],
 ORDER_NOT_FOUND:["このアカウントの注文を確認できません。","We couldn’t find this order for your account."],
};
export default function LiveCheckoutScreen({orderId,language:initialLanguage,cancelled,salesEnabled,guest=false,signedIn=false,signIn,accountLabel}: CheckoutProps & {salesEnabled:boolean;guest?:boolean;signedIn?:boolean;signIn?:(id:string|null)=>ReactNode;signingUp?:boolean;accountLabel?:string}) {
 // First purchase only (owner, Nov 2026): renewal moves to the account screen later, so there is no purchase-type choice here.
 const [language,setLanguage]=useState(initialLanguage),kind="initial" as const;
 const [order,setOrder]=useState<LiveOrder|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState("");
 const [claimed,setClaimed]=useState(false);
 const [uncertain,setUncertain]=useState(false);
 const generation=useRef(0),mounted=useRef(true);
 useEffect(()=>{mounted.current=true;return ()=>{mounted.current=false;};},[]);
 const lock=useRef(false),attempt=useRef<{kind:"initial"|"renewal";language:"ja"|"en";requestKey:string}|null>(null);
 const en=language === "en", id=order?.orderId ?? orderId;
 useEffect(()=>{
  if (!orderId) return;
  let active=true;const version=++generation.current;
  liveCheckoutRequest(`orders/${orderId}`,undefined,guest).then(data=>{const next=liveOrder(data);if(active && version===generation.current)setOrder(next);})
   .catch(e=>{if(active && version===generation.current)setError(e instanceof Error ? e.message : "PAYMENT_UNAVAILABLE");});
  return ()=>{active=false;};
 },[orderId,guest]);
 function switchLanguage(next:"ja"|"en") {
  if(lock.current)return;
  setLanguage(next);
  window.history.replaceState(null,"",checkoutUrl(next,id,cancelled,guest));
 }
 async function act(action:"create"|"capture"|"status"|"claim") {
  if(lock.current)return;
  if(["create","capture"].includes(action) && !salesEnabled){setError("PAYMENT_DISABLED");return;}
  generation.current++;lock.current=true;setBusy(true);setError("");
  try {
   if(action==="claim" && id) {
    await liveCheckoutRequest("claim",{orderId:id});
    if(mounted.current)setClaimed(true);
   } else if(action==="create") {
    if(guest)await liveCheckoutRequest("session",{},true);
    attempt.current ??= {kind,language,requestKey:crypto.randomUUID()};
    const next=liveOrder(await liveCheckoutRequest("orders",attempt.current,guest));
    if(!mounted.current)return;
    setOrder(next);window.history.replaceState(null,"",checkoutUrl(language,next.orderId,false,guest));
   } else if(id) {
    if(action==="capture"){setUncertain(true);await liveCheckoutRequest("capture",{orderId:id},guest);}
    if(!mounted.current)return;
    const next=liveOrder(await liveCheckoutRequest(`orders/${id}`,undefined,guest));
    if(!mounted.current)return;
    setOrder(next);setUncertain(false);
   }
  } catch(e){
   if(!mounted.current)return;
   const code=e instanceof Error ? e.message : "PAYMENT_UNAVAILABLE";
   // These failures happen before an order is created. Unknown failures keep the same request key.
   if(action==="create" && ["ALREADY_PURCHASED","INITIAL_PURCHASE_REQUIRED","VERIFIED_ACCOUNT_REQUIRED","AUTH_REQUIRED"].includes(code)) attempt.current=null;
   setError(code);
  }
  finally{lock.current=false;if(mounted.current)setBusy(false);}
 }
 const paid=order?.state==="paid",held=order && ["held","suspended","revoked"].includes(order.state);
 const approval=liveApprovalUrl(order?.approvalUrl);
 return <main className={styles.page}><section className={styles.card}>
  <p className={styles.badge}>RESOLUTE</p><h1>{en?"Checkout":"購入手続き"}</h1>
  <nav className={`${styles.links} ${styles.languages}`} aria-label="Language">
   <button disabled={busy} aria-pressed={!en} onClick={()=>switchLanguage("ja")}>日本語</button>
   <button disabled={busy} aria-pressed={en} onClick={()=>switchLanguage("en")}>English</button>
  </nav>
  {!salesEnabled && <p role="status">{errors.PAYMENT_DISABLED[en?1:0]}</p>}
  {cancelled && <p>{en?"You returned from PayPal. Opening this page does not complete a payment.":"PayPalから戻りました。このページを開いただけで支払いは確定しません。"}</p>}
  {!id && <>
   <p>{en?"Your first purchase includes RESOLUTE and one year of Alerts, Morning Note, Shock Gauge and RIZEL’s Take. Payment is by PayPal (credit card or bank account).":"初回購入にはRESOLUTEと、1年間のアラート通知・翌朝のひとこと・衝撃度チェッカー・RIZELの一言が含まれます。お支払いはPayPal（クレジットカード・銀行口座払い）です。"}</p>
   <button disabled={busy || !salesEnabled} onClick={()=>void act("create")}>{en?"Check price and continue":"価格を確認して進む"}</button>
  </>}
  {order && <>
   <dl><dt>{en?"Order":"購入内容"}</dt><dd>{order.quote.kind==="initial"?(en?"First purchase":"初回購入"):(en?"Annual renewal":"1年間の更新")}</dd>
    <dt>{en?"Payment method":"お支払い方法"}</dt><dd>{en?"PayPal (credit card or bank account)":"PayPal（クレジットカード・銀行口座払い）"}</dd>
    <dt>{en?"Amount":"金額"}</dt><dd className={styles.amount}>{new Intl.NumberFormat(en?"en-US":"ja-JP",{style:"currency",currency:order.quote.currency}).format(Number(order.quote.value))} <small>{order.quote.currency}</small></dd>
    <dt>{en?"Order ID":"注文番号"}</dt><dd className={styles.orderId}>{order.orderId}</dd></dl>
   <p>{en?"Changing the display language won’t change this order’s amount or currency.":"表示言語を切り替えても、この注文の金額と通貨は変わりません。"}</p>
   <p role="status">{paid?(en?"Payment verified.":"支払いを確認しました。"):
    held?(en?"This order is on hold or access has been suspended. Review is required.":"この注文は保留中、または利用停止中です。記録の確認が必要です。"):
    uncertain || order.state==="capturing"?(en?"Please refresh the payment status before trying again.":"再操作する前に、支払い状況を再確認してください。"):
    (en?"Payment hasn’t been confirmed yet.":"支払い完了はまだ確認されていません。")}</p>
   {!paid && !held && !uncertain && order.state==="created" && salesEnabled && <div className={styles.actions}>
    {approval && <a className={styles.button} href={approval} rel="noreferrer">{en?"Continue to PayPal":"PayPalへ進む"}</a>}
    <p>{en?"After approving in PayPal, return here to complete your payment.":"PayPalで承認した後、この画面で支払いを確定します。"}</p>
    <CheckoutLines lines={RESOLUTE_CHECKOUT_LINES[en?"en":"ja"]} />
    <AgreeButton en={en} disabled={busy} onClick={()=>void act("capture")} />
   </div>}
  </>}
  {paid && order?.claimRequired && !claimed && <section>
   <h2>{en?"Connect your purchase":"購入したRESOLUTEを受け取る"}</h2>
   <p>{en?"Sign in or create an account to use RESOLUTE. Your included year starts on the payment date.":"ログインまたはアカウント作成後に、この購入を紐づけます。1年間の対象期間は決済日から始まります。"}</p>
   {signedIn && accountLabel && <p>{accountLabel}</p>}
   {signedIn?<button disabled={busy} onClick={()=>void act("claim")}>{en?"Connect to this account":"このアカウントで受け取る"}</button>:id ? signIn?.(id) : null}
  </section>}
  {paid && (claimed || !order?.claimRequired) && <a className={styles.button} href={`/resolute?lang=${language}`}>{en?"Open RESOLUTE":"RESOLUTEを開く"}</a>}
  {id && <button disabled={busy} onClick={()=>void act("status")}>{en?"Refresh payment status":"支払い状況を再確認する"}</button>}
  {busy && <p role="status">{en?"Checking…":"確認しています…"}</p>}
  {error && <p role="alert">{errors[error]?.[en?1:0] ?? (en?"We couldn’t confirm the result. If you started a payment, refresh its status before creating another order.":"結果を確認できませんでした。支払い操作の後は、新しい注文を作る前に支払い状況を再確認してください。")}</p>}
  <footer className={styles.links}>{!uncertain && (!attempt.current || order) && order?.state!=="capturing" && <a href={checkoutUrl(language)}>{en?"Start a new order":"新しい注文へ"}</a>}<a href={`/resolute?lang=${language}`}>{en?"Back to RESOLUTE":"RESOLUTEへ戻る"}</a><a href={termsHref(en)} target="_blank" rel="noopener">{en?"Terms of Service":"利用規約"}</a><a href={`/resolute/legal/commerce${en?"?lang=en":""}`} target="_blank" rel="noopener">{en?"Legal Notice":"特定商取引法に基づく表記"}</a></footer>
  <Disclaimer en={en} />
 </section></main>;
}
