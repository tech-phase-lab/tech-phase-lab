"use client";
import { useEffect, useRef, useState } from "react";
import { reloadPage } from "./site-header";
import styles from "./site-header.module.css";

const THRESHOLD = 72;

/** Pull down at the top of the page to reload (all members, touch screens). */
export default function PullToRefresh() {
  const [pull, setPull] = useState(0);
  const [loading, setLoading] = useState(false);
  const start = useRef<{ x: number; y: number } | null>(null);
  const distance = useRef(0);
  useEffect(() => {
    const blocked = () => document.body.style.position === "fixed"
      || !!document.querySelector("input:focus,textarea:focus,[contenteditable=true]:focus");
    const down = (event: TouchEvent) => {
      start.current = window.scrollY <= 0 && event.touches.length === 1 && !blocked()
        ? { x: event.touches[0].clientX, y: event.touches[0].clientY } : null;
    };
    const move = (event: TouchEvent) => {
      if (!start.current) return;
      const dy = event.touches[0].clientY - start.current.y;
      const dx = Math.abs(event.touches[0].clientX - start.current.x);
      if (window.scrollY > 0 || dy <= 0 || dx > dy) { start.current = null; distance.current = 0; setPull(0); return; }
      distance.current = Math.min(dy * 0.5, THRESHOLD * 1.4);
      setPull(distance.current);
    };
    const up = () => {
      if (!start.current) return;
      start.current = null;
      if (distance.current >= THRESHOLD) { setLoading(true); reloadPage(); }
      distance.current = 0;
      setPull(0);
    };
    window.addEventListener("touchstart", down, { passive: true });
    window.addEventListener("touchmove", move, { passive: true });
    window.addEventListener("touchend", up);
    window.addEventListener("touchcancel", up);
    return () => {
      window.removeEventListener("touchstart", down);
      window.removeEventListener("touchmove", move);
      window.removeEventListener("touchend", up);
      window.removeEventListener("touchcancel", up);
    };
  }, []);
  if (!pull && !loading) return null;
  const progress = Math.min(pull / THRESHOLD, 1);
  return <div className={`${styles.pull} ${loading ? styles.spin : ""}`} data-ready={loading || progress >= 1}
    style={{ transform: `translateY(${loading ? 24 : pull * 0.6}px)`, opacity: loading ? 1 : Math.max(progress, .25) }}
    role="status" aria-label={loading ? "Refreshing" : undefined}>
    <svg viewBox="0 0 24 24" aria-hidden="true" style={loading ? undefined : { transform: `rotate(${progress * 300}deg)` }}><path d="M20 12a8 8 0 1 1-2.6-5.9M20 4v5h-5" /></svg>
  </div>;
}
