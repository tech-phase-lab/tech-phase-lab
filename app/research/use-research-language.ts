"use client";

import { useEffect, useSyncExternalStore } from "react";
import type { Language } from "@/lib/research/data";

const key = "tech-phase:research-language:v1";
const eventName = "tech-phase:research-language";
let sessionLanguage: Language | undefined;

/** First visit: follow the browser's language until the reader picks one. */
export function browserLanguage(languages: readonly string[] | undefined): Language {
  const first = (languages ?? []).find(value => typeof value === "string" && value.trim());
  return !first || /^ja\b/i.test(first) ? "ja" : "en";
}

function snapshot(): Language {
  if (sessionLanguage) return sessionLanguage;
  try {
    const saved = localStorage.getItem(key);
    if (saved === "en" || saved === "ja") return saved;
  } catch { /* Storage can be unavailable; fall back to the browser setting. */ }
  try { return browserLanguage(navigator.languages?.length ? navigator.languages : [navigator.language]); }
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
