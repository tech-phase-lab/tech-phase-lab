import type { Metadata } from "next";
import ColumnsPage from "../../columns/columns";
export const metadata: Metadata = { title: "リゼルに聞く｜公開回答 | Tech Phase Research" };
export default async function Page({ searchParams }: { searchParams: Promise<{ post?: string }> }) {
  const { post } = await searchParams;
  return <ColumnsPage key={post || "all"} initialKind="qa" postId={typeof post === "string" && /^[a-z0-9-]{16,64}$/.test(post) ? post : undefined} />;
}
