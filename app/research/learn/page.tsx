import type { Metadata } from "next";
import Guide from "./guide";

export const metadata: Metadata = {
  title: "米国株のはじめ方 | Tech Phase Research",
  description: "日本居住者向けの無料・米国株入門ガイド。口座選び、注文、決算の読み方を順番に確認できます。",
};

export default function Page() { return <Guide />; }
