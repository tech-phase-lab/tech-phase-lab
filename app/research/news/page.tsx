"use client";
import ResearchToolShell from "../research-tool-shell";
import PriceTargetsPanel from "../price-targets-panel";
import { useResearchLanguage } from "../use-research-language";
import GeneralNewsPanel from "./general-news-panel";

export default function NewsPage() {
  const [lang, setLang] = useResearchLanguage();
  return <ResearchToolShell lang={lang} setLang={setLang} title={lang === "ja" ? "速報ニュース" : "News"} description="">
    <div id="notifications" style={{ marginTop: 24, scrollMarginTop: 90 }}><PriceTargetsPanel lang={lang} /></div>
    <GeneralNewsPanel lang={lang} />
  </ResearchToolShell>;
}
