import { notFound } from "next/navigation";
import { themeById, THEMES } from "@/lib/research/theme-definitions";
import ThemeDetailScreen from "../detail";

export const dynamicParams = false;
export function generateStaticParams() { return THEMES.map(theme => ({ id: theme.id })); }
export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return { title: `${themeById(id)?.ja ?? "テーマ"} | テーマランキング | Tech Phase PRO`, robots: { index: false, follow: false } };
}
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!themeById(id)) notFound();
  return <ThemeDetailScreen id={id} />;
}
