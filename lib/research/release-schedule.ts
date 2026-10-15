import { calendarEvents } from "./calendar.ts";

export type ReleaseWatchEvent = {
  id: string; kind: "earnings" | "economic"; ticker?: string; indicator?: string;
  /** "release": results are due at `at`; "call": results are due before the call at `at`. */
  phase: "release" | "call"; at: string; titleJa: string;
  /** The time is an estimate (U.S. market close); the "not published" alert waits longer. */
  approximate?: true;
};

/** The monitor's release watch mirrors every timed calendar event. */
/** 16:00 Eastern on the day of `startsAt`, as an instant. */
function marketClose(startsAt: string): string {
  const day = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(startsAt));
  for (const offset of ["-04:00", "-05:00"]) {
    const candidate = new Date(`${day}T16:00:00${offset}`);
    const hour = new Intl.DateTimeFormat("en-GB", { timeZone: "America/New_York", hour: "2-digit", hour12: false }).format(candidate);
    if (hour === "16") return candidate.toISOString();
  }
  throw new Error("market-close-unresolved");
}

export function releaseSchedule(): ReleaseWatchEvent[] {
  return calendarEvents.flatMap(event => {
    const indicator = event.kind === "economic" ? event.id.split("-")[0] : undefined;
    const phase = /-(?:call|webcast)$/.test(event.id) ? "call" as const : "release" as const;
    const base: ReleaseWatchEvent = {
      id: event.id, kind: event.kind,
      ...(event.ticker ? { ticker: event.ticker } : {}),
      ...(indicator ? { indicator } : {}),
      phase, at: new Date(event.startsAt).toISOString(), titleJa: event.title.ja,
    };
    // Oct 15: after-close companies are watched from the market close, not only from the call.
    return event.afterClose && event.ticker
      ? [base, { id: `${event.id}-close`, kind: "earnings" as const, ticker: event.ticker, phase: "release" as const,
          at: marketClose(event.startsAt), titleJa: `${event.title.ja.replace(/ 決算説明会.*$/, "")} 決算（米国市場終了後）`, approximate: true as const }]
      : [base];
  }).sort((a, b) => a.at.localeCompare(b.at) || a.id.localeCompare(b.id));
}
