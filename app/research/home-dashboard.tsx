"use client";
import { createContext, useContext, useEffect, useState, type ComponentProps, type ReactNode } from "react";
import ResearchDashboard from "./research-dashboard";
import type { ResearchEvent } from "@/lib/research/data";
import { deduplicateResearchEvents } from "@/lib/research/deduplicate-events";

const LiveEvents = createContext<(events: ResearchEvent[]) => void>(() => {});
/** Keep the usable dashboard mounted while server data streams in behind it. */
export default function HomeDashboard({ children, events, ...props }: ComponentProps<typeof ResearchDashboard> & { children: ReactNode }) {
  const [live, setLive] = useState<ResearchEvent[]>([]);
  const combined = deduplicateResearchEvents([...live, ...events]).toSorted((a, b) => b.publishedOn.localeCompare(a.publishedOn) || a.id.localeCompare(b.id));
  return <LiveEvents.Provider value={setLive}><ResearchDashboard {...props} events={combined} />{children}</LiveEvents.Provider>;
}
export function LiveHomeUpdate({ events }: { events: ResearchEvent[] }) {
  const update = useContext(LiveEvents);
  useEffect(() => { update(events); }, [events, update]);
  return null;
}
