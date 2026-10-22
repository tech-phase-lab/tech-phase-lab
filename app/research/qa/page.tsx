import type { Metadata } from "next";
import Questions from "./questions";
import { GET } from "../../api/research/questions/route";

export const metadata: Metadata = { title: "リゼルに聞く | Tech Phase Research", robots: { index: false, follow: false } };
export default async function Page() {
  const response = await GET();
  const data = await response.json();
  const state = response.status === 401 ? "signed-out" : response.status === 403 ? "pro-required" : response.ok && data.ok && data.audience === "pro-board" && Array.isArray(data.items) ? "ready" : "error";
  return <Questions initial={{ state, items: state === "ready" ? data.items : [], privateItems: state === "ready" ? data.privateItems || [] : [] }} />;
}
