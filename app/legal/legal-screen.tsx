"use client";
import type { ReactNode } from "react";
import ResearchToolShell from "../research/research-tool-shell";
import { useResearchLanguage } from "../research/use-research-language";
import LegalDocument from "./legal-document";
import EnglishTitle from "../research/english-title";

/** The same header and navy page as the rest of Tech Phase, without the tools sidebar. */
export default function LegalScreen({ children }: { children: ReactNode }) {
  const [lang, setLang] = useResearchLanguage();
  return <ResearchToolShell lang={lang} setLang={setLang} title="" description="" showHeading={false} showTools={false}><EnglishTitle />{children}</ResearchToolShell>;
}

/** The document in the reader's language. The English text is a translation; the Japanese text is the owner's and prevails. */
export function LegalBody({ ja, en }: { ja: string; en: string }) {
  const [lang] = useResearchLanguage();
  return <LegalDocument source={lang === "en" ? en : ja} />;
}
