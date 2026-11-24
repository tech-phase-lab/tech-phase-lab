import type { Metadata } from "next";
import { redirect } from "next/navigation";
import Landing from "./landing";

// Public, no sign-in: the address the video descriptions point to. Kept out of search until sales open.
// Rendered per request so the price switches by itself at 2027-03-01 00:00 JST (see lib/resolute/price.ts).
export const dynamic = "force-dynamic";
export const metadata: Metadata = {
 title: "RESOLUTE｜暴落の夜も、急騰の夜も、自分のルールを守る",
 description: "相場が荒れた日に立ち戻る場所を、あなたのスマホに置いておくキットです。",
 robots: { index: false, follow: false },
};
// ?lang=en (links that carry the display language) opens the English page (production QA, Nov 24).
export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
 if ((await searchParams).lang === "en") redirect("/resolute/lp/en");
 return <Landing />;
}
