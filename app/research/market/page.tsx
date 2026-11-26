import { peekBoardSnapshot } from "@/lib/research/market-data";
import { loadMacro } from "@/lib/research/macro";
import MarketScreen from "./screen";

export const dynamic = "force-dynamic";

/** How long the page waits for the shared copies before it opens without them (the screen then asks the APIs, as before). */
const INITIAL_WAIT_MS = 700;
const within = <T,>(task: Promise<T>): Promise<T | null> => Promise.race([task.catch(() => null), new Promise<null>(resolve => setTimeout(() => resolve(null), INITIAL_WAIT_MS))]);

/** マーケット (public; FREE and signed-out alike). Speed, Nov 26: the screen had waited for its script, then for the snapshot API, before any
 * card showed. The server now draws the cards and each tab's first chart from the same shared snapshot the API answers from (the minute job
 * keeps it; this read never asks the provider) and 原油・米国債 from the six-hour FRED copy, straight into the first HTML. */
export default async function MarketPage() {
  const [snapshot, macro] = await Promise.all([within(peekBoardSnapshot()), within(loadMacro())]);
  const initialSnapshot = snapshot && Object.keys(snapshot.quotes).length ? { quotes: snapshot.quotes, charts: snapshot.charts } : null;
  const initialMacro = macro && macro.some(item => !item.unavailable) ? macro : null;
  return <MarketScreen initialSnapshot={initialSnapshot} initialMacro={initialMacro} />;
}
