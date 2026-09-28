import type { Metadata } from "next";
import ColumnsPage from "../../columns/columns";
export const metadata: Metadata = { title: "公開されたリサーチQ&A | Tech Phase Research" };
export default function Page() { return <ColumnsPage initialKind="qa" />; }
