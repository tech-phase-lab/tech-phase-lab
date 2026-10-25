import type { Metadata } from "next";
import NotebookScreen from "./screen";

export const metadata: Metadata = { title: "銘柄手帳 | Tech Phase Research", robots: { index: false, follow: false } };
export default function Page() { return <NotebookScreen />; }
