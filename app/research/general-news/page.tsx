import { firstNewsWithin } from "@/lib/research/news-first-paint";
import GeneralNewsScreen from "./screen";

export const dynamic = "force-dynamic";

/** 注目トピック: a signed-out visitor's FREE feed in the first HTML (same rules as ハイテク速報, lib/research/news-first-paint.ts). */
export default async function GeneralNewsPage() {
  const first = await firstNewsWithin();
  return <GeneralNewsScreen initialNews={first ? { data: first.feed, checkedAt: first.checkedAt } : null} />;
}
