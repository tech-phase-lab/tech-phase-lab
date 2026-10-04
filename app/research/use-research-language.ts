"use client";

import { useEffect, useSyncExternalStore } from "react";
import type { Language } from "@/lib/research/data";

const key = "tech-phase:research-language:v1";
const eventName = "tech-phase:research-language";
let sessionLanguage: Language | undefined;

function snapshot(): Language {
  if (sessionLanguage) return sessionLanguage;
  try { return localStorage.getItem(key) === "en" ? "en" : "ja"; }
  catch { return "ja"; }
}
function subscribe(notify: () => void) {
  const onStorage = (event: StorageEvent) => {
    if (event.key === key || event.key === null) { sessionLanguage = undefined; notify(); }
  };
  window.addEventListener("storage", onStorage);
  window.addEventListener(eventName, notify);
  return () => { window.removeEventListener("storage", onStorage); window.removeEventListener(eventName, notify); };
}

export function useResearchLanguage() {
  const lang = useSyncExternalStore(subscribe, snapshot, () => "ja" as Language);
  useEffect(() => {
    const previous = document.documentElement.lang;
    document.documentElement.lang = lang;
    return () => { document.documentElement.lang = previous; };
  }, [lang]);
  function setLang(value: Language) {
    sessionLanguage = value;
    try { localStorage.setItem(key, value); } catch { /* Language still changes for this session. */ }
    window.dispatchEvent(new Event(eventName));
  }
  return [lang, setLang] as const;
}
