"use client";
import type { ReactNode } from "react";
import ResearchToolShell from "../research/research-tool-shell";
import { useResearchLanguage } from "../research/use-research-language";

/** The same header and navy page as the rest of Tech Phase, without the tools sidebar. */
export default function LegalScreen({ children }: { children: ReactNode }) {
  const [lang, setLang] = useResearchLanguage();
  return <ResearchToolShell lang={lang} setLang={setLang} title="" description="" showHeading={false} showTools={false}>{children}</ResearchToolShell>;
}
