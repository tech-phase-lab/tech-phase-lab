import s from "./lp.module.css";

export function Anchor({ className }: { className?: string }) {
 return <svg className={className} viewBox="0 0 48 48" aria-hidden="true"><circle cx="24" cy="9" r="4" /><path d="M24 13v28M17 19h14M9 31c0 7 7 11 15 11s15-4 15-11M5 33l4-4 4 4M35 33l4-4 4 4" /></svg>;
}

export function Feature({ title, text }: { title: string; text: string }) {
 return <div className={s.feature}><b>{title}</b><p>{text}</p></div>;
}

/** PC only (owner, Nov 25, 01_LP_PC): the fixed menu at the top. Hidden on the phone by lp.module.css. */
export function PcBar({ en, embedded }: { en: boolean; embedded: boolean }) {
 const ja = embedded ? "/resolute" : "/resolute/lp", english = embedded ? "/resolute?lang=en" : "/resolute/lp/en";
 const links: [string, string, string][] = [["#nights", "暴落の夜・急騰の夜", "Crash and surge nights"], ["#features", en ? "10の機能" : "11の機能", en ? "10 features" : "11 features"],
  ["#message", "リゼルから", "From RIZEL"], ["#faq", "よくある質問", "Common questions"]];
 return <header className={s.pcBar}>
  <a href="#top" className={s.pcLogo} aria-label="RESOLUTE"><Anchor /><span>RESOLUTE</span></a>
  <nav className={s.pcLinks} aria-label={en ? "Sections" : "このページの内容"}>{links.map(([href, jaText, enText]) => <a key={href} href={href}>{en ? enText : jaText}</a>)}</nav>
  <div className={s.pcLang} role="group" aria-label={en ? "Language" : "言語"}><a href={ja} aria-current={en ? undefined : "page"} lang="ja">JA</a><a href={english} aria-current={en ? "page" : undefined} lang="en">EN</a></div>
  <a href="#buy" className={s.pcBuy}>{en ? "Get RESOLUTE" : "RESOLUTEを手に入れる"}</a>
 </header>;
}
export const stars = (n: number) => <b className={s.stars} aria-label={`${n}/5`}>{"★".repeat(n)}<i>{"☆".repeat(5 - n)}</i></b>;

