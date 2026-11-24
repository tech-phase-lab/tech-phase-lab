"use client";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { checkoutUrl, liveApprovalUrl, liveCheckoutRequest, liveOrder, type LiveOrder } from "@/lib/resolute/live-checkout";
import type { CheckoutProps } from "./screen";
import styles from "./styles.module.css";
import { CheckoutLines, resoluteBuyLines, termsHref } from "../../legal/agree-button";
import { ConsentCheck, ConsentError, useConsent } from "../../legal/consent-check";
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
export default function LiveCheckoutScreen({orderId,language:initialLanguage,cancelled,salesEnabled,guest=false,signedIn=false,signIn,accountLabel,renewal=false,navigate=url=>window.location.assign(url)}: CheckoutProps & {salesEnabled:boolean;guest?:boolean;signedIn?:boolean;signIn?:(id:string|null)=>ReactNode;signingUp?:boolean;accountLabel?:string;renewal?:boolean;navigate?:(url:string)=>void}) {
 // No purchase-type choice here (owner, Nov 2026). Renewal by hand (Nov 19) is opened from the account screen's
 // 「通知サービスを更新」 button (?kind=renewal, signed-in members only) and reuses this screen's words.
 // One tick, one press (owner, Nov 24): the tick right above the button that created the order is the consent. Back from
 // PayPal with the payment approved, this screen completes it by itself (no second tick, no second button) and shows a
 // short thank-you. The tick-and-button pairs here are only for creating an order on this screen and for sending an
 // order that was not approved yet to PayPal.
 const [language,setLanguage]=useState(initialLanguage),kind=renewal && !guest ? "renewal" as const : "initial" as const;
 const [order,setOrder]=useState<LiveOrder|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState("");
 const [claimed,setClaimed]=useState(false);
 const [uncertain,setUncertain]=useState(false);
 const generation=useRef(0),mounted=useRef(true),completing=useRef(false);
 // Every purchase button here sits under the consent line (lawyer review, Nov 24).
 const consent=useConsent();
 useEffect(()=>{mounted.current=true;return ()=>{mounted.current=false;};},[]);
 const lock=useRef(false),attempt=useRef<{kind:"initial"|"renewal";language:"ja"|"en";requestKey:string;consentAt:string}|null>(null);
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
  window.history.replaceState(null,"",checkoutUrl(next,id,cancelled,guest,kind==="renewal" && !id));
 }
 async function act(action:"create"|"complete"|"status"|"claim") {
  if(lock.current)return;
  if(["create","complete"].includes(action) && !salesEnabled){setError("PAYMENT_DISABLED");return;}
  const consentAt=action==="create" ? consent.require() : null;
  if(action==="create" && !consentAt)return;
  generation.current++;lock.current=true;setBusy(true);setError("");
  try {
   if(action==="claim" && id) {
    await liveCheckoutRequest("claim",{orderId:id});
    if(mounted.current)setClaimed(true);
   } else if(action==="create") {
    if(guest)await liveCheckoutRequest("session",{},true);
    attempt.current ??= {kind,language,requestKey:crypto.randomUUID(),consentAt:consentAt as string};
    const next=liveOrder(await liveCheckoutRequest("orders",attempt.current,guest));
    if(!mounted.current)return;
    setOrder(next);window.history.replaceState(null,"",checkoutUrl(language,next.orderId,false,guest));
    // Straight on to PayPal: the amount is on PayPal's page, and coming back completes the payment.
    const approval=liveApprovalUrl(next.approvalUrl);
    if(approval && next.state==="created"){navigate(approval);return;}
   } else if(id) {
    // Completing uses the consent ticked when the order was created (kept with the order on the server).
    if(action==="complete"){setUncertain(true);await liveCheckoutRequest("capture",{orderId:id},guest);}
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
   // A definite refusal of the capture leaves nothing in flight: no need to tell the buyer to recheck first.
   if(action==="complete" && Object.hasOwn(errors,code)) setUncertain(false);
   setError(code);
  }
  finally{lock.current=false;if(mounted.current)setBusy(false);}
 }
 // Back from PayPal with the payment approved: complete it once, by itself.
 useEffect(()=>{
  if(!order || order.state!=="created" || order.approved!==true || cancelled || !salesEnabled || completing.current)return;
  completing.current=true;void act("complete");
 });
 function toPaypal(approval:string) {
  if(lock.current || !consent.require())return;
  navigate(approval);
 }
 const paid=order?.state==="paid",held=order && ["held","suspended","revoked"].includes(order.state);
 const approval=liveApprovalUrl(order?.approvalUrl);
 const completingNow=Boolean(order && order.state==="created" && order.approved===true && !error && salesEnabled && !cancelled);
 if(paid && order) return <main className={styles.page}><section className={styles.card}>
  <p className={styles.badge}>RESOLUTE</p><h1>{en?"Thank you":"ご購入ありがとうございます"}</h1>
  <p role="status">{en?"Your payment is complete.":"お支払いが完了しました。"}</p>
  {order.claimRequired && !claimed ? <section>
   <h2>{en?"Connect your purchase":"購入したRESOLUTEを受け取る"}</h2>
   <p>{en?"Sign in or create an account to use RESOLUTE. Your included year starts on the payment date.":"ログインまたはアカウント作成後に、この購入を紐づけます。1年間の対象期間は決済日から始まります。"}</p>
   {signedIn && accountLabel && <p>{accountLabel}</p>}
   {signedIn?<button disabled={busy} onClick={()=>void act("claim")}>{en?"Connect to this account":"このアカウントで受け取る"}</button>:id ? signIn?.(id) : null}
  </section> : <>
   <p>{en?"Open RESOLUTE and start with the 30-question check to build your own rules.":"RESOLUTEを開き、まずは30問の診断で自分だけのルールを作りましょう。"}</p>
   <a className={styles.button} href={`/resolute?lang=${language}`}>{en?"Open RESOLUTE":"RESOLUTEを開く"}</a>
  </>}
  {busy && <p role="status">{en?"Checking…":"確認しています…"}</p>}
  {error && <p role="alert">{errors[error]?.[en?1:0] ?? (en?"We couldn’t confirm the result. Please try again.":"結果を確認できませんでした。もう一度お試しください。")}</p>}
  <p className={styles.orderId}>{en?"Order ID":"注文番号"}: {order.orderId}</p>
 </section></main>;
 return <main className={styles.page}><section className={styles.card}>
  <p className={styles.badge}>RESOLUTE</p><h1>{en?"Checkout":"購入手続き"}</h1>
  <nav className={`${styles.links} ${styles.languages}`} aria-label="Language">
   <button disabled={busy} aria-pressed={!en} onClick={()=>switchLanguage("ja")}>日本語</button>
   <button disabled={busy} aria-pressed={en} onClick={()=>switchLanguage("en")}>English</button>
  </nav>
  {!salesEnabled && <p role="status">{errors.PAYMENT_DISABLED[en?1:0]}</p>}
  {cancelled && <p>{en?"You returned from PayPal. Opening this page does not complete a payment.":"PayPalから戻りました。このページを開いただけで支払いは確定しません。"}</p>}
  {!id && <>
   {kind==="initial" && <p>{en?"Your first purchase includes RESOLUTE and one year of Alerts, Morning Note, Shock Gauge and RIZEL’s Take. Payment is by PayPal (credit card or bank account).":"初回購入にはRESOLUTEと、1年間のアラート通知・翌朝のひとこと・衝撃度チェッカー・RIZELの一言が含まれます。お支払いはPayPal（クレジットカード・銀行口座払い）です。"}</p>}
   {salesEnabled && kind==="initial" && <CheckoutLines lines={resoluteBuyLines(en)} />}
   {salesEnabled && <ConsentCheck en={en} consent={consent} />}
   <button disabled={busy || !salesEnabled} onClick={()=>void act("create")}>{en?"Check price and continue":"価格を確認して進む"}</button>
   <ConsentError en={en} consent={consent} />
  </>}
  {completingNow && <p role="status">{en?"Completing your payment…":"お支払いを確定しています…"}</p>}
  {order && !completingNow && <>
   <dl><dt>{en?"Order":"購入内容"}</dt><dd>{order.quote.kind==="initial"?(en?"First purchase":"初回購入"):(en?"Annual renewal":"1年間の更新")}</dd>
    <dt>{en?"Payment method":"お支払い方法"}</dt><dd>{en?"PayPal (credit card or bank account)":"PayPal（クレジットカード・銀行口座払い）"}</dd>
    <dt>{en?"Amount":"金額"}</dt><dd className={styles.amount}>{new Intl.NumberFormat(en?"en-US":"ja-JP",{style:"currency",currency:order.quote.currency}).format(Number(order.quote.value))} <small>{order.quote.currency}</small></dd>
    <dt>{en?"Order ID":"注文番号"}</dt><dd className={styles.orderId}>{order.orderId}</dd></dl>
   <p>{en?"Changing the display language won’t change this order’s amount or currency.":"表示言語を切り替えても、この注文の金額と通貨は変わりません。"}</p>
   <p role="status">{held?(en?"This order is on hold or access has been suspended. Review is required.":"この注文は保留中、または利用停止中です。記録の確認が必要です。"):
    uncertain || order.state==="capturing"?(en?"Please refresh the payment status before trying again.":"再操作する前に、支払い状況を再確認してください。"):
    (en?"Payment hasn’t been confirmed yet.":"支払い完了はまだ確認されていません。")}</p>
   {!held && !uncertain && order.state==="created" && order.approved!==true && salesEnabled && approval && <div className={styles.actions}>
    <p>{en?"Pay in PayPal; coming back here completes your purchase.":"PayPalでお支払いいただくと、この画面に戻って購入が完了します。"}</p>
    <CheckoutLines lines={resoluteBuyLines(en)} />
    <ConsentCheck en={en} consent={consent} />
    <a className={styles.button} href={approval} rel="noreferrer" onClick={event=>{event.preventDefault();toPaypal(approval);}}>{en?"Continue to PayPal":"PayPalへ進む"}</a>
    <ConsentError en={en} consent={consent} />
   </div>}
  </>}
  {id && !completingNow && <button disabled={busy} onClick={()=>void act("status")}>{en?"Refresh payment status":"支払い状況を再確認する"}</button>}
  {busy && !completingNow && <p role="status">{en?"Checking…":"確認しています…"}</p>}
  {error && <p role="alert">{errors[error]?.[en?1:0] ?? (en?"We couldn’t confirm the result. If you started a payment, refresh its status before creating another order.":"結果を確認できませんでした。支払い操作の後は、新しい注文を作る前に支払い状況を再確認してください。")}</p>}
  <footer className={styles.links}>{!uncertain && (!attempt.current || order) && order?.state!=="capturing" && <a href={checkoutUrl(language)}>{en?"Start a new order":"新しい注文へ"}</a>}<a href={`/resolute?lang=${language}`}>{en?"Back to RESOLUTE":"RESOLUTEへ戻る"}</a><a href={termsHref(en)} target="_blank" rel="noopener">{en?"Terms of Service":"利用規約"}</a><a href={`/commerce${en?"?lang=en":""}`} target="_blank" rel="noopener">{en?"Legal Notice":"特定商取引法"}</a></footer>
 </section></main>;
}
