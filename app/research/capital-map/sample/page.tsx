import CapitalMap from "../screen";
import { capitalMapSamples } from "@/lib/research/capital-map-sample";

// This page is built per request; only the research home is prerendered (owner, Oct 22: faster app open).
export const dynamic = "force-dynamic";
export const metadata = { title: "資本マップ表示サンプル | Tech Phase Research", robots: { index: false, follow: false } };
export default function Page() { return <CapitalMap portfolios={capitalMapSamples} />; }
