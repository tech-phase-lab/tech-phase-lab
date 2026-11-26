"use client";
import styles from "./general-news.module.css";

/** At most five page/gap slots; this limits navigation, never the news history. */
export function newsPageNumbers(page: number, pages: number): (number | "gap")[] {
  if (pages <= 5) return Array.from({ length: pages }, (_, i) => i + 1);
  if (page <= 3) return [1, 2, 3, "gap", pages];
  if (page >= pages - 2) return [1, "gap", pages - 2, pages - 1, pages];
  return [1, "gap", page, "gap", pages];
}

/** Call before a page change (owner, Nov 26: › moved the page so 「目標株価」 sat half under the header).
 * The list keeps the height of the tallest page shown so far, so a shorter last page never makes the screen jump,
 * and the scroll position stays where it is. Only when the top of the paged section is hidden under the fixed
 * header (or above it) is the section (or the page heading the list sits under) brought back, to sit fully visible 8px below the header. */
export function turnPageInPlace(section: HTMLElement | null, list: HTMLElement | null = section) {
  if (typeof window === "undefined") return;
  if (list) list.style.minHeight = `${Math.max(list.offsetHeight, parseFloat(list.style.minHeight) || 0)}px`;
  if (!section) return;
  let headerBottom = 0;
  for (const header of document.querySelectorAll("header")) {
    const position = getComputedStyle(header).position, box = header.getBoundingClientRect();
    if ((position === "sticky" || position === "fixed") && box.top <= 1 && box.bottom > headerBottom) headerBottom = box.bottom;
  }
  const top = section.getBoundingClientRect().top;
  if (top < headerBottom) window.scrollTo({ top: window.scrollY + top - headerBottom - 8, behavior: "instant" });
}

export default function FeedPagination({ page, pages, onChange, ja }: { page: number; pages: number; onChange: (page: number) => void; ja: boolean }) {
  if (pages <= 1) return null;
  // "‹ 1 / N ›": every page stays reachable one step at a time (owner, Oct 14).
  return <nav className={styles.pagination} aria-label={ja ? "ニュースのページ" : "News pages"}>
    <button type="button" disabled={page === 1} onClick={() => onChange(page - 1)} aria-label={ja ? "前へ" : "Previous"}><span aria-hidden="true">‹</span></button>
    <span className={styles.pageCount} aria-current="page" aria-label={ja ? `${page}ページ目 / 全${pages}ページ` : `Page ${page} of ${pages}`}>{page} / {pages}</span>
    <button type="button" disabled={page === pages} onClick={() => onChange(page + 1)} aria-label={ja ? "次へ" : "Next"}><span aria-hidden="true">›</span></button>
  </nav>;
}
