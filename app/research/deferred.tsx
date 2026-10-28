"use client";
import { useEffect, useState, type ReactNode } from "react";

/** Draws its children only once the browser has a quiet moment (at most `within` ms later), so the heavy parts of the home
 * page below the first screen do not delay the header and menu becoming usable (owner, Oct 28: menu slow after reload). */
export default function Deferred({ children, fallback = null, within = 1500 }: { children: ReactNode; fallback?: ReactNode; within?: number }) {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const idle = (window as Window & { requestIdleCallback?: (run: () => void, options?: { timeout: number }) => number; cancelIdleCallback?: (id: number) => void });
    if (idle.requestIdleCallback) {
      const id = idle.requestIdleCallback(() => setReady(true), { timeout: within });
      return () => idle.cancelIdleCallback?.(id);
    }
    const id = window.setTimeout(() => setReady(true), 200);
    return () => window.clearTimeout(id);
  }, [within]);
  return <>{ready ? children : fallback}</>;
}
