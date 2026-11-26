"use client";

import ResearchToolShell from "../research-tool-shell";
import { useResearchLanguage } from "../use-research-language";
import GeneralNewsPanel from "../news/general-news-panel";

import type { InitialNewsSnapshot } from "@/lib/research/general-news";

/** `initialNews`: this viewer's feed, drawn into the first HTML by the server (page.tsx). */
export default function GeneralNewsScreen({ initialNews = null }: { initialNews?: InitialNewsSnapshot | null }) {
  const [lang, setLang] = useResearchLanguage();
  return <ResearchToolShell lang={lang} setLang={setLang} eyebrow="TOPICS" title={lang === "ja" ? "注目トピック" : "Top Topics"} description="" freshness>
    <GeneralNewsPanel lang={lang} generalOnly initialNews={initialNews} />
  </ResearchToolShell>;
}
