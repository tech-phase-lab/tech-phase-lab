// The lawyer's review (owner pack, Nov 17), sections 2–9: exact wording, and a guard that the items the owner chose to keep
// (「変えないもの」) are still there, unchanged. Section 1 (the Shock Gauge) is checked by its own tests.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";
import { DISCLAIMER } from "../lib/legal/disclaimer.ts";
import { THERMOMETER_NOTE, THERMOMETER_METHOD } from "../lib/resolute/thermometer-copy.ts";
import { calcSale, calcLossRealization, TAX_ASSUMPTIONS } from "../lib/resolute/jp-tax.ts";
import { latestAlertView } from "../lib/resolute/latest-alert.ts";
import { recoveryMail } from "../services/resolute-api/payments/recovery.mjs";
import termsJa from "../lib/legal/terms-ja.ts";
import termsEn from "../lib/legal/terms-en.ts";
import privacyJa from "../lib/legal/privacy-ja.ts";
import privacyEn from "../lib/legal/privacy-en.ts";
import commerceJa from "../lib/legal/commerce-ja.ts";
import commerceEn from "../lib/legal/commerce-en.ts";
import { legalModule } from "./support-legal-modules.mjs";

const read = path => readFileSync(new URL(path, import.meta.url), "utf8");
const sha = path => createHash("sha256").update(readFileSync(new URL(path, import.meta.url))).digest("hex");
const lp = read("../app/resolute/lp/landing.tsx"), lpEn = read("../app/resolute/lp/landing-en.tsx");

test("変えないもの: PRO card copy, the LP's 「もう暴落は怖くない。」 and prices, the diagnosis and tonight's videos are unchanged", () => {
  const cards = read("../app/research/plan-cards.tsx");
  for (const phrase of ["一手先まで読む独自の分析", "1週間の変化と展望", "競合・提携・協業の関係を図解", "いま強い分野がすぐ分かる", "迷う2〜3銘柄を瞬時に見極める",
    "守る力と稼ぐ力を一望", "リアルタイム・全件", "目標株価・決算・指標・ニュース", "主要株の変化を見逃さない", "スクショで持ち株を登録", "文章と音声で相場を語る", "会員の疑問を厳選して深掘り",
    "Original analysis to help you understand the results", "The week's shifts and outlook"]) assert.ok(cards.includes(phrase), phrase);
  assert.ok(lp.includes(`<p className={s.bigGold}>もう暴落は怖くない。</p>`));
  assert.ok(lp.includes(`<p className={s.launch}>発売記念価格 ・ 2027年2月末まで</p>`));
  assert.ok(lp.includes(`<p className={s.amount}><del>¥9,800</del><b>¥7,980</b><small>税込</small></p>`));
  assert.ok(lpEn.includes(`<p className={s.amount}><del>$69</del><b>$59</b></p>`));
  // The LP buttons keep their wording; since the payment pack (owner, Nov 2026) they go straight to PayPal.
  assert.ok(lp.includes(">RESOLUTEを手に入れる</BuyButton>")); assert.ok(lpEn.includes(">Get RESOLUTE</BuyButton>"));
  // Diagnosis: the drop % is the reader's choice or their own number.
  assert.equal(sha("../lib/resolute/diagnosis-questions-ja.ts"), "a961e67a5c46ea1d687e760999e92ed2be585209eb6c9facf7aa04589cfcc776");
  assert.ok(read("../lib/resolute/diagnosis-questions-ja.ts").includes("自分で数字を入れる"));
  // Tonight's videos.
  assert.equal(sha("../lib/resolute/tonight-videos.ts"), "9267d692f1495e1fdc1b3c8a60071bbf1f07221565b28c148affd703b5ff22f4");
  for (const id of ["breathe", "steady", "history"]) for (const lang of ["ja", "en"]) assert.ok(existsSync(new URL(`../public/media/resolute-tonight/${id}-${lang}.mp4`, import.meta.url)), `${id}-${lang}`);
});

