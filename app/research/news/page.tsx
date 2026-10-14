"use client";
import ResearchToolShell from "../research-tool-shell";

import { useResearchLanguage } from "../use-research-language";
import FlashPage from "./flash-page";

export default function NewsPage() {
  const [lang, setLang] = useResearchLanguage();
  return <ResearchToolShell lang={lang} setLang={setLang} title={lang === "ja" ? "速報" : "Alerts"} description="">
    <FlashPage lang={lang} />
  </ResearchToolShell>;
}
