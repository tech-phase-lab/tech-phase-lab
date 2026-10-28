"use client";
import { useEffect, useRef, useState } from "react";
import styles from "./list-wheel.module.css";

export type WheelItem = { id: string; label: string; count: number };
const ROW = 46;

/** The list picker (owner, Oct 26): the current list on one compact button; tapping it opens a wheel to turn to
 * the list you want. Up to seven lists, so the wheel stays short; no row of chips taking space above the stocks. */
export default function ListWheel({ items, value, onChange, title, doneLabel, stocksLabel, triggerClass }: {
  triggerClass?: string; items: WheelItem[]; value: string; onChange: (id: string) => void; title: string; doneLabel: string; stocksLabel: (count: number) => string;
}) {
  const [open, setOpen] = useState(false);
  const current = Math.max(0, items.findIndex(item => item.id === value));
  const [active, setActive] = useState(current);
  const wheel = useRef<HTMLDivElement>(null);
  const settle = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const go = (index: number, smooth = true) => wheel.current?.scrollTo({ top: index * ROW, behavior: smooth ? "smooth" : "auto" });

  useEffect(() => {
    if (!open) return;
    go(current, false);
    const close = (event: KeyboardEvent) => { if (event.key === "Escape") setOpen(false); };
    window.addEventListener("keydown", close);
    document.body.style.overflow = "hidden";
    return () => { window.removeEventListener("keydown", close); document.body.style.overflow = ""; clearTimeout(settle.current); };
  }, [open, current]);

  const onScroll = () => {
    clearTimeout(settle.current);
    settle.current = setTimeout(() => {
      const index = Math.min(items.length - 1, Math.max(0, Math.round((wheel.current?.scrollTop ?? 0) / ROW)));
      setActive(index);
    }, 70);
  };
  const choose = () => { onChange(items[active]?.id ?? value); setOpen(false); };
  const label = items[current]?.label ?? "";

  return <>
    <button type="button" className={triggerClass ?? styles.trigger} aria-haspopup="dialog" aria-expanded={open} onClick={() => { setActive(current); setOpen(true); }}>
      <span>{label}</span>
      <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m7 10 5-5 5 5M7 14l5 5 5-5" /></svg>
    </button>
    {open && <div className={styles.overlay} onClick={() => setOpen(false)}>
      <div className={styles.sheet} role="dialog" aria-modal="true" aria-label={title} onClick={event => event.stopPropagation()}>
        <div className={styles.bar}><button type="button" onClick={() => setOpen(false)}>{"×"}</button><strong>{title}</strong><button type="button" className={styles.done} onClick={choose}>{doneLabel}</button></div>
        <div className={styles.wheelBox}>
          <i className={styles.band} aria-hidden="true" />
          <div className={styles.wheel} ref={wheel} role="listbox" aria-label={title} tabIndex={0} onScroll={onScroll} onKeyDown={event => {
            if (event.key === "ArrowDown" || event.key === "ArrowUp") { event.preventDefault(); const next = Math.min(items.length - 1, Math.max(0, active + (event.key === "ArrowDown" ? 1 : -1))); setActive(next); go(next); }
            if (event.key === "Enter") { event.preventDefault(); choose(); }
          }}>
            {items.map((item, index) => <button type="button" role="option" aria-selected={index === active} key={item.id} className={`${styles.row} ${index === active ? styles.rowOn : ""}`} style={{ opacity: Math.max(0.25, 1 - Math.abs(index - active) * 0.32) }} onClick={() => { setActive(index); go(index); }} onDoubleClick={choose}>
              <span>{item.label}</span><small>{item.count ? stocksLabel(item.count) : ""}</small>
            </button>)}
          </div>
        </div>
      </div>
    </div>}
  </>;
}
