import type { Metadata } from "next";
import EditorialEditor from "./editor";
import { requireOperatorPage } from "@/lib/membership/operator-page";
export const metadata: Metadata = { title: "定期記事の編集 | Tech Phase Research", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";
export default async function Page() { await requireOperatorPage(); return <EditorialEditor />; }
