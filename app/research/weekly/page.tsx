import type { Metadata } from "next";
import WeeklyIssues, { type WeeklyInitial } from "./issues";
import { GET } from "../../api/research/weekly-issues/route";
import { firstAnswer } from "@/lib/research/first-answer";
export const metadata: Metadata = { title: "週刊 Tech Phase PRO", robots: { index: false, follow: false } };
// The first page is read on the server with the reader's own sign-in (the same route and checks as the browser's request), so the issue is
// in the first paint instead of a 「読み込み中…」 step (owner, Nov 21). A slow or refused answer leaves it to the browser, as before.
export default async function Page() {
  const data = await firstAnswer(() => GET(new Request("https://tech-phase.internal/api/research/weekly-issues?limit=6")));
  const initial: WeeklyInitial | undefined = data && data.ok !== false && Array.isArray(data.issues) ? { issue: (data.issue ?? null) as WeeklyInitial["issue"], latest: typeof data.latest === "number" ? data.latest : null, issues: data.issues as WeeklyInitial["issues"], hasMore: data.hasMore === true } : undefined;
  return <WeeklyIssues initial={initial} />;
}
