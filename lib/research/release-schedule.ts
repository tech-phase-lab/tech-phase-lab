import { calendarEvents } from "./calendar.ts";

export type ReleaseWatchEvent = {
  id: string; kind: "earnings" | "economic"; ticker?: string; indicator?: string;
  /** "release": results are due at `at`; "call": results are due before the call at `at`. */
  phase: "release" | "call"; at: string; titleJa: string;
};

/** The monitor's release watch mirrors every timed calendar event. */
export function releaseSchedule(): ReleaseWatchEvent[] {
  return calendarEvents.map(event => {
    const indicator = event.kind === "economic" ? event.id.split("-")[0] : undefined;
    const phase = /-(?:call|webcast)$/.test(event.id) ? "call" as const : "release" as const;
    return {
      id: event.id, kind: event.kind,
      ...(event.ticker ? { ticker: event.ticker } : {}),
      ...(indicator ? { indicator } : {}),
      phase, at: new Date(event.startsAt).toISOString(), titleJa: event.title.ja,
    };
  }).sort((a, b) => a.at.localeCompare(b.at) || a.id.localeCompare(b.id));
}
