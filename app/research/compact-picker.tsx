"use client";

import { useEffect, useId, useRef, useState } from "react";
import styles from "./compact-picker.module.css";

type Option = { value: string; label: string };
type Props = { label: string; value: string; options: Option[]; onChange: (value: string) => void; wheel?: boolean; lang: "ja" | "en" };
const ROW = 44;

function InlineWheel({ label, value, options, onChange }: Props) {
  const id = useId();
  const scroller = useRef<HTMLDivElement>(null);
  const settle = useRef<ReturnType<typeof setTimeout> | null>(null);
  const current = Math.max(0, options.findIndex(option => option.value === value));
  useEffect(() => {
    scroller.current?.scrollTo({ top: current * ROW, behavior: "instant" });
  }, [current]);
  useEffect(() => () => { if (settle.current) clearTimeout(settle.current); }, []);
  function select(index: number) {
    const next = Math.max(0, Math.min(options.length - 1, index));
    if (settle.current) clearTimeout(settle.current);
    scroller.current?.scrollTo({ top: next * ROW, behavior: "instant" });
    if (options[next] && options[next].value !== value) onChange(options[next].value);
  }
  return <div className={styles.inlineWheel}>
    <div ref={scroller} className={styles.wheel} role="listbox" aria-label={label} tabIndex={0} aria-activedescendant={`${id}-${current}`} onScroll={event => {
      if (settle.current) clearTimeout(settle.current);
      const index = Math.max(0, Math.min(options.length - 1, Math.round(event.currentTarget.scrollTop / ROW)));
      settle.current = setTimeout(() => { if (options[index] && options[index].value !== value) onChange(options[index].value); }, 120);
    }} onKeyDown={event => {
      if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
        event.preventDefault();
        select(event.key === "Home" ? 0 : event.key === "End" ? options.length - 1 : current + (event.key === "ArrowDown" ? 1 : -1));
      }
    }}>
      {options.map((option, index) => <div id={`${id}-${index}`} key={option.value} role="option" aria-selected={current === index} className={styles.wheelOption} onClick={() => select(index)}>{option.label}</div>)}
    </div>
    <span className={styles.wheelHint} aria-hidden="true">↕</span>
  </div>;
}

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
  return <div ref={root} className={styles.dropdown} onKeyDown={event => {
    if (event.key === "Escape") { event.preventDefault(); setOpen(false); trigger.current?.focus(); }
    if (event.key === "Tab") setOpen(false);
  }}>
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
  return props.wheel ? <InlineWheel {...props} /> : <ThemeDropdown {...props} />;
}
