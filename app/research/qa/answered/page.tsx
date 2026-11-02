import type { Metadata } from "next";
import { redirect } from "next/navigation";
export const metadata: Metadata = { title: "リゼルに聞く | Tech Phase Research", robots: { index: false, follow: false } };
/** "公開された回答" is part of the single list now: an old link to one answer goes to its question in that list. */
export default async function Page({ searchParams }: { searchParams: Promise<{ post?: string }> }) {
  const { post } = await searchParams;
  const match = typeof post === "string" ? /^qa-([a-f0-9]{32})$/.exec(post) : null;
  redirect(match ? `/research/qa#q-${match[1]}` : "/research/qa");
}
