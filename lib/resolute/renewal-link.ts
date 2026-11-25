/** The same hand renewal the account screen's 「通知サービスを更新」 opens (go-live audit, Nov 25). The consent tick right
 * above the purchase button is enforced on the checkout screen itself (app/resolute/checkout/live-screen.tsx). */
export function renewalHref(locale:'ja'|'en'){return `/resolute/checkout?lang=${locale}&kind=renewal`;}
