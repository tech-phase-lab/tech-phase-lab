"use client";
import { useState } from "react";
import ResearchLoading from "../loading";
import ResearchToolShell from "../research-tool-shell";

import { useResearchLanguage } from "../use-research-language";
import FlashPage from "./flash-page";

export default function NewsPage() {
  const [lang, setLang] = useResearchLanguage();
  const [ready, setReady] = useState(false);
  // The alerts load behind the same branded loader as every other page, then appear in place (owner, Oct 20).
  return <>
    {!ready && <ResearchLoading />}
    <div hidden={!ready}>
      <ResearchToolShell lang={lang} setLang={setLang} title={lang === "ja" ? "ハイテク速報" : "Tech Alerts"} description="" freshness>
        <FlashPage lang={lang} onReady={() => setReady(true)} />
      </ResearchToolShell>
    </div>
  </>;
}
