"use client";
import type { CSSProperties, MouseEvent, ReactNode } from "react";

/** The final pay button's wording after the lawyer's review (owner pack, Nov 17, section 3), for RESOLUTE and PRO alike. */
export const AGREE_LABEL = { ja: "利用規約に同意して申し込む", en: "Agree to the Terms and buy" } as const;
/** The small lines right above the final button. */
export const RESOLUTE_CHECKOUT_LINES = {
  ja: ["通知機能は1年間。2年目からの更新（5,980円・PRO会員3,980円）は、更新時期にお知らせし、ご希望の方だけ更新します。", "お客様都合の返金はできません(二重課金・当方の不具合で使えない場合を除く)"],
  en: ["Alerts run for one year. For renewal from year two ($39, PRO $29), we'll let you know when it's time to renew; only those who choose to renew are renewed.", "No refunds for change of mind (except double charges or if a fault on our side stops it from working)."],
} as const;
// RESOLUTE automatic renewal (owner, Nov 19): replaces the first line ("…ご希望の方だけ更新します") for an order the server
// created with automatic renewal (order.autoRenewal, flag RESOLUTE_AUTO_RENEWAL_ENABLED). With the flag off the lines stay as above.
// Lawyer review (Nov 24): how to stop and by when. The renewal is charged from 00:00 JST of the renewal day
// (services/resolute-api/payments/renewal.mjs), so the stop deadline is the day before it, on the account page.
export const RESOLUTE_AUTO_RENEWAL_LINE = { ja: "1年後から自動で更新されます。更新日の前日までアカウント画面から止められます", en: "Renews automatically after one year. You can stop it on your account page until the day before the renewal date." } as const;
/** Account screen, RESOLUTE section, under 「自動更新 オン」: the deadline (lawyer review, Nov 24). The renewal day is the expiry day shown above. */
export const RESOLUTE_RENEWAL_STOP_NOTE = { ja: "自動更新は、更新日（有効期限の日）の前日までにここで止められます。", en: "You can stop auto-renewal here until the day before the renewal date (the expiry date)." } as const;
/** RESOLUTE LP gold button (owner, Nov 24: one press, one tick): shown always, right above the consent line, so the buyer reads
 * how and by when to stop before going to PayPal. Only orders made while signed in ask PayPal to save the payment method, so
 * the line says so; a guest order is renewed by hand after a notice. */
export const RESOLUTE_AUTO_RENEWAL_LP_LINE = { ja: "ログインしてご購入の場合、1年後から自動で更新されます。更新日の前日までアカウント画面から止められます", en: "If you buy while signed in, it renews automatically after one year. You can stop it on your account page until the day before the renewal date." } as const;
/** The small lines right above the LP consent line: the auto-renewal line and the refund line. */
export function resoluteBuyLines(en: boolean): readonly string[] {
  return [RESOLUTE_AUTO_RENEWAL_LP_LINE[en ? "en" : "ja"], RESOLUTE_CHECKOUT_LINES[en ? "en" : "ja"][1]];
}
export function resoluteCheckoutLines(en: boolean, autoRenewal: boolean): readonly string[] {
  const lines = RESOLUTE_CHECKOUT_LINES[en ? "en" : "ja"];
  return autoRenewal ? [RESOLUTE_AUTO_RENEWAL_LINE[en ? "en" : "ja"], lines[1]] : lines;
}
export const PRO_CHECKOUT_LINE = { ja: "月額・年額とも解約するまで自動更新。いつでも解約できます。", en: "Monthly and yearly plans renew automatically until you cancel. You can cancel anytime." } as const;

export function termsHref(en: boolean) { return en ? "/terms?lang=en" : "/terms"; }

const lineStyle: CSSProperties = { margin: "0 0 4px", fontSize: 12, lineHeight: 1.6, opacity: 0.75 };
/** The small lines above the button. */
export function CheckoutLines({ lines, className }: { lines: readonly string[]; className?: string }) {
  return <div className={className} data-checkout-lines="">{lines.map(line => <p key={line} style={className ? undefined : lineStyle}>{line}</p>)}</div>;
}

/** 「利用規約に同意して申し込む」. 「利用規約」 opens the full terms in a new tab without pressing the button; the button's
 * accessible name is the whole sentence. The terms are also linked in each checkout's footer, for keyboards and screen readers. */
export default function AgreeButton({ en, className, disabled, onClick, busy, busyLabel }: {
  en: boolean; className?: string; disabled?: boolean; onClick: () => void; busy?: boolean; busyLabel?: ReactNode;
}) {
  const href = termsHref(en);
  const openTerms = (event: MouseEvent) => { event.preventDefault(); event.stopPropagation(); window.open(href, "_blank", "noopener"); };
  const terms = <span role="link" data-href={href} onClick={openTerms} style={{ textDecoration: "underline", textUnderlineOffset: 3, cursor: "pointer" }}>{en ? "Terms" : "利用規約"}</span>;
  return <button type="button" className={className} disabled={disabled} onClick={onClick} aria-label={busy && typeof busyLabel === "string" ? busyLabel : en ? AGREE_LABEL.en : AGREE_LABEL.ja}>
    {busy && busyLabel ? busyLabel : en ? <>Agree to the {terms} and buy</> : <>{terms}に同意して申し込む</>}
  </button>;
}
