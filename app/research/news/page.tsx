"use client";
import ResearchToolShell from "../research-tool-shell";
import PriceTargetsPanel from "../price-targets-panel";
import { useResearchLanguage } from "../use-research-language";

export default function NewsPage() {
  const [lang, setLang] = useResearchLanguage();
  return <ResearchToolShell lang={lang} setLang={setLang} title={lang === "ja" ? "速報ニュース" : "News"} description="">
    <div id="notifications" style={{ marginTop: 24, scrollMarginTop: 90 }}><PriceTargetsPanel lang={lang} /></div>
    <p style={{ color: "#95a6b0", fontSize: 13 }}>{lang === "ja" ? "通常ニュースの配信は準備中です。" : "General news coverage is coming soon."}</p>
  </ResearchToolShell>;
}
