import type { Metadata } from "next";
import EditorialEditor from "./editor";

// This page is built per request; only the research home is prerendered (owner, Oct 22: faster app open).
export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "定期記事の編集 | Tech Phase Research", robots: { index: false, follow: false } };
export default function Page() { return <EditorialEditor />; }
