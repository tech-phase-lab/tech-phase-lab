"use client";

import ResearchToolShell from "../research-tool-shell";
import { useResearchLanguage } from "../use-research-language";
import GeneralNewsPanel from "../news/general-news-panel";
import { useMemberDisplay, useMemberSettled, useOwnerAccount, useResearchOwner } from "../member-display-provider";

import type { InitialNewsSnapshot } from "@/lib/research/general-news";

/** `initialNews`: this viewer's feed, drawn into the first HTML by the server (page.tsx). */
export default function GeneralNewsScreen({ initialNews = null }: { initialNews?: InitialNewsSnapshot | null }) {
  const [lang, setLang] = useResearchLanguage();
  // Whether this device may show and keep its last view of the page (lib/research/member-last-view.ts): only once the membership check
  // confirmed PRO (or an owner account); "none" once it answered otherwise.
  const memberPlan = useMemberDisplay(), memberSettled = useMemberSettled(), ownerAccount = useOwnerAccount(), ownerRole = useResearchOwner();
  const keepPlan = !memberSettled ? undefined : memberPlan === "pro" || ownerAccount || ownerRole ? "pro" : "none";
  return <ResearchToolShell lang={lang} setLang={setLang} eyebrow="TOPICS" title={lang === "ja" ? "注目トピック" : "Top Topics"} description="" freshness>
    <GeneralNewsPanel lang={lang} generalOnly initialNews={initialNews} keepPlan={keepPlan} />
  </ResearchToolShell>;
}
