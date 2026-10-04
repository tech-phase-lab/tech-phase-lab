"use client";
import { createContext, useContext, useEffect, useState, type ComponentProps, type ReactNode } from "react";
import ResearchDashboard from "./research-dashboard";
import type { InitialNewsSnapshot } from "@/lib/research/general-news";
import type { ResearchEvent } from "@/lib/research/data";
import { deduplicateResearchEvents } from "@/lib/research/deduplicate-events";

type LiveSnapshot = { events: ResearchEvent[]; news: InitialNewsSnapshot | null };
const LiveEvents = createContext<(snapshot: LiveSnapshot) => void>(() => {});
/** Keep the usable dashboard mounted while server data streams in behind it. */
export default function HomeDashboard({ children, events, ...props }: ComponentProps<typeof ResearchDashboard> & { children: ReactNode }) {
  const [live, setLive] = useState<LiveSnapshot>({ events: [], news: null });
  const combined = deduplicateResearchEvents([...live.events, ...events]).toSorted((a, b) => b.publishedOn.localeCompare(a.publishedOn) || a.id.localeCompare(b.id));
  return <LiveEvents.Provider value={setLive}><ResearchDashboard {...props} events={combined} initialNews={live.news} />{children}</LiveEvents.Provider>;
}
export function LiveHomeUpdate({ events, news }: LiveSnapshot) {
  const update = useContext(LiveEvents);
  useEffect(() => { update({ events, news }); }, [events, news, update]);
  return null;
}