test("2: the operator's outlook phrases are gone from templates, notifications and screens", () => {
  const removed = ["警戒は必要ですが、AIそのものが崩れたというわけではありません。", "今夜は無理に動く必要はありません。", "市場への影響は小さいと見ています。", "TP指標を見る限り、この下げは一時的である可能性が高いです。"];
  const files = ["../app/resolute/notifications-screen.tsx", "../app/resolute/tonight/screen.tsx", "../app/resolute/home/screen.tsx", "../app/resolute/thermometer/screen.tsx",
    "../lib/resolute/mail-templates.ts", "../lib/resolute/push-notice.ts", "../lib/resolute/latest-alert.ts", "../lib/resolute/morning-note.ts", "../lib/resolute/risk.ts",
    "../lib/resolute/rizel-quote-drafts.ts", "../lib/resolute/review-scenarios.ts", "../lib/resolute/risk-preview.ts", "../services/resolute-api/risk-job.mjs", "../scripts/research/web_push.py"];
  for (const file of files) for (const phrase of removed) assert.ok(!read(file).includes(phrase), `${file}: ${phrase}`);
});

test("2: the gauge's one-line note (JA/EN) and the collapsible method outline sit by the gauge, on the gauge page and the home card", () => {
  assert.equal(THERMOMETER_NOTE.ja, "過去の値動きの大きさを示すもので、割安・割高や売買の時期を示すものではありません。");
  assert.equal(THERMOMETER_NOTE.en, "Based on the size of past price moves. It doesn't show whether stocks are cheap or expensive, or when to buy or sell.");
  const screen = read("../app/resolute/thermometer/screen.tsx");
  assert.match(screen, /<p className=\{styles\.disclaimer\}>\{THERMOMETER_NOTE\[locale\]\}<\/p>\n    <\/section>/);
  assert.match(screen, /<details[^>]*><summary>\{t\("計算方法の概要", "How it is calculated"\)\}<\/summary>/);
  assert.match(read("../app/resolute/home/market-gauge-card.tsx"), /\{THERMOMETER_NOTE\[locale\]\}/);
  const method = THERMOMETER_METHOD.map(row => `${row.ja.term}:${row.ja.text}`).join("\n");
  // What the code does (thermometer-basket.ts / thermometer-provider.ts): 100 and 40 stocks, equal-weight daily returns chained
  // from 100 with at least 10 stocks a day, split-adjusted closes, 20-day annualised volatility of the large-cap basket, 10 years.
  for (const fact of ["対象銘柄", "100銘柄", "40社", "同じ重みの平均", "100から始めた", "10銘柄以上", "株式分割", "値動きの荒さ", "20営業日", "標準偏差", "年率", "過去10年"]) assert.ok(method.includes(fact), fact);
  const basket = read("../lib/resolute/thermometer-basket.ts");
  assert.match(basket, /MIN_TICKERS_PER_DAY = 10/); assert.match(basket, /window = 20/); assert.match(basket, /variance \* 252/); assert.match(basket, /let level = 100/);
  assert.match(read("../lib/resolute/thermometer-provider.ts"), /adjust: 'splits'/);
  const rosters = JSON.parse(read("../lib/resolute/thermometer-rosters.json"));
  assert.equal(rosters.nasdaq100.tickers.length, 100); assert.equal(rosters.semiconductors.tickers.length, 40);
});

