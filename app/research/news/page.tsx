import { firstNewsWithin } from "@/lib/research/news-first-paint";
import NewsScreen from "./screen";

export const dynamic = "force-dynamic";

/** ハイテク速報. Speed, Nov 26: the page had waited for its script, then for /api/research/news and /api/research/company-wire, behind the
 * loader. The server now checks the session and draws this viewer's alerts into the first HTML (lib/research/news-first-paint.ts: FREE
 * gets only the FREE projection, PRO data never reaches anyone else); the screen then keeps them current as before. */
export default async function NewsPage() {
  const first = await firstNewsWithin();
  return <NewsScreen initial={first} />;
}
