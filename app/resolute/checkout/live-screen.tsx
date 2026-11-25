"use client";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { checkoutUrl, liveApprovalUrl, liveCheckoutRequest, liveOrder, type LiveOrder } from "@/lib/resolute/live-checkout";
import type { CheckoutProps } from "./screen";
import styles from "./styles.module.css";
import { CheckoutLines, resoluteBuyLines, termsHref } from "../../legal/agree-button";
import { ConsentCheck, ConsentError, useConsent } from "../../legal/consent-check";
import { resolutePrice } from "@/lib/resolute/price";
import PurchaseBar from "./purchase-bar";
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
export default function LiveCheckoutScreen({orderId,language:initialLanguage,cancelled,salesEnabled,guest=false,signedIn=false,signIn,signingUp=false,accountLabel,renewal=false,navigate=url=>window.location.assign(url)}: CheckoutProps & {salesEnabled:boolean;guest?:boolean;signedIn?:boolean;signIn?:(id:string|null)=>ReactNode;signingUp?:boolean;accountLabel?:string;renewal?:boolean;navigate?:(url:string)=>void}) {
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
 const bar=<PurchaseBar language={language} onLanguage={switchLanguage} disabled={busy}/>;
 // Guest receipt (owner, Nov 25): sign in on the left, or create an account on the right. The account form shows in one of
 // the two at a time (Clerk keeps one form per page); the other offers the way to switch, with the same addresses as before.
 const receiveTarget=id ? checkoutUrl(language,id,false,true) : "";
 if(paid && order) return <main className={styles.shell} lang={language}>{bar}
  <section className={styles.done}>
   <span className={styles.checkmark} aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M6 12.5l4 4 8-9"/></svg></span>
   <h1>{en?"Thank you":"ご購入ありがとうございます"}</h1>
   <p role="status" className={styles.lead}>{en?"Your payment is complete.":"お支払いが完了しました。"}</p>
   {order.claimRequired && !claimed ? <section className={styles.receive} aria-labelledby="receive-heading">
    <h2 id="receive-heading">{en?"Connect your purchase":"購入したRESOLUTEを受け取る"}</h2>
    <div className={styles.pair}>
     <div className={styles.panel}>
      <h3>{en?"Sign in to receive":"ログインして受け取る"}</h3>
      <p className={styles.small}>{en?"Sign in or create an account to use RESOLUTE. Your included year starts on the payment date.":"ログインまたはアカウント作成後に、この購入を紐づけます。1年間の対象期間は決済日から始まります。"}</p>
      {signedIn && accountLabel && <p className={styles.field}>{accountLabel}</p>}
      {signedIn?<button className={styles.pay} disabled={busy} onClick={()=>void act("claim")}>{en?"Connect to this account":"このアカウントで受け取る"}</button>
       :signingUp?<a className={styles.ghost} href={receiveTarget}>{en?"Sign in to receive":"ログインして受け取る"}</a>:id ? signIn?.(id) : null}
     </div>
     {!signedIn && <div className={styles.panel}>
      <h3>{en?"Don’t have an account?":"アカウントをお持ちでない方"}</h3>
      {signingUp?(id ? signIn?.(id) : null):<a className={styles.ghost} href={`${receiveTarget}&signup=1`}>{en?"Create an account and receive":"アカウントを作って受け取る"}</a>}
     </div>}
    </div>
   </section> : <>
    <p className={styles.lead}>{en?"Open RESOLUTE and start with the 30-question check to build your own rules.":"RESOLUTEを開き、まずは30問の診断で自分だけのルールを作りましょう。"}</p>
    <ol className={styles.steps}>{(en?NEXT_EN:NEXT_JA).map(([title,text],i)=><li key={title}><i>{`0${i+1}`}</i><b>{title}</b><span>{text}</span></li>)}</ol>
    <a className={styles.button} href={`/resolute?lang=${language}`}>{en?"Open RESOLUTE":"RESOLUTEを開く"}</a>
   </>}
   {busy && <p role="status">{en?"Checking…":"確認しています…"}</p>}
   {error && <p role="alert" className={styles.reason}>{errors[error]?.[en?1:0] ?? (en?"We couldn’t confirm the result. Please try again.":"結果を確認できませんでした。もう一度お試しください。")}</p>}
   <p className={styles.orderNo}>{en?"Order ID":"注文番号"}: {order.orderId}</p>
  </section>
 </main>;
 return <main className={styles.shell} lang={language}>{bar}
  <div className={styles.wrap}>
  <h1 className={styles.title}>{kind==="renewal"?(en?"Renew RESOLUTE":"RESOLUTEを更新する"):(en?"Checkout":"購入手続き")}</h1>
  <div className={`${styles.pair} ${styles.checkout}`}>
  <section className={styles.panel} aria-label={en?"Order":"注文内容"}>
   <p className={styles.kicker}>ORDER</p>
   <div className={styles.product}><span className={styles.cover} aria-hidden="true"><svg viewBox="0 0 48 48"><circle cx="24" cy="9" r="4"/><path d="M24 13v28M17 19h14M9 31c0 7 7 11 15 11s15-4 15-11"/></svg></span>
    <p><b>RESOLUTE</b><span>{en?"Crash-ready kit · 1 year":"暴落対策キット・1年間"}</span></p></div>
   <ul className={styles.features}>{(en?FEATURES_EN:FEATURES_JA).map(line=><li key={line}>{line}</li>)}</ul>
   {!guest && accountLabel && <p className={styles.account}><span>{en?"Signed in":"ログイン中"}</span><b>{accountLabel}</b></p>}
  </section>
  <section className={styles.panel} aria-label={en?"Payment":"お支払い"}>
  <p className={styles.kicker}>PAYMENT</p>
  {!salesEnabled && <p role="status" className={styles.reason}>{errors.PAYMENT_DISABLED[en?1:0]}</p>}
  {cancelled && <p className={styles.reason}>{en?"You returned from PayPal. Opening this page does not complete a payment.":"PayPalから戻りました。このページを開いただけで支払いは確定しません。"}</p>}
  {error && <p role="alert" className={styles.reason}>{errors[error]?.[en?1:0] ?? (en?"We couldn’t confirm the result. If you started a payment, refresh its status before creating another order.":"結果を確認できませんでした。支払い操作の後は、新しい注文を作る前に支払い状況を再確認してください。")}</p>}
  {!id && <>
   {kind==="initial" && <LaunchPrice en={en} />}
   {salesEnabled && <PaymentRows en={en} initial={kind==="initial"} />}
   {salesEnabled && <ConsentCheck en={en} consent={consent} />}
   <button className={styles.pay} disabled={busy || !salesEnabled} onClick={()=>void act("create")}>{en?"Check price and continue":"価格を確認して進む"}</button>
   {salesEnabled && <p className={styles.note}>{en?"You’ll go to PayPal. After paying, you’ll come back here.":"PayPalの画面に移ります。お支払い後、この画面に戻ります。"}</p>}
   <ConsentError en={en} consent={consent} />
  </>}
  {completingNow && <p role="status">{en?"Completing your payment…":"お支払いを確定しています…"}</p>}
  {order && !completingNow && <>
   <dl className={styles.orderRows}><dt>{en?"Order":"購入内容"}</dt><dd>{order.quote.kind==="initial"?(en?"First purchase":"初回購入"):(en?"Annual renewal":"1年間の更新")}</dd>
    <dt>{en?"Payment method":"お支払い方法"}</dt><dd>{en?"PayPal (credit card or bank account)":"PayPal（クレジットカード・銀行口座払い）"}</dd>
    <dt>{en?"Amount":"金額"}</dt><dd className={styles.amount}>{new Intl.NumberFormat(en?"en-US":"ja-JP",{style:"currency",currency:order.quote.currency}).format(Number(order.quote.value))} <small>{order.quote.currency}</small></dd>
    <dt>{en?"Order ID":"注文番号"}</dt><dd className={styles.orderId}>{order.orderId}</dd></dl>
   <p className={styles.small}>{en?"Changing the display language won’t change this order’s amount or currency.":"表示言語を切り替えても、この注文の金額と通貨は変わりません。"}</p>
   <p role="status" className={styles.small}>{held?(en?"This order is on hold or access has been suspended. Review is required.":"この注文は保留中、または利用停止中です。記録の確認が必要です。"):
    uncertain || order.state==="capturing"?(en?"Please refresh the payment status before trying again.":"再操作する前に、支払い状況を再確認してください。"):
    (en?"Payment hasn’t been confirmed yet.":"支払い完了はまだ確認されていません。")}</p>
   {!held && !uncertain && order.state==="created" && order.approved!==true && salesEnabled && approval && <div className={styles.actions}>
    <p className={styles.small}>{en?"Pay in PayPal; coming back here completes your purchase.":"PayPalでお支払いいただくと、この画面に戻って購入が完了します。"}</p>
    <CheckoutLines lines={resoluteBuyLines(en)} />
    <ConsentCheck en={en} consent={consent} />
    <a className={styles.button} href={approval} rel="noreferrer" onClick={event=>{event.preventDefault();toPaypal(approval);}}>{en?"Continue to PayPal":"PayPalへ進む"}</a>
    <ConsentError en={en} consent={consent} />
   </div>}
  </>}
  {id && !completingNow && <button className={styles.ghost} disabled={busy} onClick={()=>void act("status")}>{en?"Refresh payment status":"支払い状況を再確認する"}</button>}
  {busy && !completingNow && <p role="status" className={styles.small}>{en?"Checking…":"確認しています…"}</p>}
  </section>
  </div>
  <footer className={styles.foot}>{!uncertain && (!attempt.current || order) && order?.state!=="capturing" && <a href={checkoutUrl(language)}>{en?"Start a new order":"新しい注文へ"}</a>}<a href={`/resolute?lang=${language}`}>{en?"Back to RESOLUTE":"RESOLUTEへ戻る"}</a><a href={termsHref(en)} target="_blank" rel="noopener">{en?"Terms of Service":"利用規約"}</a><a href={`/commerce${en?"?lang=en":""}`} target="_blank" rel="noopener">{en?"Legal Notice":"特定商取引法"}</a></footer>
  </div>
 </main>;
}
// The ORDER panel (owner, Nov 25): what the purchase includes, in four lines.
const FEATURES_JA=["投資ルール診断とマイルール","終値アラート・翌朝のひとこと","相場の温度計・衝撃度チェッカー","リゼルの一言・今夜のひと息"];
const FEATURES_EN=["Rules quiz and My rulebook","Closing-price alerts · Morning note","Market gauge · Shock Gauge","A word from RIZEL · A moment to breathe"];
// After paying (owner, Nov 25): the next three things to do.
const NEXT_JA:[string,string][]=[["ルール診断","30問に答える・約5分"],["終値アラート","見る銘柄とラインを決める"],["ルールのお守り","ロック画面の壁紙にする"]];
const NEXT_EN:[string,string][]=[["Rules quiz","30 questions · about 5 min"],["Closing-price alerts","Choose stocks and set your lines"],["Rules wallpaper","Set it as your lock screen"]];
/** The first-purchase price, as on the LP (switches by itself at 2027-03-01 00:00 JST). The server decides the amount. */
function LaunchPrice({en}:{en:boolean}) {
 const price=resolutePrice(en?"en":"ja");
 return <div className={styles.price}>
  {price.launch && <p className={styles.launch}>{en?"Launch price · Through Feb 28, 2027":"発売記念価格 ・ 2027年2月末まで"}</p>}
  <p className={styles.priceLine}>{price.launch && <del>{en?"$69":"¥9,800"}</del>}<b>{en?(price.launch?"$59":"$69"):(price.launch?"¥7,980":"¥9,800")}</b>{!en && <small>税込</small>}</p>
 </div>;
}
/** The lawyer-reviewed lines (Nov 24), word for word, arranged as rows (owner, Nov 25): the auto-renewal line's two sentences
 * under 「自動更新」 and 「止め方」, the payment method, then the refund line. A renewal shows the payment method only (as before,
 * the renewal screen has no auto-renewal or refund line). */
function PaymentRows({en,initial}:{en:boolean;initial:boolean}) {
 const [renew,refund]=resoluteBuyLines(en),parts=renew.split(/(?<=。)|(?<=\.) /);
 const rows:[string,string][]=[];
 if(initial) rows.push(...(parts.length===2?[[en?"Auto-renewal":"自動更新",parts[0]],[en?"How to stop":"止め方",parts[1]]] as [string,string][]:[[en?"Auto-renewal":"自動更新",renew] as [string,string]]));
 rows.push([en?"Payment":"お支払い",en?"PayPal (credit card or bank account)":"PayPal（クレジットカード・銀行口座払い）"]);
 return <>
  <dl className={styles.rows} data-buy-lines="">{rows.map(([label,value])=><div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
  {initial && <p className={styles.refund}>{refund}</p>}
 </>;
}
