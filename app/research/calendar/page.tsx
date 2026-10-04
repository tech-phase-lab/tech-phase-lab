import type { Metadata } from "next";
import EventCalendar from "./event-calendar";

export const metadata: Metadata = { title: "決算・経済指標カレンダー | Tech Phase Research", robots: { index: false, follow: false } };
export default function CalendarPage() { return <EventCalendar />; }
