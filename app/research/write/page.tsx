import Writer from "./writer";

// This page is built per request; only the research home is prerendered (owner, Oct 22: faster app open).
export const dynamic = "force-dynamic";
export const metadata = { title: "ひとりごとを書く | Tech Phase", robots: { index: false, follow: false } };
export default function Page() { return <Writer />; }
