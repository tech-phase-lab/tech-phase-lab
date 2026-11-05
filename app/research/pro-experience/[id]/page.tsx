import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { featureById, proFeatures } from "@/lib/research/pro-experience";
import { ProExperienceDetail } from "../screen";

export const dynamicParams = false;
export function generateStaticParams() { return proFeatures.map(feature => ({ id: feature.id })); }
export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const feature = featureById(id);
  return { title: feature ? `${feature.name.ja} | PRO機能体験` : "PRO機能体験" };
}
export default async function ProExperienceFeaturePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!featureById(id)) notFound();
  return <ProExperienceDetail id={id} />;
}