test("3: RESOLUTE checkout — only the final pay button reads 「利用規約に同意して申し込む」, with the two small lines right above it", async () => {
  const agree = legalModule("../../legal/agree-button");
  assert.deepEqual(agree.AGREE_LABEL, { ja: "利用規約に同意して申し込む", en: "Agree to the Terms and buy" });
  // Owner decision 案B: renewal as implemented today, the same for everyone (notice, then renew only if you choose).
  assert.deepEqual(agree.RESOLUTE_CHECKOUT_LINES.ja, ["通知機能は1年間。2年目からの更新（5,980円・PRO会員3,980円）は、更新時期にお知らせし、ご希望の方だけ更新します。", "お客様都合の返金はできません(二重課金・当方の不具合で使えない場合を除く)。"]);
  assert.deepEqual(agree.RESOLUTE_CHECKOUT_LINES.en, ["Alerts run for one year. For renewal from year two ($39, PRO $29), we'll let you know when it's time to renew; only those who choose to renew are renewed.", "No refunds for change of mind (except double charges or if a fault on our side stops it from working)."]);
  assert.equal(agree.PRO_CHECKOUT_LINE.ja, "月額・年額とも解約するまで自動更新。いつでも解約できます。");
  const { createElement } = await import("react"), { renderToStaticMarkup } = await import("react-dom/server");
  const ja = renderToStaticMarkup(createElement(agree.default, { en: false, onClick: () => {} })), en = renderToStaticMarkup(createElement(agree.default, { en: true, onClick: () => {} }));
  assert.match(ja, /^<button type="button" aria-label="利用規約に同意して申し込む"><span role="link" data-href="\/terms"[^>]*>利用規約<\/span>に同意して申し込む<\/button>$/);
  assert.match(en, /^<button type="button" aria-label="Agree to the Terms and buy">Agree to the <span role="link" data-href="\/terms\?lang=en"[^>]*>Terms<\/span> and buy<\/button>$/);
  assert.match(read("../app/legal/agree-button.tsx"), /window\.open\(href, "_blank", "noopener"\)/);
  const live = read("../app/resolute/checkout/live-screen.tsx");
  // Owner, Nov 19: for an automatic-renewal order the first line becomes 「1年後から自動で更新されます。いつでも止められます」;
  // with RESOLUTE_AUTO_RENEWAL_ENABLED off the two lines are RESOLUTE_CHECKOUT_LINES as before (tests/resolute-auto-renewal.test.mjs).
  assert.match(live, /<CheckoutLines lines=\{resoluteCheckoutLines\(en,order\.autoRenewal===true\)\} \/>\n    <AgreeButton en=\{en\} disabled=\{busy\} onClick=\{\(\)=>void act\("capture"\)\} \/>/);
  assert.ok(!live.includes("支払いを確定する") && !live.includes("Complete payment"));
  // The other buttons keep their words; the footer links the full terms and the commerce notice.
  for (const kept of ["価格を確認して進む", "Check price and continue", "PayPalへ進む", "Continue to PayPal"]) assert.ok(live.includes(kept), kept);
  assert.match(live, /href=\{termsHref\(en\)\} target="_blank"/); assert.match(live, /\/resolute\/legal\/commerce/);
});

test("3: PRO — the final button (account card, resume sheet, live billing page) carries the same wording and the renewal line", () => {
  for (const file of ["../app/research/pro-offer-card.tsx", "../app/research/account/account-sheets.tsx", "../app/research/account/billing/screen.tsx"]) {
    const src = read(file);
    assert.match(src, /<CheckoutLines lines=\{\[ja \? PRO_CHECKOUT_LINE\.ja : PRO_CHECKOUT_LINE\.en\]\}[^>]*\/>/, file);
    assert.match(src, /<AgreeButton en=\{!ja\}/, file);
  }
  assert.ok(!read("../app/research/account/account-sheets.tsx").includes('t("PayPalへ進む", "Continue to PayPal")'));
});

