import type { Metadata } from "next";
import EventCalendar from "./event-calendar";
import { firstCalendarWithin } from "@/lib/research/calendar-first-paint";

export const metadata: Metadata = { title: "決算・経済指標カレンダー | Tech Phase Research", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";
/** The posted results and the upcoming rows are drawn on the server (lib/research/calendar-first-paint.ts; the same for every reader). */
export default async function CalendarPage() {
  const initial = await firstCalendarWithin();
  return <EventCalendar initial={initial} drawnAt={initial?.now ?? Math.floor(Date.now() / 60_000) * 60_000} />;
}
