"use client";
import { useState } from "react";
import ToolShell from "../tool-shell";
import NumberInput from "../number-input";
import FlowNavigation from "../flow-navigation";
import styles from "../diagnosis.module.css";
import { calcSale, calcLossRealization, DISCLAIMER_JA, DISCLAIMER_EN, NOTE_TEXT, type AccountType } from "@/lib/resolute/jp-tax";
import { parseTaxAmount } from "@/lib/resolute/tax-input";
import type { DiagnosisLocale } from "@/lib/resolute/diagnosis-copy";

export default function TaxScreen({ identityReady = true }: { identityReady?: boolean }) {
  return <ToolShell identityReady={identityReady}>{locale => <TaxEstimate locale={locale}/>}</ToolShell>;
}
function TaxEstimate({ locale }: { locale: DiagnosisLocale }) {
  const [tab, setTab] = useState<"sale" | "loss">("sale");
  const [account, setAccount] = useState<AccountType>("specific_withholding");
  const [inputs, setInputs] = useState({ proceeds: "0", cost: "0", fees: "0", loss: "0", other: "0" });
  const en = locale === "en", t = (ja: string, eng: string) => en ? eng : ja;
  const money = (n: number) => new Intl.NumberFormat(en ? "en-US" : "ja-JP", {maximumFractionDigits: 0}).format(n)+(en?" yen":"円");
  const values = Object.fromEntries(Object.entries(inputs).map(([k, v]) => [k, parseTaxAmount(v, k === "fees" ? "yen" : "man")]));
  const valid = (tab === "sale" ? ["proceeds", "cost", "fees"] : ["loss", "other"]).every(k => values[k] !== null);
  const sale = valid && tab === "sale" ? calcSale({ taxYear: 2026, account, proceedsJpy: values.proceeds!, costJpy: values.cost!, feesJpy: values.fees! }) : null;
  const loss = valid && tab === "loss" ? calcLossRealization({ taxYear: 2026, account, lossJpy: values.loss!, otherNetGainJpy: values.other! }) : null;
  const notes = sale?.supported ? sale.notes : loss?.supported ? loss.notes : [];
  const field = (key: keyof typeof inputs, label: string) => <label className={styles.compactField}><span>{label}</span><span><NumberInput decimal={key!=="fees"} value={inputs[key]} onValueChange={value=>setInputs(s=>({...s,[key]:value}))}/><small>{key==="fees"?t("円","yen"):t("万円","× ¥10,000")}</small></span></label>;
  return <div className={styles.section}>
    <header className={styles.toolHeading}><h1>{t("税金の目安", "Tax estimate")}</h1><p className={styles.muted}>{t("日本在住の方向け・2026年分の売却", "For Japan residents · 2026 sales")}</p></header>
    <div className={styles.tabs} role="group" aria-label={t("計算の種類", "Calculation")}><button aria-pressed={tab === "sale"} onClick={() => setTab("sale")}>{t("売却したとき", "When you sell")}</button><button aria-pressed={tab === "loss"} onClick={() => setTab("loss")}>{t("損切りしたとき", "When you realize a loss")}</button></div>
    <section className={styles.card}><h2>{t("口座の種類", "Account type")}</h2>
      <div className={styles.accountChoices}>{([
        ["specific_withholding", "特定口座", "Withholding account"], ["general", "一般口座", "Non-withholding account"], ["nisa", "NISA口座", "NISA account"]] as const).map(([id, ja, eng]) => <button className={styles.option} key={id} aria-pressed={account === id} onClick={() => setAccount(id)}>{t(ja, eng)}</button>)}</div>
      <p className={styles.muted}>{account === "specific_withholding" ? t("源泉徴収ありの特定口座", "A tokutei account with tax withholding.") : account === "general" ? t("特定口座の源泉徴収なしを含みます。", "A general account or a tokutei account without withholding.") : t("利益は非課税として計算します。", "Gains are treated as tax-free.")}</p>

      {tab === "sale" ? <>{field("proceeds", t("今年の売却代金の合計", "Total sale proceeds this year"))}{field("cost", t("その購入額の合計", "Total purchase cost of those shares"))}<details className={styles.mailDetails}><summary>{t("くわしく設定する", "More settings")}</summary>{field("fees", t("手数料", "Fees"))}</details></> : <>{field("loss", t("確定する損", "Loss to realize"))}{field("other", t("今年のほかの利益", "Other gains this year"))}</>}
    </section>
    {!valid ? <p role="alert" className={styles.error}>{t("0〜1兆円の整数を入力してください。", "Enter whole-yen amounts from 0 to 1 trillion.")}</p> : <section className={`${styles.card} ${styles.hero}`} aria-live="polite">
      <span className={styles.eyebrow}>RESULT</span>
      {sale?.supported ? <><p className={styles.muted}>{t("あなたの手取りの目安は", "Your estimated net proceeds")}</p><p className={styles.bigNumber}>{money(sale.netProceeds)}</p><dl className={styles.resultRows}>
        <div><dt>{t("この売却の損益", "Profit or loss on these sales")}</dt><dd>{money(sale.gain)}</dd></div><div><dt>{t("税金の目安", "Estimated tax")}</dt><dd>{money(sale.tax.total)}</dd></div><div><dt>{t("税金を引いたあとの損益", "Profit or loss after tax")}</dt><dd>{money(sale.netGainAfterTax)}</dd></div>
      </dl></> : null}
      {loss?.supported ? <><h2>{loss.taxChange < 0 ? t("税金は次の金額だけ少なくなる計算です", "Estimated reduction in tax") : t("税金は変わらない計算です", "Estimated tax stays the same")}</h2><p className={styles.bigNumber}>{money(-loss.taxChange)}</p><dl className={styles.resultRows}>
        <div><dt>{t("確定する前の税金", "Tax before realizing the loss")}</dt><dd>{money(loss.taxBefore.total)}</dd></div><div><dt>{t("確定したあとの税金", "Tax after realizing the loss")}</dt><dd>{money(loss.taxAfter.total)}</dd></div><div><dt>{t("繰り越せる損失", "Loss eligible for carryforward")}</dt><dd>{money(loss.carryforward.newLossToCarry)}</dd></div>
      </dl><p className={styles.muted}>{t("入力した条件で、相殺できた場合の計算です。損を確定するかどうかは、ご自身で決めてください。", "This assumes the loss can offset the gains you entered. Whether to realize a loss is your decision.")}</p></> : null}
      {notes.length ? <ul className={styles.taxNotes}>{notes.map(code => <li key={code}>{NOTE_TEXT[code]?.[locale]}</li>)}</ul> : null}
    </section>}
    <details className={`${styles.card} ${styles.disclosure}`}><summary>{t("この計算の前提", "What this assumes")}</summary><div className={styles.section}>
      <div><h2>{t("税率 20.315%", "Tax rate: 20.315%")}</h2><p>{t("所得税15%・住民税5%・復興特別所得税は所得税額の2.1%", "Income tax: 15%. Resident tax: 5%. Reconstruction surtax: 2.1% of income tax.")}</p></div>
      <div><h2>{t("計算に含まないもの", "Not included")}</h2><ul className={styles.taxNotes}>{[
        ["配当や給与などのほかの所得", "Dividends, salary and other income"], ["外国税額控除などの特例", "Special rules such as foreign tax credits"], ["為替レートの扱い", "Currency conversion"], ["手数料以外の費用", "Costs other than fees"], ["前年までの繰越損失", "Losses carried forward from prior years"]
      ].map(([ja, eng]) => <li key={eng}>{t(ja, eng)}</li>)}</ul></div>
      <p className={styles.muted}>{t("税額は各税目の1円未満を切り捨てる概算です。確定申告の端数処理とは異なります。", "Each tax component is rounded down to the nearest yen. Tax-return rounding rules differ.")}</p>
      <p className={styles.muted}>{t("現在は2026年分のみ対応しています。", "Only tax year 2026 is currently supported.")}</p>
    </div></details>
    <p className={styles.disclaimer}>{en ? DISCLAIMER_EN : DISCLAIMER_JA}</p>
    <FlowNavigation step={6} locale={locale}/>
  </div>;
}
