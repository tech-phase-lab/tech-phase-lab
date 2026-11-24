import type { Metadata } from "next";
import NotFoundView from "./not-found-view";

// Production QA, Nov 24: a missing page showed the framework's bare 404. This one says so in Japanese or English and leads home.
export const metadata: Metadata = { title: "ページが見つかりません | Tech Phase", robots: { index: false, follow: false } };

export default function NotFound() {
  return <NotFoundView />;
}
