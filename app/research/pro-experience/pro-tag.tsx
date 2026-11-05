import styles from "./styles.module.css";

/** The gold-crown PRO tag shown next to a PRO feature's name (owner, Nov 5). */
export default function ProTag() {
  return <span className={styles.proTag}>
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" aria-hidden="true"><path d="M3 8l4.5 4L12 5l4.5 7L21 8l-2 11H5z" /></svg>PRO
  </span>;
}
