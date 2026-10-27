import type { Metadata } from "next";
import { after } from "next/server";
import { buildRadar, radarGenres } from "@/lib/research/radar";
import { loadGenreEntries, warmGenres } from "@/lib/research/radar-server";
import RadarScreen from "./screen";

export const metadata: Metadata = { title: "財務レーダー | Tech Phase", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

/** The first genre's dots are drawn into the page itself, so the chart is there the moment the page opens. This is public
 * data only (positions, colours, sizes); whether the visitor is PRO is settled afterwards by the API, which adds the rest.
 * If the figures are not ready within a moment, the page opens anyway and the screen fetches them. */
export default async function Page() {
  const first = radarGenres[0].id;
  const ready = loadGenreEntries(first).then(entries => buildRadar(first, entries, "free")).catch(() => null);
  const initial = await Promise.race([ready, new Promise<null>(resolve => setTimeout(() => resolve(null), 2500))]);
  after(() => warmGenres(first));
  return <RadarScreen initial={initial} />;
}
