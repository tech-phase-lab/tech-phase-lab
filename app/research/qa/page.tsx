import type { Metadata } from "next";
import Questions from "./questions";

export const metadata: Metadata = { title: "リゼルに聞く | Tech Phase Research", robots: { index: false, follow: false } };
export default function Page() { return <Questions />; }
