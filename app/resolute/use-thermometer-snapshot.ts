"use client";
import { useEffect, useState } from 'react';
import { expireThermometerSnapshot, type ThermometerSnapshot } from '@/lib/resolute/thermometer-view';
/** Shared freshness handling for the home card and the detailed gauge. */
export function useThermometerSnapshot(snapshot?: ThermometerSnapshot) {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    if (snapshot?.validUntil === undefined) return;
    const check = () => setNow(Date.now());
    check();
    const timer = setInterval(check, 30000);
    window.addEventListener('focus', check);
    return () => { clearInterval(timer); window.removeEventListener('focus', check); };
  }, [snapshot?.validUntil]);
  return now === null ? snapshot : expireThermometerSnapshot(snapshot, now);
}
