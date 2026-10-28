"use client";
import { useLayoutEffect, useRef } from "react";

/** Lock page scroll while a sheet is open and restore the exact position. */
export function useScrollLock(locked: boolean) {
  const unlockRef = useRef<(() => void) | null>(null);
  useLayoutEffect(() => {
    if (!locked) return;
    const body = document.body;
    const root = document.documentElement;
    const x = window.scrollX, y = window.scrollY;
    const previous = { position: body.style.position, top: body.style.top, left: body.style.left, width: body.style.width, overflow: body.style.overflow, rootOverflow: root.style.overflow, scrollBehavior: root.style.scrollBehavior };
    Object.assign(body.style, { position: "fixed", top: `-${y}px`, left: `-${x}px`, width: "100%", overflow: "hidden" });
    root.style.overflow = "hidden";
    let active = true;
    const unlock = () => {
      if (!active) return;
      active = false;
      Object.assign(body.style, { position: previous.position, top: previous.top, left: previous.left, width: previous.width, overflow: previous.overflow });
      root.style.overflow = previous.rootOverflow;
      root.style.scrollBehavior = "auto";
      window.scrollTo({ left: x, top: y, behavior: "instant" });
      root.style.scrollBehavior = previous.scrollBehavior;
      unlockRef.current = null;
    };
    unlockRef.current = unlock;
    return unlock;
  }, [locked]);
  return () => unlockRef.current?.();
}
