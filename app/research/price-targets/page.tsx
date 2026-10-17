"use client";
import ResearchToolShell from "../research-tool-shell";
import PriceTargetsPanel from "../price-targets-panel";
import { useResearchLanguage } from "../use-research-language";
export default function PriceTargetsPage() {
  const [lang, setLang] = useResearchLanguage();
  return <ResearchToolShell lang={lang} setLang={setLang} title={lang === "ja" ? "目標株価" : "Price targets"} description=""><PriceTargetsPanel lang={lang} /></ResearchToolShell>;
}
