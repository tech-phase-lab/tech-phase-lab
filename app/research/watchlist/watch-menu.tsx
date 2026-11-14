"use client";
import { useEffect, useRef, useState, type ReactNode } from "react";
import styles from "./watch-menu.module.css";

export type MenuOption = { value: string; label: string };

/** The watchlist's drop-down (owner, Nov 13: the list picker, the sort order and the view): a button that opens a short menu under it; the
 * chosen row is tinted mint with a check. Closes on a choice, Escape, or a tap outside. `menuClass` places the menu (left / right edge). */
export default function WatchMenu({ options, value, onChange, children, label, buttonClass, menuClass = "", disabled = false }: {
  options: MenuOption[]; value: string; onChange: (value: string) => void; children: ReactNode; label: string; buttonClass: string; menuClass?: string; disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLSpanElement>(null), menu = useRef<HTMLDivElement>(null), trigger = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    const items = () => [...(menu.current?.querySelectorAll<HTMLButtonElement>("[role=menuitemradio]") ?? [])];
    (items().find(item => item.getAttribute("aria-checked") === "true") ?? items()[0])?.focus();
    const outside = (event: PointerEvent) => { if (!box.current?.contains(event.target as Node)) setOpen(false); };
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") { setOpen(false); trigger.current?.focus(); return; }
      if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
      event.preventDefault();
      const list = items(), at = list.indexOf(document.activeElement as HTMLButtonElement);
      list[(at + (event.key === "ArrowDown" ? 1 : list.length - 1)) % list.length]?.focus();
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", key);
    return () => { document.removeEventListener("pointerdown", outside); document.removeEventListener("keydown", key); };
  }, [open]);
  return <span ref={box} className={styles.box}>
    <button ref={trigger} type="button" className={buttonClass} aria-haspopup="menu" aria-expanded={open} aria-label={label} disabled={disabled} onClick={() => setOpen(!open)}>
      {children}<svg className={styles.caret} width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="#aab6c4" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M2 3.5l3 3 3-3" /></svg>
    </button>
    {open && <div ref={menu} className={`${styles.menu} ${menuClass}`} role="menu" aria-label={label}>
      {options.map(option => <button key={option.value} type="button" role="menuitemradio" aria-checked={option.value === value} className={styles.item}
        onClick={() => { setOpen(false); trigger.current?.focus(); if (option.value !== value) onChange(option.value); }}>
        <span className={styles.itemLabel}>{option.label}</span>
        {option.value === value && <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#8fe3c0" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7" /></svg>}
      </button>)}
    </div>}
  </span>;
}
