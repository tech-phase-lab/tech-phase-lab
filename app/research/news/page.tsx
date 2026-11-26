import { firstNewsWithin } from "@/lib/research/news-first-paint";
import NewsScreen from "./screen";

export const dynamic = "force-dynamic";

/** ハイテク速報. Speed, Nov 26: the page had waited for its script, then for /api/research/news and /api/research/company-wire, behind the
 * loader. The server now draws a signed-out visitor's FREE alerts into the first HTML (lib/research/news-first-paint.ts); a signed-in browser gets
 * nothing drawn and opens on its own last view (lib/research/member-last-view.ts). The screen then keeps them current as before. */
export default async function NewsPage() {
  const first = await firstNewsWithin();
  return <NewsScreen initial={first} />;
}
