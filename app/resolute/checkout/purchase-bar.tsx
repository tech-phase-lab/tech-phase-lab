"use client";
import { AnchorMark } from "../tool-shell";
import h from "../tool-shell.module.css";
import styles from "./styles.module.css";

type Language = "ja" | "en";

/** The purchase pages' top bar (owner, Nov 25): the shared RESOLUTE header in its "purchase" form, only the logo and JA/EN,
 * no menu. Same markup and classes as `ResoluteHeader variant="purchase"` (tool-shell.tsx); the logo is a plain link here
 * because next/link's prefetch code does not run in the payment screens' render tests (jsdom has no `self`).
 * A screen that keeps state passes `onLanguage` (buttons); a screen that reloads passes `hrefFor` (links). */
export default function PurchaseBar({ language, onLanguage, hrefFor }: {
 language: Language; onLanguage?: (next: Language) => void; hrefFor?: (next: Language) => string;
}) {
 const en = language === "en";
 // A reloading screen uses links, so the screen's own button stays the first button on the page.
 const option = (value: Language, label: string) => hrefFor
  ? <a href={hrefFor(value)} aria-current={language === value ? "true" : undefined} className={styles.langLink}>{label}</a>
  : <button type="button" aria-pressed={language === value} onClick={() => onLanguage?.(value)}>{label}</button>;
 return <div className={styles.barWrap}>
  <header className={`${h.bar} ${h.purchase}`}>
   <a href={`/resolute?lang=${language}`} className={h.logo} aria-label="RESOLUTE"><AnchorMark />RESOLUTE</a>
   <div className={h.langs} role="group" aria-label={en ? "Display language" : "表示言語"}>
    {option("ja", "JA")}{option("en", "EN")}
   </div>
  </header>
 </div>;
}