test("4 (owner decision 案B): one payment method — PayPal (credit card or bank account) — and RESOLUTE renewal only on request, everywhere", () => {
  const PM = "PayPal（クレジットカード・銀行口座払い）", PE = "PayPal (credit card or bank account)";
  assert.ok(lp.includes("更新時期にお知らせし、ご希望の方だけ更新します。"));
  assert.ok(lpEn.includes("We’ll let you know when it’s time to renew; only those who choose to renew are renewed."));
  assert.ok(lp.includes(`<details><summary>支払い方法は?</summary><p>${PM}です。</p></details>`));
  assert.ok(lpEn.includes(`<details><summary>How can I pay?</summary><p>${PE}.</p></details>`));
  const live = read("../app/resolute/checkout/live-screen.tsx");
  assert.ok(live.includes(`お支払いは${PM}です。`) && live.includes(`Payment is by ${PE}.`));
  assert.ok(live.includes(`<dt>{en?"Payment method":"お支払い方法"}</dt><dd>{en?"${PE}":"${PM}"}</dd>`));
  assert.ok(termsJa.includes(`3. 支払方法は、${PM}です。`) && termsJa.includes(`PROプランの料金は、${PM}で支払います。`));
  assert.ok(termsEn.includes(`3. You can pay with ${PE}.`));
  assert.equal(commerceJa.split(`| 支払方法 | ${PM} |`).length - 1, 2);
  assert.equal(commerceEn.split(`| Payment method | ${PE} |`).length - 1, 2);
  assert.ok(termsJa.includes("4. 更新は、ご希望の方だけ行います。") && termsJa.includes("自動で課金することはありません。"));
  assert.ok(commerceJa.includes("| 通知機能の更新 | 更新時期にお知らせし、ご希望の方だけ更新します。自動で課金することはありません |"));
  // No bank transfer anywhere, and no claim that RESOLUTE renews automatically (PRO's own subscription does auto-renew).
  const mail = read("../services/resolute-api/payments/recovery.mjs");
  const everywhere = { termsJa, termsEn, privacyJa, privacyEn, commerceJa, commerceEn, lp, lpEn, live, sandbox: read("../app/resolute/checkout/screen.tsx"), agree: read("../app/legal/agree-button.tsx"), mail };
  for (const [name, text] of Object.entries(everywhere)) assert.ok(!/銀行振込|振込手数料|振込先|bank transfer/i.test(text), `${name}: bank transfer`);
  const resoluteOnly = { lp, lpEn, live, mail, lines: JSON.stringify(legalModule("../../legal/agree-button").RESOLUTE_CHECKOUT_LINES),
    terms21: termsJa.slice(termsJa.indexOf("## 第21条")), terms21En: termsEn.slice(termsEn.indexOf("## Article 21")), commerceResolute: commerceJa.slice(commerceJa.indexOf("## RESOLUTE")), commerceResoluteEn: commerceEn.slice(commerceEn.indexOf("## RESOLUTE")) };
  for (const [name, text] of Object.entries(resoluteOnly)) {
    assert.ok(!/自動で更新され|自動更新|自動で課金します|renews? automatically|charged automatically|automatic renewal/.test(text.replace(/自動で課金することはありません|You are never charged automatically/g, "")), `${name}: auto-renew claim`);
  }
  for (const text of [lp, lpEn, read("../app/resolute/checkout/live-screen.tsx"), read("../app/resolute/checkout/screen.tsx")]) {
    assert.ok(!/never renew automatically|never automatic|自動継続なし|自動継続はありません|自動で更新されることはありません/.test(text));
  }
  const order = { id: "12345678-1234-4234-8234-123456789abc" };
  const ja = recoveryMail({ ...order, quote: { language: "ja" } }, "t", "https://techphase.app").text, en = recoveryMail({ ...order, quote: { language: "en" } }, "t", "https://techphase.app").text;
  assert.ok(ja.includes("2年目からの更新（5,980円・PRO会員3,980円）は、更新時期にメールでお知らせし、ご希望の方だけ更新します。お支払いはPayPal（クレジットカード・銀行口座払い）です。"));
  assert.ok(en.includes("For renewal from year two ($39, PRO $29), we'll let you know by email when it's time to renew; only those who choose to renew are renewed. Payment is by PayPal (credit card or bank account)."));
});

