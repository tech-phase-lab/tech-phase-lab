"use client";
import { useLayoutEffect, useRef } from "react";
import styles from "./page-heading.module.css";

const START_PX = 13, MIN_PX = 10.5, STEP_PX = 0.5;
/** The description stays on one line: on a narrow screen its text size shrinks a little (never below 10.5px) instead of wrapping. */
export default function PageHeading({ eyebrow, title, description, titleId }: { eyebrow: string; title: string; description?: string; titleId?: string }) {
  const text = useRef<HTMLParagraphElement>(null);
  useLayoutEffect(() => {
    const target = text.current;
    if (!target) return;
    let frame = 0;
    const fit = () => {
      frame = 0;
      let size = START_PX;
      target.style.fontSize = `${size}px`;
      while (size > MIN_PX && target.scrollWidth > target.clientWidth) { size -= STEP_PX; target.style.fontSize = `${size}px`; }
    };
    const request = () => { if (!frame) frame = requestAnimationFrame(fit); };
    fit();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(request);
    observer?.observe(target);
    void document.fonts?.ready.then(request);
    return () => { observer?.disconnect(); if (frame) cancelAnimationFrame(frame); };
  }, [description]);
  return <header className={styles.head}>
    <p className={styles.eyebrow}>{eyebrow}</p>
    <h1 id={titleId}>{title}</h1>
    {description && <p ref={text} className={styles.desc}>{description}</p>}
  </header>;
}
