"use client";
import { useEffect, useState, useSyncExternalStore } from "react";
import type { Language } from "@/lib/research/data";
import { availableNewsPayload, type GeneralNewsFeed } from "@/lib/research/general-news";
import { parseCompanyWire, type CompanyWireItem } from "@/lib/research/company-wire";
import { freshByCompany, readSeen } from "@/lib/research/company-freshness";
import { observePageActivity } from "@/lib/research/page-activity";

const subscribe = (callback: () => void) => {
  window.addEventListener("storage", callback); window.addEventListener("tech-phase:company-seen", callback);
  return () => { window.removeEventListener("storage", callback); window.removeEventListener("tech-phase:company-seen", callback); };
};
const seenSnapshot = () => { try { return localStorage.getItem("tech-phase:company-seen:v1") ?? "{}"; } catch { return "{}"; } };

/** Which monitored companies have something new, read from the same feeds the
 * company pages use. Reads only; nothing here changes delivery. */
export function useFreshCompanies(lang: Language) {
  const [feed, setFeed] = useState<GeneralNewsFeed | null>(null);
  const [wire, setWire] = useState<Record<string, CompanyWireItem[]>>({});
  const [now, setNow] = useState(0);
  const seenRaw = useSyncExternalStore(subscribe, seenSnapshot, () => "{}");
  useEffect(() => {
    let alive = true, timer: ReturnType<typeof setInterval> | undefined;
    const load = async () => {
      try {
        const [news, wired] = await Promise.allSettled([
          fetch("/api/research/news", { cache: "no-store" }).then(response => response.ok ? response.json() : Promise.reject(new Error("news"))),
          fetch("/api/research/company-wire", { cache: "no-store" }).then(response => response.ok ? response.json() : Promise.reject(new Error("wire"))),
        ]);
        if (!alive) return;
        if (news.status === "fulfilled") setFeed(availableNewsPayload(news.value));
        if (wired.status === "fulfilled") setWire(parseCompanyWire(wired.value).items);
        setNow(Date.now());
      } catch { /* keep what is shown */ }
    };
    const stop = observePageActivity(() => { void load(); timer ??= setInterval(load, 60_000); }, () => { clearInterval(timer); timer = undefined; });
    void load(); timer = setInterval(load, 60_000);
    return () => { alive = false; clearInterval(timer); stop(); };
  }, []);
  void seenRaw; // re-evaluate when a company is opened
  return now ? freshByCompany(feed, wire, lang, readSeen(), now) : new Map<string, number>();
}
