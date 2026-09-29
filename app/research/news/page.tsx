"use client";
import ResearchToolShell from "../research-tool-shell";

import { useResearchLanguage } from "../use-research-language";
import NewsFeed from "./news-feed";

export default function NewsPage() {
  const [lang, setLang] = useResearchLanguage();
  return <ResearchToolShell lang={lang} setLang={setLang} title={lang === "ja" ? "速報ニュース" : "News"} description="">
    <NewsFeed lang={lang} />
  </ResearchToolShell>;
}
