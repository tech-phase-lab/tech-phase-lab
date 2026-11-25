import styles from "./styles.module.css";

type Language = "ja" | "en";

/** The purchase pages' top bar (owner, Nov 25): only the RESOLUTE logo and the language switch, no menu. A screen that keeps
 * state passes `onLanguage` (buttons); a screen that reloads passes `hrefFor` (links). */
export default function PurchaseBar({ language, onLanguage, hrefFor, disabled = false }: {
 language: Language; onLanguage?: (next: Language) => void; hrefFor?: (next: Language) => string; disabled?: boolean;
}) {
 const option = (value: Language, label: string, name: string) => hrefFor
  ? <a key={value} href={hrefFor(value)} aria-current={language === value ? "true" : undefined} aria-label={name} lang={value}>{label}</a>
  : <button key={value} type="button" disabled={disabled} aria-pressed={language === value} aria-label={name} lang={value} onClick={() => onLanguage?.(value)}>{label}</button>;
 return <header className={styles.bar}>
  <span className={styles.logo}>
   <svg viewBox="0 0 48 48" aria-hidden="true"><circle cx="24" cy="9" r="4" /><path d="M24 13v28M17 19h14M9 31c0 7 7 11 15 11s15-4 15-11M5 33l4-4 4 4M35 33l4-4 4 4" /></svg>
   <span>RESOLUTE</span>
  </span>
  <nav className={styles.lang} aria-label="Language">{option("ja", "JA", "日本語")}{option("en", "EN", "English")}</nav>
 </header>;
}
