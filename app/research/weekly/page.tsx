import type { Metadata } from "next";
import WeeklyIssues, { ownerState, type WeeklyInitial } from "./issues";
import { GET } from "../../api/research/weekly-issues/route";
import { firstAnswer } from "@/lib/research/first-answer";
import { getMembership } from "@/lib/membership/server";
export const metadata: Metadata = { title: "週刊 Tech Phase PRO", robots: { index: false, follow: false } };
// The first page is read on the server with the reader's own sign-in (the same route and checks as the browser's request), so the issue is
// in the first paint instead of a 「読み込み中…」 step (owner, Nov 21). A slow or refused answer leaves it to the browser, as before.
// For the owner the drafts are read the same way, so the page opens on the draft to review instead of first showing
// 「まだ公開された号はありません」 and then jumping (owner, Nov 21).
export default async function Page() {
  const member = await getMembership().catch(() => null);
  const owner = member?.status === "signed-in" && member.isAdmin === true && member.ownerMode === true;
  const [data, drafts] = await Promise.all([
    firstAnswer(() => GET(new Request("https://tech-phase.internal/api/research/weekly-issues?limit=6"))),
    owner ? firstAnswer(() => GET(new Request("https://tech-phase.internal/api/research/weekly-issues?view=owner"))) : Promise.resolve(undefined),
  ]);
  const initial: WeeklyInitial | undefined = data && data.ok !== false && Array.isArray(data.issues) ? { issue: (data.issue ?? null) as WeeklyInitial["issue"], latest: typeof data.latest === "number" ? data.latest : null, issues: data.issues as WeeklyInitial["issues"], hasMore: data.hasMore === true } : undefined;
  return <WeeklyIssues initial={initial} initialOwner={drafts ? ownerState(drafts) ?? undefined : undefined} />;
}
