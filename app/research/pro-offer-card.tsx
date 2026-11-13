"use client";
import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";
import styles from "./plan-cards.module.css";

export type OfferCurrency = "JPY" | "USD";
export type OfferPeriod = "month" | "year";

/** Display prices (owner decision, Nov 2026). The charged amounts are set on the server and in PayPal, never taken from here. */
const AMOUNT: Record<OfferCurrency, Record<OfferPeriod, number>> = { JPY: { month: 2980, year: 29800 }, USD: { month: 20, year: 200 } };
const TWELVE_MONTHS: Record<OfferCurrency, number> = { JPY: 35760, USD: 240 };
export function offerPrice(currency: OfferCurrency, period: OfferPeriod, ja: boolean) {
  const money = (value: number) => ja ? `${value.toLocaleString("en-US")}${currency === "JPY" ? "円" : "ドル"}` : `${currency === "JPY" ? "¥" : "$"}${value.toLocaleString("en-US")}`;
  const unit = period === "year"
    ? currency === "JPY" ? (ja ? "/ 年(税込)" : "/ year (tax incl.)") : (ja ? "/ 年" : "/ year")
    : currency === "JPY" ? (ja ? "/ 月(税込)" : "/ month (tax incl.)") : (ja ? "/ 月" : "/ month");
  return { amount: money(AMOUNT[currency][period]), unit, twelveMonths: period === "year" ? money(TWELVE_MONTHS[currency]) : null };
}

const KEY = "tech-phase:pro-offer:v1";
/** The last choice on this device, so the introduction card and the account card open on the same selection. */
function remembered(): { currency?: OfferCurrency; period?: OfferPeriod } {
  try {
    const value = JSON.parse(sessionStorage.getItem(KEY) ?? "{}");
    return { currency: value.currency === "JPY" || value.currency === "USD" ? value.currency : undefined, period: value.period === "month" || value.period === "year" ? value.period : undefined };
  } catch { return {}; }
}
function remember(value: { currency: OfferCurrency | null; period: OfferPeriod | null }) { try { sessionStorage.setItem(KEY, JSON.stringify(value)); } catch { /* optional */ } }

/**
 * The PRO introduction card (docs/design/pro-card-pack): JPY/USD and monthly/yearly switch on the card, price, a PayPal button
 * that goes straight to PayPal (no confirmation sheet), then the feature list (children). Gold is used on this card only.
 * First choice: yearly; USD when the reader browses in English (the site's only overseas signal), otherwise JPY.
 */
export default function ProOfferCard({ ja, onSubscribe, href, busy = false, disabled = false, notice, children }: {
  ja: boolean; onSubscribe?: (currency: OfferCurrency, period: OfferPeriod) => void; href?: string; busy?: boolean; disabled?: boolean; notice?: ReactNode; children: ReactNode;
}) {
  const t = (a: string, b: string) => ja ? a : b;
  const [pickedCurrency, setCurrency] = useState<OfferCurrency | null>(null);
  const [pickedPeriod, setPeriod] = useState<OfferPeriod | null>(null);
  useEffect(() => { const saved = remembered(); const id = setTimeout(() => { if (saved.currency) setCurrency(saved.currency); if (saved.period) setPeriod(saved.period); }, 0); return () => clearTimeout(id); }, []);
  const currency: OfferCurrency = pickedCurrency ?? (ja ? "JPY" : "USD");
  const period: OfferPeriod = pickedPeriod ?? "year";
  const pick = (c: OfferCurrency | null, p: OfferPeriod | null) => { const nextC = c ?? pickedCurrency ?? currency, nextP = p ?? pickedPeriod ?? period; setCurrency(nextC); setPeriod(nextP); remember({ currency: nextC, period: nextP }); };
  const price = offerPrice(currency, period, ja);
  const tab = (active: boolean, label: string, onClick: () => void) => <button type="button" className={styles.tab} aria-pressed={active} onClick={onClick}>{label}</button>;
  const label = busy ? t("PayPalへ移動しています…", "Opening PayPal…") : t("PayPalで申し込む", "Subscribe with PayPal");
  return <article className={styles.proCard}>
    <div className={styles.head}>
      <svg width="26" height="22" viewBox="0 0 26 22" fill="none" stroke="#d9b25f" strokeWidth="1.7" strokeLinejoin="round" strokeLinecap="round" aria-hidden="true"><path d="M3 18 L2 6 L8.5 11 L13 3 L17.5 11 L24 6 L23 18 Z" /><path d="M3.5 20.5 H22.5" /></svg>
      <span>TECH PHASE PRO</span>
    </div>
    <div className={styles.tabs}>
      <div className={styles.tabGroup}>{tab(currency === "JPY", t("日本円", "JPY"), () => pick("JPY", null))}{tab(currency === "USD", t("米ドル", "USD"), () => pick("USD", null))}</div>
      <div className={styles.tabGroup}>
        {tab(period === "month", t("月額", "Monthly"), () => pick(null, "month"))}
        <span className={styles.yearTab}><span className={styles.bubble} aria-hidden="true">{t("17%OFF", "17% OFF")}<i /></span>{tab(period === "year", t("年額", "Yearly"), () => pick(null, "year"))}</span>
      </div>
    </div>
    <p className={styles.priceRow} aria-live="polite">
      <span className={styles.priceN}>{price.amount}</span><span className={styles.priceU}>{price.unit}</span>
      {price.twelveMonths && <del className={styles.priceOld}>{price.twelveMonths}</del>}
    </p>
    {onSubscribe
      ? <button type="button" className={styles.paypal} disabled={busy || disabled} onClick={() => onSubscribe(currency, period)}>{label}</button>
      : href && !disabled ? <Link className={styles.paypal} href={href} prefetch={false}>{label}</Link> : <button type="button" className={styles.paypal} disabled>{label}</button>}
    {notice}
    <p className={styles.includes}>{t("無料プランのすべての機能に加えて", "Everything in Free, plus")}</p>
    {children}
  </article>;
}
