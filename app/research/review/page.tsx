import type { Metadata } from "next";
import ReviewDashboard from "./review-dashboard";
import { requireOperatorPage } from "@/lib/membership/operator-page";

export const metadata: Metadata = {
  title: "速報レビュー | Tech Phase Research",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

export default async function ReviewPage() {
  await requireOperatorPage();
  return <ReviewDashboard />;
}
