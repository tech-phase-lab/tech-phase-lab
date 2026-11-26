import { publicPriceTargets } from "@/lib/research/price-targets";
import { readMonitor } from "@/lib/research/tech-news-server";
import PriceTargetsScreen from "./screen";

export const dynamic = "force-dynamic";

const INITIAL_WAIT_MS = 1_000;

/** 目標株価 (the same feed for every visitor, FREE included). Speed, Nov 26: the list had waited for the page's script and then for
 * /api/research/price-targets; the server now draws the monitor's feed (no provider) into the first HTML. The screen keeps it live as before. */
export default async function PriceTargetsPage() {
  const read = readMonitor("price-targets", 100_000, INITIAL_WAIT_MS).then(raw => ({ items: publicPriceTargets(raw).items, at: new Date().toISOString() })).catch(() => null);
  const initial = await Promise.race([read, new Promise<null>(resolve => setTimeout(() => resolve(null), INITIAL_WAIT_MS))]);
  return <PriceTargetsScreen initial={initial && initial.items.length ? initial : null} />;
}
