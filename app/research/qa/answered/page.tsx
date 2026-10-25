import type { Metadata } from "next";
import ColumnsPage from "../../columns/columns";
export const metadata: Metadata = { title: "リゼルに聞く｜公開回答 | Tech Phase Research" };
export default function Page() { return <ColumnsPage initialKind="qa" />; }
