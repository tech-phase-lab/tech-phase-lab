"use client";
import { useState } from "react";
import ResearchLoading from "../loading";
import ResearchToolShell from "../research-tool-shell";

import { useResearchLanguage } from "../use-research-language";
import FlashPage, { type FirstAlerts } from "./flash-page";

/** `initial`: the alerts the server drew into the first HTML for this viewer (page.tsx); with them the page shows at once, no loader. */
export default function NewsScreen({ initial = null }: { initial?: FirstAlerts | null }) {
  const [lang, setLang] = useResearchLanguage();
  const [ready, setReady] = useState(initial !== null && initial.wire !== null);
  // The alerts load behind the same branded loader as every other page, then appear in place (owner, Oct 20).
  return <>
    {!ready && <ResearchLoading />}
    <div hidden={!ready}>
      <ResearchToolShell lang={lang} setLang={setLang} eyebrow="TECH ALERTS" title={lang === "ja" ? "ハイテク速報" : "Tech Alerts"} description="" freshness>
        <FlashPage lang={lang} initial={initial} onReady={() => setReady(true)} />
      </ResearchToolShell>
    </div>
  </>;
}
