"use client";

import { useSyncExternalStore } from 'react';

const key = 'tech-phase:company-quote-visible:v1';
const eventName = 'tech-phase:company-quote-visible';
let sessionValue: boolean | undefined;

function snapshot(): boolean {
  if (sessionValue !== undefined) return sessionValue;
  try { return localStorage.getItem(key) !== 'off'; }
  catch { return true; }
}

function subscribe(notify: () => void) {
  const onStorage = (event: StorageEvent) => {
    if (event.key === key || event.key === null) {
      sessionValue = undefined;
      notify();
    }
  };
  window.addEventListener('storage', onStorage);
  window.addEventListener(eventName, notify);
  return () => {
    window.removeEventListener('storage', onStorage);
    window.removeEventListener(eventName, notify);
  };
}

// No quote iframe in SSR or hydration until the saved preference is known.
const serverSnapshot = () => null;

export function useQuoteVisibility() {
  const visible = useSyncExternalStore<boolean | null>(subscribe, snapshot, serverSnapshot);
  function setVisible(value: boolean) {
    sessionValue = value;
    try { localStorage.setItem(key, value ? 'on' : 'off'); }
    catch { /* Keep the choice for this session when storage is unavailable. */ }
    window.dispatchEvent(new Event(eventName));
  }
  return [visible, setVisible] as const;
}