test("5: LP FAQ — one-time purchase (feature names, renewal prices, 「提供を続ける限り使えます」) and the refund exception, JA and EN", () => {
  assert.ok(lp.includes("<details><summary>買い切りですか?</summary><p>アラート通知・翌朝のひとこと・衝撃度チェッカー・RIZELの一言は購入から1年間で、2年目以降は更新する形です。更新料金は5,980円、Tech Phase PRO会員は3,980円です。"));
  assert.ok(lp.includes("更新料金は5,980円、Tech Phase PRO会員は3,980円です。更新時期にお知らせし、ご希望の方だけ更新します。それ以外の機能は、一度の購入で、提供を続ける限り使えます。</p></details>"));
  assert.ok(!lp.includes("ずっと使えます"));
  assert.ok(lp.includes("内容をご確認のうえお申し込みください。二重課金や、当方の不具合で使えない場合は返金します。</p>"));
  assert.ok(lpEn.includes("<p>Alerts, Morning Note, Shock Gauge and RIZEL’s Take run for one year from purchase; from the second year they need renewal, at $39 a year or $29 for Tech Phase PRO members."));
  assert.ok(lpEn.includes("for as long as we provide RESOLUTE.</p>"));
  assert.ok(lpEn.includes("We do refund double charges, or if a fault on our side stops it from working.</p>"));
});

test("6: one disclaimer sentence, small and faint, in every footer, after each article, on the alert page and under the checker", () => {
  assert.equal(DISCLAIMER.ja, "本サービスと本商品は、情報の提供とご自身で決めたルールの管理を目的としたもので、特定の銘柄の売買や売買の時期をすすめるものではありません。投資の判断は、ご自身でおこなってください。");
  // The English follows Article 2, Paragraph 2 of the English terms.
  assert.ok(termsEn.includes("The Service and the Product are intended to provide information for reference in your investment decisions and to help you manage rules you set for yourself. They do not advise on or recommend buying or selling any particular security"));
  assert.match(DISCLAIMER.en, /^The Service and the Product are intended to provide information and to help you manage rules you set for yourself\. They do not recommend buying or selling any particular security or the timing of trades\./);
  assert.ok(termsJa.includes("本サービスと本商品は、投資判断の参考となる情報の提供と、利用者自身が決めたルールの管理の補助を目的とするものであり、特定の銘柄の売買、保有の継続、売買の時期その他の投資判断について助言し、又は推奨するものではありません。"));
  const component = read("../app/resolute/disclaimer.tsx");
  // Small and faint (owner, Nov 18: far too obtrusive at 11px / 0.55): 10px, opacity 0.4, a 12px gap above, never enlarged by iOS.
  assert.match(component, /fontSize: 10,/); assert.match(component, /opacity: 0\.4,/); assert.match(component, /margin: "12px 0 0"/);
  assert.match(component, /WebkitTextSizeAdjust: "100%"/);
  const places = {
    "../app/research/research-tool-shell.tsx": /\{children\}\n[^\n]*\n      \{footer && <footer><Disclaimer en=\{lang === "en"\} \/><\/footer>\}\n    <\/main>/,
    "../app/research/research-dashboard.tsx": /<Disclaimer en=\{lang === "en"\} \/><\/footer>/,
    "../app/resolute/tool-shell.tsx": /\{checking \? null : <Disclaimer en=\{en\} \/>\}\n \<\/div><\/main>;/,
    // The last line of the LP footers.
    "../app/resolute/lp/landing.tsx": /<footer className=\{s\.foot\}>[\s\S]*<Disclaimer \/>\n   <\/footer>/,
    "../app/resolute/lp/landing-en.tsx": /<footer className=\{s\.foot\}>[\s\S]*<Disclaimer en \/>\n   <\/footer>/,
    "../app/resolute/checkout/live-screen.tsx": /<Disclaimer en=\{en\} \/>/,
    "../app/research/columns/columns.tsx": /\{access === "pro" && !editing && <Disclaimer en=\{!ja\} \/>\}\n    <\/div>\n  <\/article>/,
    "../app/research/weekly/issues.tsx": /<Disclaimer en=\{!ja\} \/>\n  <\/article>/,
    "../app/research/qa/questions.tsx": /<Disclaimer en=\{!ja\} \/>\n    <\/div>\}/,
  };
  for (const [file, pattern] of Object.entries(places)) assert.match(read(file), pattern, file);
  // The alert page a phone notification opens (/resolute/alerts/latest).
  const alert = { date: "2026-11-17", items: [{ kind: "line_reached", symbol: "NVDA", close: 100, dropPct: 10, newLines: [10] }] };
  assert.equal(latestAlertView(alert, "ja").disclaimer, DISCLAIMER.ja);
  assert.equal(latestAlertView(alert, "en").disclaimer, DISCLAIMER.en);
  assert.match(read("../app/resolute/alerts/latest/screen.tsx"), /<p className=\{s\.disc\}>\{v\.disclaimer\}<\/p>/);
  // Under the checker: the news page is drawn inside the RESOLUTE tool shell, whose last line is the disclaimer.
  assert.match(read("../app/resolute/news/screen.tsx"), /<ToolShell identityReady=\{identityReady\}>\{locale=><News locale=\{locale\}\/>\}<\/ToolShell>/);
});

