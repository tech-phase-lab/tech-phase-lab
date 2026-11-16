import styles from "./styles.module.css";

/** The gold-crown PRO tag shown next to a PRO feature's name (owner, Nov 5). `tone="plain"` is the tour's feature pages, which FREE visitors
 * read and so carry no gold (owner, Nov 16): the same tag in green, as in the owner's mockups. */
export default function ProTag({ tone = "gold" }: { tone?: "gold" | "plain" }) {
  return <span className={tone === "plain" ? `${styles.proTag} ${styles.proTagPlain}` : styles.proTag}>
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" aria-hidden="true"><path d="M3 8l4.5 4L12 5l4.5 7L21 8l-2 11H5z" /></svg>PRO
  </span>;
}
