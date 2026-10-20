"use client";
import ResearchToolShell from "../research-tool-shell";
import { useResearchLanguage } from "../use-research-language";
import FlashSkeleton from "./flash-skeleton";

/** Same title and skeleton as the loaded page starts with, so opening the alerts shows one continuous loading state. */
export default function NewsLoading() {
  const [lang, setLang] = useResearchLanguage();
  return <ResearchToolShell lang={lang} setLang={setLang} title={lang === "ja" ? "ハイテク速報" : "Tech Alerts"} description="">
    <FlashSkeleton ja={lang === "ja"} />
  </ResearchToolShell>;
}
