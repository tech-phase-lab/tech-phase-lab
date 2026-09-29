"use client";
import styles from "./general-news.module.css";
export default function FeedPagination({ page, pages, onChange, ja }: { page: number; pages: number; onChange: (page: number) => void; ja: boolean }) {
  if (pages <= 1) return null;
  return <nav className={styles.pagination} aria-label={ja ? "ニュースのページ" : "News pages"}>
    <button disabled={page === 1} onClick={() => onChange(page - 1)}>{ja ? "前へ" : "Previous"}</button>
    {Array.from({ length: pages }, (_, i) => i + 1).map(n => <button key={n} aria-current={n === page ? "page" : undefined} aria-label={ja ? `${n}ページ目` : `Page ${n}`} onClick={() => onChange(n)}>{n}</button>)}
    <button disabled={page === pages} onClick={() => onChange(page + 1)}>{ja ? "次へ" : "Next"}</button>
  </nav>;
}
