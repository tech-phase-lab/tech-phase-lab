"use client";
import type { CSSProperties, MouseEvent, ReactNode } from "react";

/** The final pay button's wording after the lawyer's review (owner pack, Nov 17, section 3), for RESOLUTE and PRO alike. */
export const AGREE_LABEL = { ja: "利用規約に同意して申し込む", en: "Agree to the Terms and buy" } as const;
/** The small lines right above the final button. */
export const RESOLUTE_CHECKOUT_LINES = {
  ja: ["通知機能は1年間。2年目からの更新（5,980円・PRO会員3,980円）は、更新時期にお知らせし、ご希望の方だけ更新します。", "お客様都合の返金はできません(二重課金・当方の不具合で使えない場合を除く)。"],
  en: ["Alerts run for one year. For renewal from year two ($39, PRO $29), we'll let you know when it's time to renew; only those who choose to renew are renewed.", "No refunds for change of mind (except double charges or if a fault on our side stops it from working)."],
} as const;
// RESOLUTE automatic renewal (owner, Nov 19): replaces the first line ("…ご希望の方だけ更新します") for an order the server
// created with automatic renewal (order.autoRenewal, flag RESOLUTE_AUTO_RENEWAL_ENABLED). With the flag off the lines stay as above.
export const RESOLUTE_AUTO_RENEWAL_LINE = { ja: "1年後から自動で更新されます。いつでも止められます", en: "Renews automatically after one year. You can stop it anytime." } as const;
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
