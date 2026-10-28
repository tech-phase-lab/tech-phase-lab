"use client";

import ResearchToolShell from "../research-tool-shell";
import { useResearchLanguage } from "../use-research-language";
import GeneralNewsPanel from "../news/general-news-panel";

export default function GeneralNewsPage() {
  const [lang, setLang] = useResearchLanguage();
  return <ResearchToolShell lang={lang} setLang={setLang} title={lang === "ja" ? "一般ニュース" : "General News"} description="" freshness>
    <GeneralNewsPanel lang={lang} generalOnly />
  </ResearchToolShell>;
}
