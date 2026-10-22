import type { Metadata } from "next";
import ReviewDashboard from "./review-dashboard";

export const metadata: Metadata = {
  title: "速報レビュー | Tech Phase Research",
  robots: { index: false, follow: false },
};

export default function ReviewPage() {
  return <ReviewDashboard />;
}
