import CapitalMap from "../screen";
import { capitalMapSamples } from "@/lib/research/capital-map-sample";
export const metadata = { title: "資本マップ表示サンプル | Tech Phase Research", robots: { index: false, follow: false } };
export default function Page() { return <CapitalMap portfolios={capitalMapSamples} />; }
