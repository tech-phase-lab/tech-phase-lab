"use client";
import { useEffect, useRef, useState } from "react";
import styles from "./styles.module.css";
export type CheckoutProps = { orderId: string | null; language: "ja" | "en"; cancelled: boolean };
type Order = { orderId: string; state: string; sandbox: true; expiresAt: string; approvalUrl?: string | null;
 quote: { kind: "initial" | "renewal"; language: "ja" | "en"; currency: "JPY" | "USD"; value: string; priceClass: string } };
const messages: Record<string, [string, string]> = {
 PAYMENT_DISABLED: ["テスト購入の受付はまだ有効になっていません。", "Test checkout hasn’t been enabled yet."],
 ALREADY_PURCHASED: ["初回購入は確認済みです。更新を選んでください。", "You’ve already made your first purchase. Choose annual renewal."],
 INITIAL_PURCHASE_REQUIRED: ["更新するには、先に初回のテスト購入が必要です。", "Make your first test purchase before renewing."],
 PRICE_CHANGED: ["価格または会員資格が変わりました。新しい注文でやり直してください。", "Your price or membership has changed. Start a new order."],
 ORDER_EXPIRED: ["注文の有効期限が切れました。新しい注文を作成してください。", "This order has expired. Start a new order."],
 PAYMENT_NOT_APPROVED: ["PayPalでの承認が確認できません。", "PayPal hasn’t confirmed your approval yet."],
 ORDER_NOT_FOUND: ["このアカウントの注文を確認できません。", "We couldn’t find this order for your account."],
};
async function request(path: string, body?: object) {
 const response = await fetch(`/api/resolute/payments/${path}`, { method: body ? "POST" : "GET", cache: "no-store",
  credentials: "same-origin", signal: AbortSignal.timeout(25000),
  ...(body ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {}) });
 const data = await response.json();
 if (!response.ok) throw Error(typeof data.error === "string" ? data.error : "PAYMENT_UNAVAILABLE");
 if (data.sandbox !== true) throw Error("PAYMENT_UNAVAILABLE");
 return data;
}
export default function CheckoutScreen({ orderId, language, cancelled }: CheckoutProps) {
 const en = language === "en";
 const [kind, setKind] = useState<"initial" | "renewal">("initial");
 const [order, setOrder] = useState<Order | null>(null);
 const [busy, setBusy] = useState(false);
 const [error, setError] = useState("");
 const [uncertain, setUncertain] = useState(false);
 const requestKey = useRef<string | null>(null);
 const lock = useRef(false);
 function failure(e: unknown) { setError(e instanceof Error ? e.message : "PAYMENT_UNAVAILABLE"); }
 useEffect(() => {
  if (!orderId) return;
  let active = true;
  request(`orders/${orderId}`).then(data => { if (active) setOrder(data); }).catch(e => { if (active) failure(e); });
  return () => { active = false; };
 }, [orderId]);
 async function act(action: "create" | "capture" | "status") {
  if (lock.current) return;
  lock.current = true; setBusy(true); setError("");
  try {
   if (action === "create") {
    requestKey.current ??= crypto.randomUUID();
    const data: Order = await request("orders", { kind, language, requestKey: requestKey.current });
    setOrder(data);
    window.history.replaceState(null, "", `/resolute/checkout?lang=${language}&order=${data.orderId}`);
   } else {
    const id = order?.orderId ?? orderId;
    if (!id) return;
    if (action === "capture") { setUncertain(true); await request("capture", { orderId: id }); }
    setOrder(await request(`orders/${id}`)); setUncertain(false);
   }
  } catch (e) { failure(e); } finally { lock.current = false; setBusy(false); }
 }
 const approval = order?.approvalUrl;
 const safeApproval = approval && /^https:\/\/www\.sandbox\.paypal\.com\/checkoutnow\?token=[A-Z0-9]{8,32}$/.test(approval) ? approval : null;
 const paid = order?.state === "paid";
 const paused = order && ["held", "suspended", "revoked"].includes(order.state);
 const stateText = paid ? (en ? "Test payment verified. No live access has been granted." : "テスト支払いを確認しました。本番の利用権は付与していません。") :
  paused ? (en ? "This order is on hold or its access has been stopped. Review is required." : "この注文は保留中、または利用停止中です。記録の確認が必要です。") :
  order?.state === "capturing" || uncertain ? (en ? "Payment status is being checked. Refresh the status before trying anything else." : "支払い結果の確認が必要です。先に状況を再確認してください。") :
  (en ? "Payment hasn’t been confirmed yet." : "支払い完了はまだ確認されていません。");
 return <main className={styles.page}><section className={styles.card}>
  <p className={styles.badge}>OWNER ONLY · PAYPAL SANDBOX</p>
  <h1>{en ? "Test checkout" : "テスト購入"}</h1>
  <p>{en ? "Use a PayPal Sandbox personal account. No real money will move, and this test won’t unlock the live product." : "PayPalのSandbox用Personalアカウントを使います。実際の請求や本番の利用権付与は行いません。"}</p>
  <nav className={styles.links} aria-label="Language"><a href={`/resolute/checkout?lang=ja${orderId ? `&order=${orderId}` : ""}`}>日本語</a><a href={`/resolute/checkout?lang=en${orderId ? `&order=${orderId}` : ""}`}>English</a></nav>
  {cancelled && <p role="status">{en ? "You returned from PayPal without finishing. No payment is captured just by opening this page." : "PayPalの操作を中断して戻りました。このページを開いただけで支払いは確定しません。"}</p>}
  {!order && !orderId ? <>
   <label>{en ? "Purchase type" : "購入内容"}<select value={kind} disabled={busy || requestKey.current !== null} onChange={e => setKind(e.target.value as "initial" | "renewal")}>
    <option value="initial">{en ? "First purchase" : "初回購入"}</option><option value="renewal">{en ? "Annual renewal" : "1年間の更新"}</option>
   </select></label>
   <p>{en ? "Your account determines renewal eligibility and pricing. You’ll see the amount before continuing to PayPal." : "更新の可否と価格は会員情報で判定します。PayPalへ進む前に金額を表示します。"}</p>
   <button disabled={busy} onClick={() => void act("create")}>{en ? "Check price and create test order" : "価格を確認してテスト注文を作る"}</button>
  </> : null}
  {order && <>
   <dl><dt>{en ? "Order" : "注文内容"}</dt><dd>{order.quote.kind === "initial" ? (en ? "First purchase" : "初回購入") : (en ? "Annual renewal · no automatic renewal" : "1年間の更新・自動継続なし")}</dd>
    <dt>{en ? "Amount" : "金額"}</dt><dd className={styles.amount}>{new Intl.NumberFormat(en ? "en-US" : "ja-JP", { style: "currency", currency: order.quote.currency }).format(Number(order.quote.value))} <small>{order.quote.currency}</small></dd>
    <dt>{en ? "Order ID" : "注文番号"}</dt><dd className={styles.orderId}>{order.orderId}</dd></dl>
   <p role="status">{stateText}</p>
   {!paid && !paused && !uncertain && order.state === "created" && <div className={styles.actions}>
    {safeApproval && <a className={styles.button} href={safeApproval} rel="noreferrer">{en ? "Continue to PayPal Sandbox" : "PayPalのテスト画面へ進む"}</a>}
    <p>{en ? "After approving in PayPal, return here and confirm the test payment." : "PayPalで承認した後、この画面でテスト支払いを確定します。"}</p>
    <button disabled={busy} onClick={() => void act("capture")}>{en ? "Confirm test payment" : "テスト支払いを確定する"}</button>
   </div>}
  </>}
  {(order || orderId) && <button disabled={busy} onClick={() => void act("status")}>{en ? "Refresh payment status" : "支払い状況を再確認する"}</button>}
  {busy && <p role="status">{en ? "Checking…" : "確認しています…"}</p>}
  {error && <p role="alert">{messages[error]?.[en ? 1 : 0] ?? (en ? "We couldn’t confirm the result. If you started a payment, refresh its status before creating another order." : "結果を確認できませんでした。支払い操作の後は、新しい注文を作る前に支払い状況を再確認してください。")}</p>}
  <footer className={styles.links}><a href={`/resolute/checkout?lang=${language}`}>{en ? "Start a new order" : "新しい注文へ"}</a><a href="/resolute/review">{en ? "Back to owner preview" : "運営者画面に戻る"}</a></footer>
 </section></main>;
}
