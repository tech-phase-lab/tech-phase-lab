import type { Metadata } from "next";
import rawSnapshot from "@/lib/research/intake-snapshot.json";
import { snapshotIssues, type IntakeSnapshot } from "@/lib/research/intake";
import { events } from "@/lib/research/content-server";
import IntakeDashboard from "./intake-dashboard";
import { requireOperatorPage } from "@/lib/membership/operator-page";

export const metadata: Metadata = {
  title: "資料の取得・確認状況 | Tech Phase Research",
  description: "公式発表の自動監視と取得記録を確認する運営用プレビュー。",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

export default async function IntakePage() {
  await requireOperatorPage();
  const snapshot = rawSnapshot as IntakeSnapshot;
  const issues = snapshotIssues(snapshot);
  if (issues.length) throw new Error(`Invalid intake snapshot: ${issues.join(", ")}`);
  const titles = Object.fromEntries([...snapshot.sources.filter(s => s.title).map(s => [s.url, s.title!]), ...events.flatMap(e => e.sources.map(s => [s.url, s.title]))]);
  return <IntakeDashboard snapshot={snapshot} titles={titles} />;
}