test("7: the tax estimate shows its assumptions and keeps NISA losses out of offsets and carry-forwards", () => {
  const terms = TAX_ASSUMPTIONS.map(row => row.ja.term);
  assert.deepEqual(terms, ["対象の口座", "年度", "為替の換算方法", "確定申告が必要な場合", "NISA口座の損失"]);
  const all = TAX_ASSUMPTIONS.map(row => row.ja.text).join("");
  for (const fact of ["特定口座", "一般口座", "2026年分", "売った日", "買った日", "為替レート", "確定申告が必要", "ほかの利益と通算できず、繰り越しもできません"]) assert.ok(all.includes(fact), fact);
  assert.ok(TAX_ASSUMPTIONS.every(row => row.en.term && row.en.text));
  const screen = read("../app/resolute/tax/screen.tsx");
  assert.match(screen, /<section className=\{styles\.card\} aria-labelledby="tax-assumptions"><h2 id="tax-assumptions">\{t\("この計算の前提", "What this assumes"\)\}<\/h2>/);
  assert.ok(screen.includes("NISA口座の損失は、ほかの利益と通算できず、繰り越しもできないため、税金は変わりません。"));
  // The calculation: a NISA loss never lowers the tax on other gains and is never carried forward.
  const loss = calcLossRealization({ taxYear: 2026, account: "nisa", lossJpy: 500_000, otherNetGainJpy: 1_000_000 });
  assert.equal(loss.taxChange, 0); assert.equal(loss.carryforward.newLossToCarry, 0); assert.ok(loss.notes.includes("nisa_loss_not_deductible"));
  const sale = calcSale({ taxYear: 2026, account: "nisa", proceedsJpy: 800_000, costJpy: 1_000_000, otherNetGainJpy: 1_000_000 });
  assert.equal(sale.tax.total, 0); assert.equal(sale.carryforward.newLossToCarry, 0); assert.ok(sale.notes.includes("nisa_loss_not_deductible"));
  // The same loss in a taxable account does offset (the contrast).
  assert.ok(calcLossRealization({ taxYear: 2026, account: "general", lossJpy: 500_000, otherNetGainJpy: 1_000_000 }).taxChange < 0);
});

