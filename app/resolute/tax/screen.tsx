"use client";
import { useState, type ReactNode } from "react";
import ToolShell from "../tool-shell";
import NumberInput from "../number-input";
import FlowNavigation from "../flow-navigation";
import SectionHeading from "../section-heading";
import styles from "../diagnosis.module.css";
import { calcSale, calcLossRealization, DISCLAIMER_JA, DISCLAIMER_EN, NOTE_TEXT, TAX_ASSUMPTIONS, type AccountType } from "@/lib/resolute/jp-tax";
import { parseTaxAmount } from "@/lib/resolute/tax-input";
import type { DiagnosisLocale } from "@/lib/resolute/diagnosis-copy";
import pc from "../pc.module.css";
import x from "./tax-pc.module.css";
import { useDesktop } from "../use-desktop";

export default function TaxScreen({ identityReady = true }: { identityReady?: boolean }) {
  return <ToolShell identityReady={identityReady} pc>{locale => <TaxEstimate locale={locale}/>}</ToolShell>;
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
  const desktop = useDesktop();
  if (desktop) return <TaxPc {...{ locale, tab, setTab, account, setAccount, valid, sale, loss, notes, money, field, t }}/>;
  return <div className={styles.section}>
    <SectionHeading label="TAX" title={t("税金の目安", "Tax estimate")} description={t("日本在住の方向け・2026年分の売却", "For residents of Japan · Share sales in 2026")}/>
    <div className={styles.tabs} role="group" aria-label={t("計算の種類", "Calculation")}><button aria-pressed={tab === "sale"} onClick={() => setTab("sale")}>{t("売却したとき", "When you sell")}</button><button aria-pressed={tab === "loss"} onClick={() => setTab("loss")}>{t("損切りしたとき", "When you sell at a loss")}</button></div>
    <section className={styles.card}><h2>{t("口座の種類", "Account type")}</h2>
      <div className={styles.accountChoices}>{([
        ["specific_withholding", "特定口座", "Tax withheld"], ["general", "一般口座", "No tax withheld"], ["nisa", "NISA口座", "NISA account"]] as const).map(([id, ja, eng]) => <button className={styles.option} key={id} aria-pressed={account === id} onClick={() => setAccount(id)}>{t(ja, eng)}</button>)}</div>
      <p className={styles.muted}>{account === "specific_withholding" ? t("源泉徴収ありの特定口座", "A tokutei account with tax withholding.") : account === "general" ? t("特定口座の源泉徴収なしを含みます。", "A general account or a tokutei account without withholding.") : t("利益は非課税として計算します。", "Gains are treated as tax-free.")}</p>

      {tab === "sale" ? <>{field("proceeds", t("今年の売却代金の合計", "Total sale proceeds this year"))}{field("cost", t("その購入額の合計", "Total purchase cost of those shares"))}<details className={styles.mailDetails}><summary>{t("くわしく設定する", "More settings")}</summary>{field("fees", t("手数料", "Fees"))}</details></> : <>{field("loss", t("確定する損", "Loss from selling"))}{field("other", t("今年のほかの利益", "Other gains this year"))}</>}
    </section>
    {!valid ? <p role="alert" className={styles.error}>{t("0〜1兆円の整数を入力してください。", "Enter whole-yen amounts from 0 to 1 trillion.")}</p> : <section className={`${styles.card} ${x.result} ${x.phoneResult}`} aria-live="polite">
      {/* Phone (owner, Nov 25, mobile 12): the take-home amount large, then profit, the tax in red and what is left in gold. */}
      <span className={styles.eyebrow}>RESULT</span>
      {sale?.supported ? <><p className={x.resultLabel}>{t("あなたの手取りの目安は", "What you’d receive after tax")}</p><p className={`${styles.bigGold} ${x.big}`}>{money(sale.netProceeds)}</p><dl className={x.rows}>
        <div><dt>{t("この売却の損益", "Profit or loss on these sales")}</dt><dd>{money(sale.gain)}</dd></div><div className={x.taxRow}><dt>{t("税金の目安", "Estimated tax")}</dt><dd>{sale.tax.total > 0 ? "−" + money(sale.tax.total) : money(sale.tax.total)}</dd></div><div className={x.goldRow}><dt>{t("税金を引いたあとの損益", "Profit or loss after tax")}</dt><dd>{money(sale.netGainAfterTax)}</dd></div>
      </dl></> : null}
      {loss?.supported ? <><p className={x.resultLabel}>{loss.taxChange < 0 ? t("税金は次の金額だけ少なくなる計算です", "Estimated tax saving") : t("税金は変わらない計算です", "Estimated tax stays the same")}</p><p className={`${styles.bigGold} ${x.big}`}>{money(-loss.taxChange)}</p><dl className={x.rows}>
        <div><dt>{t("確定する前の税金", "Tax before selling at a loss")}</dt><dd>{money(loss.taxBefore.total)}</dd></div><div className={x.goldRow}><dt>{t("確定したあとの税金", "Tax after selling at a loss")}</dt><dd>{money(loss.taxAfter.total)}</dd></div><div><dt>{t("繰り越せる損失", "Loss you can carry forward")}</dt><dd>{money(loss.carryforward.newLossToCarry)}</dd></div>
      </dl><p className={styles.muted}>{account === "nisa" ? t("NISA口座の損失は、ほかの利益と通算できず、繰り越しもできないため、税金は変わりません。損を確定するかどうかは、ご自身で決めてください。", "NISA losses can't be offset against other gains or carried forward, so your tax doesn't change. Whether to sell at a loss is up to you.") : t("入力した条件で、相殺できた場合の計算です。損を確定するかどうかは、ご自身で決めてください。", "This assumes the loss can offset the gains you entered. Whether to sell at a loss is up to you.")}</p></> : null}
      {notes.length ? <ul className={styles.taxNotes}>{notes.map(code => <li key={code}>{NOTE_TEXT[code]?.[locale]}</li>)}</ul> : null}
    </section>}
    {/* この計算の前提 as a list; each item opens with a tap (owner, Nov 25, mobile 12). */}
    <section className={x.phoneAssumptions} aria-labelledby="tax-assumptions"><h2 id="tax-assumptions" className={styles.headLabel}>{t("この計算の前提", "What this assumes")}</h2>
      {TAX_ASSUMPTIONS.map(row => <details key={row.en.term} className={x.phoneAssumption}><summary>{row[locale].term}</summary><p>{row[locale].text}</p></details>)}
    <details className={x.phoneAssumption}><summary>{t("税率と計算に含まないもの", "Tax rate and what's not included")}</summary><div className={styles.section}>
      <div><h2>{t("税率 20.315%", "Tax rate: 20.315%")}</h2><p>{t("所得税15%・住民税5%・復興特別所得税は所得税額の2.1%", "Income tax: 15%. Resident tax: 5%. Reconstruction surtax: 2.1% of income tax.")}</p></div>
      <div><h2>{t("計算に含まないもの", "Not included")}</h2><ul className={styles.taxNotes}>{[
        ["配当や給与などのほかの所得", "Dividends, salary and other income"], ["外国税額控除などの特例", "Special rules such as foreign tax credits"], ["手数料以外の費用", "Costs other than fees"], ["前年までの繰越損失", "Losses carried forward from prior years"]
      ].map(([ja, eng]) => <li key={eng}>{t(ja, eng)}</li>)}</ul></div>
      <p className={styles.muted}>{t("税額は各税目の1円未満を切り捨てる概算です。確定申告の端数処理とは異なります。", "Each tax component is rounded down to the nearest yen. Tax-return rounding rules differ.")}</p>
      <p className={styles.muted}>{t("現在は2026年分のみ対応しています。", "Only tax year 2026 is currently supported.")}</p>
    </div></details></section>
    <p className={styles.disclaimer}>{en ? DISCLAIMER_EN : DISCLAIMER_JA}</p>
    <FlowNavigation step={6} locale={locale}/>
  </div>;
}

