import type { Metadata } from "next";
import EditorialEditor from "./editor";
export const metadata: Metadata = { title: "定期記事の編集 | Tech Phase Research", robots: { index: false, follow: false } };
export default function Page() { return <EditorialEditor />; }