test("8: the struck-through 35,760円 carries a small 「月額の12か月分」 (EN: 12 × monthly)", () => {
  const card = read("../app/research/pro-offer-card.tsx");
  assert.match(card, /export const TWELVE_MONTHS_NOTE = \{ ja: "月額の12か月分", en: "12 × monthly" \} as const;/);
  assert.match(card, /<del className=\{styles\.priceOld\}>\{price\.twelveMonths\}<\/del><small className=\{styles\.priceOldNote\}>\{t\(TWELVE_MONTHS_NOTE\.ja, TWELVE_MONTHS_NOTE\.en\)\}<\/small>/);
  assert.match(read("../app/research/plan-cards.module.css"), /\.priceOldNote \{ font-size:10px;/);
});

test("9: the three lawyer-reviewed texts, their English, Web Push providers, and the commerce page at the linked URL", () => {
  const source = name => read(`../content/legal/${name}`);
  // The lawyer's wording, verbatim (spot checks across the texts; legal-pages.test.mjs checks every line renders as written).
  for (const phrase of ["リゼル(英語ではRIZEL、以下「運営者」)", "第18条から第22条は、RESOLUTEにだけ当てはまります。", "運営者は、金融商品取引法に基づく投資助言・代理業の登録を受けていないため",
    "ただし、当該額が3,000円に満たない場合（FREEプランの場合を含みます。）は、3,000円を上限とします。", "本規約は日本法に従います。紛争は、東京地方裁判所を第一審の合意管轄とします。",
    "アラート通知（終値アラートを含みます。）、翌朝のひとこと、衝撃度チェッカー及びRIZELの一言(以下「通知機能」)は、購入日から1年間使えます。"]) assert.ok(termsJa.includes(phrase), phrase);
  assert.equal(termsJa, source("terms.ja.md")); assert.equal(privacyJa, source("privacy.ja.md")); assert.equal(commerceJa, source("commerce.ja.md"));
  assert.equal(termsEn, source("terms.en.md")); assert.equal(privacyEn, source("privacy.en.md")); assert.equal(commerceEn, source("commerce.en.md"));
  // 「●日」 stays until the backup retention is confirmed (RESOLUTE's protection chain keeps objects without an expiry today).
  assert.equal((privacyJa.match(/●日/g) ?? []).length, 2); assert.equal((privacyEn.match(/● days/g) ?? []).length, 2);
  // No 運営責任者 row; the phone number stays as currently written.
  assert.ok(!commerceJa.includes("運営責任者"));
  assert.equal((commerceJa.match(/IP電話などで取得した番号を記載します\(取得後に確定\)/g) ?? []).length, 2);
  // Web Push delivery services: exactly the push hosts web_push.py allows.
  const allowed = read("../scripts/research/web_push.py").match(/'fcm\.googleapis\.com', 'updates\.push\.services\.mozilla\.com', 'web\.push\.apple\.com'/);
  assert.ok(allowed, "the allowlist in web_push.py");
  assert.ok(privacyJa.includes("Apple Push Notification service(Apple社)、Firebase Cloud Messaging(Google社)、Mozillaのプッシュサービス(Mozilla社)"));
  assert.ok(privacyEn.includes("Apple Push Notification service (Apple), Firebase Cloud Messaging (Google) or Mozilla's push service (Mozilla)"));
  // The commerce notice is reachable where the LPs and plan cards link.
  assert.ok(lp.includes(`<Link href="/resolute/legal/commerce">特定商取引法に基づく表記</Link>`));
  assert.ok(lpEn.includes(`<Link href="/resolute/legal/commerce?lang=en">Legal Notice</Link>`));
  assert.match(read("../app/research/plan-cards.tsx"), /export const TOKUSHOHO_HREF = "\/resolute\/legal\/commerce";/);
  const page = read("../app/resolute/legal/commerce/page.tsx");
  assert.match(page, /import commerce from "@\/lib\/legal\/commerce-ja";/); assert.match(page, /robots: \{ index: false, follow: false \}/);
  assert.ok(!/clerk|auth\(|getMembership/i.test(page + read("../app/resolute/legal/commerce/layout.tsx")));
  assert.match(read("../scripts/legal-sync.mjs"), /\["terms", "privacy", "commerce"\]/);
});
