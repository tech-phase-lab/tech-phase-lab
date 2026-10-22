import type { Metadata } from "next";
import ReviewDashboard from "./review-dashboard";


// This page is built per request; only the research home is prerendered (owner, Oct 22: faster app open).
export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "速報レビュー | Tech Phase Research",
  robots: { index: false, follow: false },
};

export default function ReviewPage() {
  return <ReviewDashboard />;
}
