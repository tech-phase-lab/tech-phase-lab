import type { Metadata } from "next";
import Questions, { type QuestionsInitial } from "./questions";
import { GET } from "../../api/research/questions/route";
import { firstAnswer } from "@/lib/research/first-answer";
export const metadata: Metadata = { title: "リゼルに聞く | Tech Phase Research", robots: { index: false, follow: false } };
// The first page of questions is read on the server with the reader's own sign-in (the same route and checks as the browser's request), so
// the board is in the first paint instead of a 「読み込み中…」 step (owner, Nov 21). A slow or refused answer leaves it to the browser.
export default async function Page() {
  const data = await firstAnswer(() => GET(new Request("https://tech-phase.internal/api/research/questions?page=1")));
  const initial: QuestionsInitial | undefined = data && data.ok === true && data.audience === "pro-board" && Array.isArray(data.items)
    ? { items: data.items as QuestionsInitial["items"], hasNext: data.hasNext === true, limit: Number.isInteger(data.limit) ? data.limit as number : null, left: Number.isInteger(data.left) ? data.left as number : null }
    : undefined;
  return <Questions initial={initial} />;
}
