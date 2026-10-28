import s from "./lp.module.css";

export function Anchor({ className }: { className?: string }) {
 return <svg className={className} viewBox="0 0 48 48" aria-hidden="true"><circle cx="24" cy="9" r="4" /><path d="M24 13v28M17 19h14M9 31c0 7 7 11 15 11s15-4 15-11M5 33l4-4 4 4M35 33l4-4 4 4" /></svg>;
}

export function Feature({ title, text }: { title: string; text: string }) {
 return <div className={s.feature}><b>{title}</b><p>{text}</p></div>;
}
export const stars = (n: number) => <b className={s.stars} aria-label={`${n}/5`}>{"★".repeat(n)}<i>{"☆".repeat(5 - n)}</i></b>;