const ACCOUNTS = [["specific_withholding", "特定口座", "Tax withheld"], ["general", "一般口座", "No tax withheld"], ["nisa", "NISA口座", "NISA account"]] as const;
const NOT_INCLUDED = [["配当や給与などのほかの所得", "Dividends, salary and other income"], ["外国税額控除などの特例", "Special rules such as foreign tax credits"], ["手数料以外の費用", "Costs other than fees"], ["前年までの繰越損失", "Losses carried forward from prior years"]] as const;
type PcProps = {
  locale: DiagnosisLocale; tab: "sale" | "loss"; setTab: (tab: "sale" | "loss") => void; account: AccountType; setAccount: (account: AccountType) => void; valid: boolean;
  sale: ReturnType<typeof calcSale> | null; loss: ReturnType<typeof calcLossRealization> | null; notes: readonly string[];
  money: (n: number) => string; field: (key: "proceeds" | "cost" | "fees" | "loss" | "other", label: string) => ReactNode; t: (ja: string, eng: string) => string;
};
/** PC (owner, Nov 25, 01_税金の目安_マイルール_PC part 1): the heading with the switch on the right, the inputs and the result side by side
 * at the same height, the six assumptions as 3 × 2 cards of the same height, then the disclaimer and the way back / forward. */
function TaxPc({ locale, tab, setTab, account, setAccount, valid, sale, loss, notes, money, field, t }: PcProps) {
  const en = locale === "en";
  const minus = (n: number) => n > 0 ? "−" + money(n) : money(n);
  return <div className={pc.content}>
    <header className={pc.head}>
      <div><p className={pc.eyebrow}><b>TAX</b>{t("税金の目安", "Tax estimate")}</p><h1 className={pc.title}>{t("税金の目安", "Tax estimate")}</h1>
        <p className={pc.lead}>{t("日本在住の方向け・2026年分の売却", "For residents of Japan · Share sales in 2026")}</p></div>
      <div className={`${styles.tabs} ${x.tabs}`} role="group" aria-label={t("計算の種類", "Calculation")}><button aria-pressed={tab === "sale"} onClick={() => setTab("sale")}>{t("売却したとき", "When you sell")}</button><button aria-pressed={tab === "loss"} onClick={() => setTab("loss")}>{t("損切りしたとき", "When you sell at a loss")}</button></div>
    </header>
    <div className={x.pair}>
      <section className={`${styles.card} ${pc.panel} ${x.inputs}`}><h2 className={x.panelTitle}>{t("口座の種類", "Account type")}</h2>
        <div className={`${styles.accountChoices} ${x.accounts}`}>{ACCOUNTS.map(([id, ja, eng]) => <button className={styles.option} key={id} aria-pressed={account === id} onClick={() => setAccount(id)}>{t(ja, eng)}</button>)}</div>
        <p className={x.accountNote}>{account === "specific_withholding" ? t("源泉徴収ありの特定口座", "A tokutei account with tax withholding.") : account === "general" ? t("特定口座の源泉徴収なしを含みます。", "A general account or a tokutei account without withholding.") : t("利益は非課税として計算します。", "Gains are treated as tax-free.")}</p>
        <div className={x.fields}>{tab === "sale" ? <>{field("proceeds", t("今年の売却代金の合計", "Total sale proceeds this year"))}{field("cost", t("その購入額の合計", "Total purchase cost of those shares"))}<details className={`${styles.mailDetails} ${x.more}`}><summary>{t("くわしく設定する", "More settings")}</summary>{field("fees", t("手数料", "Fees"))}</details></> : <>{field("loss", t("確定する損", "Loss from selling"))}{field("other", t("今年のほかの利益", "Other gains this year"))}</>}</div>
      </section>
      <section className={`${styles.card} ${pc.panel} ${x.result}`} aria-live="polite">
        <span className={styles.eyebrow}>RESULT</span>
        {!valid ? <p role="alert" className={styles.error}>{t("0〜1兆円の整数を入力してください。", "Enter whole-yen amounts from 0 to 1 trillion.")}</p> : null}
        {sale?.supported ? <><p className={x.resultLabel}>{t("あなたの手取りの目安は", "What you’d receive after tax")}</p><p className={x.big}>{money(sale.netProceeds)}</p><dl className={x.rows}>
          <div><dt>{t("この売却の損益", "Profit or loss on these sales")}</dt><dd>{money(sale.gain)}</dd></div>
          <div className={x.taxRow}><dt>{t("税金の目安", "Estimated tax")}</dt><dd>{minus(sale.tax.total)}</dd></div>
          <div className={x.goldRow}><dt>{t("税金を引いたあとの損益", "Profit or loss after tax")}</dt><dd>{money(sale.netGainAfterTax)}</dd></div>
        </dl></> : null}
        {loss?.supported ? <><p className={x.resultLabel}>{loss.taxChange < 0 ? t("税金は次の金額だけ少なくなる計算です", "Estimated tax saving") : t("税金は変わらない計算です", "Estimated tax stays the same")}</p><p className={x.big}>{money(-loss.taxChange)}</p><dl className={x.rows}>
          <div><dt>{t("確定する前の税金", "Tax before selling at a loss")}</dt><dd>{money(loss.taxBefore.total)}</dd></div>
          <div className={x.goldRow}><dt>{t("確定したあとの税金", "Tax after selling at a loss")}</dt><dd>{money(loss.taxAfter.total)}</dd></div>
          <div><dt>{t("繰り越せる損失", "Loss you can carry forward")}</dt><dd>{money(loss.carryforward.newLossToCarry)}</dd></div>
        </dl><p className={x.small}>{account === "nisa" ? t("NISA口座の損失は、ほかの利益と通算できず、繰り越しもできないため、税金は変わりません。損を確定するかどうかは、ご自身で決めてください。", "NISA losses can't be offset against other gains or carried forward, so your tax doesn't change. Whether to sell at a loss is up to you.") : t("入力した条件で、相殺できた場合の計算です。損を確定するかどうかは、ご自身で決めてください。", "This assumes the loss can offset the gains you entered. Whether to sell at a loss is up to you.")}</p></> : null}
        {notes.length ? <ul className={`${styles.taxNotes} ${x.small}`}>{notes.map(code => <li key={code}>{NOTE_TEXT[code]?.[locale]}</li>)}</ul> : null}
        <p className={`${x.small} ${x.rate}`}>{t("税率は所得税15%・住民税5%・復興特別所得税の合計20.315%で計算しています。", "Calculated at 20.315%: income tax 15%, resident tax 5% and the reconstruction surtax.")}</p>
      </section>
    </div>
    <section className={pc.rules} aria-labelledby="tax-assumptions">
      <h2 id="tax-assumptions" className={pc.sectionTitle}>{t("この計算の前提", "What this assumes")}</h2>
      <dl className={x.assumptions}>
        {TAX_ASSUMPTIONS.map(row => <div key={row.en.term} className={x.assumption}><dt>{row[locale].term}</dt><dd>{row[locale].text}</dd></div>)}
        <div className={x.assumption}><dt>{t("税率と計算に含まないもの", "Tax rate and what's not included")}</dt><dd>
          <p><b>{t("税率 20.315%", "Tax rate: 20.315%")}</b> {t("所得税15%・住民税5%・復興特別所得税は所得税額の2.1%", "Income tax: 15%. Resident tax: 5%. Reconstruction surtax: 2.1% of income tax.")}</p>
          <details className={x.notIncluded}><summary>{t("計算に含まないもの", "Not included")}</summary>
            <ul>{NOT_INCLUDED.map(([ja, eng]) => <li key={eng}>{t(ja, eng)}</li>)}</ul>
            <p>{t("税額は各税目の1円未満を切り捨てる概算です。確定申告の端数処理とは異なります。", "Each tax component is rounded down to the nearest yen. Tax-return rounding rules differ.")}</p>
            <p>{t("現在は2026年分のみ対応しています。", "Only tax year 2026 is currently supported.")}</p>
          </details>
        </dd></div>
      </dl>
    </section>
    <p className={x.disclaimer}>{en ? DISCLAIMER_EN : DISCLAIMER_JA}</p>
    <FlowNavigation step={6} locale={locale} wide/>
  </div>;
}
