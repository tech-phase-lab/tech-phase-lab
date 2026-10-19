"use client";

import { useId, useRef, useState } from "react";
import styles from "./compact-picker.module.css";

type Option = { value: string; label: string };
export default function CompactPicker({ label, value, options, onChange, wheel = false, lang }: {
  label: string; value: string; options: Option[]; onChange: (value: string) => void; wheel?: boolean; lang: "ja" | "en";
}) {
  const id = useId();
  const dialog = useRef<HTMLDialogElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const [draft, setDraft] = useState(0);
  const current = Math.max(0, options.findIndex(option => option.value === value));
  function open() {
    setDraft(current);
    dialog.current?.showModal();
    if (scroller.current) scroller.current.scrollTop = current * 44;
  }
  function finish(index: number) {
    const option = options[index];
    if (option) onChange(option.value);
    dialog.current?.close();
  }
  return <>
    <button type="button" className={styles.trigger} aria-label={`${label}: ${options[current]?.label ?? ""}`} aria-haspopup="dialog" onClick={open}>{options[current]?.label}<span aria-hidden="true">⌄</span></button>
    <dialog ref={dialog} className={styles.dialog} aria-labelledby={id} onClick={event => { if (event.target === event.currentTarget) { const r = event.currentTarget.getBoundingClientRect(); if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) dialog.current?.close(); } }}>
      <div className={styles.heading}><h2 id={id}>{label}</h2><button type="button" onClick={() => dialog.current?.close()} aria-label={lang === "ja" ? "閉じる" : "Close"}>×</button></div>
      {wheel ? <>
        <div className={styles.wheelFrame}>
          <div className={styles.band} />
          <div ref={scroller} className={styles.wheel} role="listbox" aria-label={label} tabIndex={0} aria-activedescendant={`${id}-${draft}`} onScroll={event => setDraft(Math.max(0, Math.min(options.length - 1, Math.round(event.currentTarget.scrollTop / 44))))} onKeyDown={event => {
            const step = event.key === "ArrowDown" ? 1 : event.key === "ArrowUp" ? -1 : 0;
            if (step || event.key === "Home" || event.key === "End") {
              event.preventDefault();
              const next = event.key === "Home" ? 0 : event.key === "End" ? options.length - 1 : Math.max(0, Math.min(options.length - 1, draft + step));
              event.currentTarget.scrollTo({ top: next * 44, behavior: "instant" }); setDraft(next);
            } else if (event.key === "Enter" || event.key === " ") { event.preventDefault(); finish(draft); }
          }}>
            {options.map((option, index) => <div id={`${id}-${index}`} key={option.value} role="option" aria-selected={draft === index} className={styles.wheelOption} onClick={() => { scroller.current?.scrollTo({ top: index * 44, behavior: "instant" }); setDraft(index); }}>{option.label}</div>)}
          </div>
        </div>
        <button type="button" className={styles.done} onClick={() => finish(scroller.current ? Math.round(scroller.current.scrollTop / 44) : draft)}>{lang === "ja" ? "決定" : "Done"}</button>
      </> : <div className={styles.list}>{options.map((option, index) => <button type="button" key={option.value} aria-pressed={value === option.value} onClick={() => finish(index)}>{option.label}<span aria-hidden="true">{value === option.value ? "✓" : ""}</span></button>)}</div>}
    </dialog>
  </>;
}
