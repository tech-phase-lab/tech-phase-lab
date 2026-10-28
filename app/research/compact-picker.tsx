"use client";

import { useEffect, useId, useRef, useState } from "react";
import styles from "./compact-picker.module.css";

type Option = { value: string; label: string };
type Props = { label: string; value: string; options: Option[]; onChange: (value: string) => void; lang: "ja" | "en" };
function ThemeDropdown({ label, value, options, onChange }: Props) {
  const id = useId();
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const current = Math.max(0, options.findIndex(option => option.value === value));
  useEffect(() => {
    if (!open) return;
    const selected = list.current?.querySelector<HTMLButtonElement>("[aria-selected=true]");
    selected?.focus({ preventScroll: true });
    if (selected && list.current) list.current.scrollTop = selected.offsetTop - list.current.offsetTop;
    function outside(event: PointerEvent) { if (!root.current?.contains(event.target as Node)) setOpen(false); }
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [open]);
  return <div ref={root} className={`${styles.dropdown} ${open ? styles.open : ""}`} onKeyDown={event => {
    if (event.key === "Escape") { event.preventDefault(); setOpen(false); trigger.current?.focus(); }
    if (event.key === "Tab") setOpen(false);
  }}>
    {open && <div className={styles.backdrop} aria-hidden="true" onClick={() => { setOpen(false); trigger.current?.focus(); }} />}
    <button ref={trigger} type="button" className={styles.trigger} aria-label={`${label}: ${options[current]?.label ?? ""}`} aria-haspopup="listbox" aria-expanded={open} aria-controls={open ? id : undefined} onClick={() => setOpen(!open)}>{options[current]?.label}<span aria-hidden="true">⌄</span></button>
    {open && <div ref={list} id={id} className={styles.list} role="listbox" aria-label={label} onKeyDown={event => {
      if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
      event.preventDefault();
      const buttons = Array.from(list.current?.querySelectorAll<HTMLButtonElement>("[role=option]") ?? []);
      const focused = buttons.indexOf(document.activeElement as HTMLButtonElement);
      const index = event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1 : Math.max(0, Math.min(buttons.length - 1, focused + (event.key === "ArrowDown" ? 1 : -1)));
      buttons[index]?.focus();
    }}>
      {options.map(option => <button type="button" role="option" aria-selected={value === option.value} key={option.value} onClick={() => { onChange(option.value); setOpen(false); trigger.current?.focus(); }}>{option.label}<span aria-hidden="true">{value === option.value ? "✓" : ""}</span></button>)}
    </div>}
  </div>;
}

export default function CompactPicker(props: Props) {
  return <ThemeDropdown {...props} />;
}
