import type { Metadata } from "next";
import rawSnapshot from "@/lib/research/intake-snapshot.json";
import { snapshotIssues, type IntakeSnapshot } from "@/lib/research/intake";
import { events } from "@/lib/research/data";
import IntakeDashboard from "./intake-dashboard";

export const metadata: Metadata = {
  title: "資料の取得・確認状況 | Tech Phase Research",
  description: "取得記録を確認する運営用プレビュー。常時監視ではありません。",
  robots: { index: false, follow: false },
};

export default function IntakePage() {
  const snapshot = rawSnapshot as IntakeSnapshot;
  const issues = snapshotIssues(snapshot);
  if (issues.length) throw new Error(`Invalid intake snapshot: ${issues.join(", ")}`);
  const titles = Object.fromEntries([...snapshot.sources.filter(s => s.title).map(s => [s.url, s.title!]), ...events.flatMap(e => e.sources.map(s => [s.url, s.title]))]);
  return <IntakeDashboard snapshot={snapshot} titles={titles} />;
}
