import type { Metadata } from "next";
import EventCalendar from "./event-calendar";


// This page is built per request; only the research home is prerendered (owner, Oct 22: faster app open).
export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "決算・経済指標カレンダー | Tech Phase Research", robots: { index: false, follow: false } };
export default function CalendarPage() { return <EventCalendar />; }
