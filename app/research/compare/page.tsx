import ComparisonScreen from "./screen";

// This page is built per request; only the research home is prerendered (owner, Oct 22: faster app open).
export const dynamic = "force-dynamic";
export const metadata = { title: "銘柄比較 | Tech Phase PRO" };
export default function Page() { return <ComparisonScreen />; }
