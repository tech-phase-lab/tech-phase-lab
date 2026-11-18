import type { Metadata } from "next";
import { headers } from "next/headers";
import Faq from "./faq";

export const metadata: Metadata = { title: "よくある質問・使い方 | Tech Phase Research", description: "Tech Phase Researchの利用方法、PRO会員、質問についてのよくある質問。" };
export default async function Page() {
  const phone = /iPhone|iPad|Android/.test((await headers()).get("user-agent") ?? "");
  return <Faq phoneRequest={phone} />;
}
