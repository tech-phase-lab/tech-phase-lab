import type { ReactNode } from "react";
import styles from "./diagnosis.module.css";

/** RESOLUTE heading (owner, Nov 25 phone design §A): a small gold spaced English label, a Mincho heading and a
 * one- or two-line description, centred. `level` 1 is the page title; 2 is a section heading inside the page.
 * Every screen uses this instead of writing its own heading block, so the look stays the same everywhere. */
export default function SectionHeading({ label, title, description, level = 1, id, className }: {
 label?: ReactNode; title: ReactNode; description?: ReactNode; level?: 1 | 2; id?: string; className?: string }) {
 const Title = level === 1 ? "h1" : "h2";
 return <header className={`${styles.toolHeading} ${level === 2 ? styles.headingSection : ""} ${className ?? ""}`}>
  {label ? <span className={styles.headLabel}>{label}</span> : null}
  <Title id={id}>{title}</Title>
  {description ? <p className={styles.muted}>{description}</p> : null}
 </header>;
}
