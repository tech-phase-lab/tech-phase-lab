"use client";

import { useRef, useState, type ReactNode, type PointerEvent } from "react";
import styles from "./swipe-row.module.css";

export function TrashIcon() {
  return <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 10v7M14 10v7" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}

// Horizontal gestures reveal an action; a swipe alone never deletes a stock.
export default function SwipeRow({ children, open, onOpenChange, onRemove, removeLabel, disabled = false }: {
  children: ReactNode; open: boolean; onOpenChange: (open: boolean) => void;
  onRemove: () => boolean | void; removeLabel: string; disabled?: boolean;
}) {
  const gesture = useRef<{ id: number; x: number; y: number; start: number; offset: number; horizontal: boolean } | null>(null);
  const suppressClick = useRef(false);
  const [offset, setOffset] = useState<number | null>(null);
  function finish(event: PointerEvent<HTMLDivElement>, cancelled = false) {
    const current = gesture.current;
    if (!current || current.id !== event.pointerId) return;
    gesture.current = null;
    if (current.horizontal) {
      suppressClick.current = true;
      if (!cancelled) onOpenChange(current.offset <= -32);
    }
    setOffset(null);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  }
  return <div className={styles.frame} onKeyDownCapture={event => {
    if (event.key === "ArrowLeft" && !disabled) { event.preventDefault(); onOpenChange(true); }
    if (event.key === "ArrowRight" || event.key === "Escape") { event.preventDefault(); onOpenChange(false); }
  }}>
    <button type="button" className={styles.remove} disabled={disabled} tabIndex={open ? 0 : -1} aria-hidden={!open} aria-label={removeLabel} onClick={() => { if (onRemove() !== false) onOpenChange(false); }}><TrashIcon /></button>
    <div className={styles.surface} data-dragging={offset !== null} style={{ transform: `translateX(${disabled ? 0 : offset ?? (open ? -72 : 0)}px)` }}
      onPointerDown={event => {
        suppressClick.current = false;
        if (disabled || !event.isPrimary || event.button !== 0) return;
        gesture.current = { id: event.pointerId, x: event.clientX, y: event.clientY, start: open ? -72 : 0, offset: open ? -72 : 0, horizontal: false };
      }}
      onPointerMove={event => {
        const current = gesture.current;
        if (!current || current.id !== event.pointerId) return;
        const dx = event.clientX - current.x, dy = event.clientY - current.y;
        if (!current.horizontal) {
          if (Math.abs(dy) > 10 && Math.abs(dy) >= Math.abs(dx)) { gesture.current = null; return; }
          if (Math.abs(dx) < 10 || Math.abs(dx) <= Math.abs(dy) * 1.3) return;
          current.horizontal = true;
          event.currentTarget.setPointerCapture(event.pointerId);
        }
        current.offset = Math.max(-72, Math.min(0, current.start + dx));
        setOffset(current.offset);
      }}
      onPointerUp={event => finish(event)} onPointerCancel={event => finish(event, true)}
      onClickCapture={event => {
        if (suppressClick.current) { event.preventDefault(); event.stopPropagation(); suppressClick.current = false; return; }
        if (open) { event.preventDefault(); event.stopPropagation(); onOpenChange(false); }
      }}>
      {children}
    </div>
  </div>;
}
