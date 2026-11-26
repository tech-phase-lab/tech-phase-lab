"use client";
import { Suspense, useState } from "react";
import ResearchToolShell from "../research-tool-shell";
import PriceTargetsPanel from "../price-targets-panel";
import PriceTargetSampleQuery from "../price-target-sample-query";
import { useResearchLanguage } from "../use-research-language";
import type { PriceTarget } from "@/lib/research/price-targets";
export default function PriceTargetsPage() {
  const [lang, setLang] = useResearchLanguage();
  // Nov 17 (owner): opened from the sample notice (?demo=nvda), the made-up NVDA change is shown on top, in this browser only.
  const [sample, setSample] = useState<PriceTarget | null>(null);
  return <ResearchToolShell lang={lang} setLang={setLang} eyebrow="PRICE TARGETS" title={lang === "ja" ? "目標株価" : "Price targets"} description={lang === "ja" ? "アナリストによる変更・過去1週間" : "Analyst changes · past week"} freshness>
    <Suspense fallback={null}><PriceTargetSampleQuery onSample={setSample} /></Suspense>
    <PriceTargetsPanel lang={lang} sample={sample} heading={false} />
  </ResearchToolShell>;
}
