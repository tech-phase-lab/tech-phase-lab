import { firstNewsWithin } from "@/lib/research/news-first-paint";
import NewsScreen from "./screen";

export const dynamic = "force-dynamic";

/** ハイテク速報. Speed, Nov 26: the page had waited for its script, then for /api/research/news and /api/research/company-wire, behind the
 * loader. The server now draws the FREE alerts (the same for every reader, nothing member-only) into the first HTML (lib/research/news-first-paint.ts):
 * visitors and FREE members see them at once; a browser remembering PRO hides them and reads its own. The screen keeps them current. */
export default async function NewsPage() {
  const first = await firstNewsWithin();
  return <NewsScreen initial={first} />;
}
