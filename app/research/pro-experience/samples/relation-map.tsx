"use client";
import type { ChainMapData } from "@/lib/research/chain-map-core";
import sample from "@/lib/research/pro-experience-samples/relation-map-nvda.json";
import { StockChainMap } from "../../stocks/stock-chain-map";

/** The real NVDA relationship map, from its saved copy: tapping a company opens its card, as on the PRO screen. */
export default function RelationMapSample({ lang }: { lang: "ja" | "en" }) {
  return <StockChainMap data={sample.data as ChainMapData} lang={lang} />;
}
