import type { Metadata } from "next";
import WeeklyIssues from "./issues";
export const metadata: Metadata = { title: "週刊 Tech Phase PRO", robots: { index: false, follow: false } };
export default function Page() { return <WeeklyIssues />; }
