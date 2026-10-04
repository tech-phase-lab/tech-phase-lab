"use client";
import styles from "./general-news.module.css";

/** At most five page/gap slots; this limits navigation, never the news history. */
export function newsPageNumbers(page: number, pages: number): (number | "gap")[] {
  if (pages <= 5) return Array.from({ length: pages }, (_, i) => i + 1);
  if (page <= 3) return [1, 2, 3, "gap", pages];
  if (page >= pages - 2) return [1, "gap", pages - 2, pages - 1, pages];
  return [1, "gap", page, "gap", pages];
}

export default function FeedPagination({ page, pages, onChange, ja }: { page: number; pages: number; onChange: (page: number) => void; ja: boolean }) {
  if (pages <= 1) return null;
  return <nav className={styles.pagination} aria-label={ja ? "ニュースのページ" : "News pages"}>
    <button type="button" disabled={page === 1} onClick={() => onChange(page - 1)} aria-label={ja ? "前へ" : "Previous"}><span aria-hidden="true">‹</span></button>
    {newsPageNumbers(page, pages).map((n, index) => n === "gap"
      ? <span key={`gap-${index}`} className={styles.pageGap} aria-hidden="true">…</span>
      : <button type="button" key={n} aria-current={n === page ? "page" : undefined} aria-label={ja ? `${n}ページ目` : `Page ${n}`} onClick={() => onChange(n)}>{n}</button>)}
    <button type="button" disabled={page === pages} onClick={() => onChange(page + 1)} aria-label={ja ? "次へ" : "Next"}><span aria-hidden="true">›</span></button>
  </nav>;
}
