"use client";
import ResearchToolShell from "../research-tool-shell";
import { useResearchLanguage } from "../use-research-language";
import { useMemberSettled, useOwnerMode } from "../member-display-provider";
import { postNames } from "@/lib/research/editorial-posts";
import composerStyles from "./composer.module.css";
import styles from "../columns/styles.module.css";

/** While the notes are read on the server, RIZEL'S DESK already stands in its final layout: the same header, title and menu, the owner's
 * post box at its final size and quiet placeholders where the notes go. The notes then fill in as one step (owner, Nov 18: the desk
 * opened in about three visible stages, starting with the full-screen loading mark). */
export default function NotesLoading() {
  const [lang, setLang] = useResearchLanguage();
  const ja = lang === "ja";
  const ownerMode = useOwnerMode();
  const settled = useMemberSettled();
  return <ResearchToolShell desk compactTitle lang={lang} setLang={setLang} title={postNames.notes[lang]} description={ja ? "PRO会員だけに、本音を。" : "Candid thoughts, for PRO members only."}>
    {ownerMode ? <div className={composerStyles.slot} aria-hidden="true" /> : !settled && <div className={`${composerStyles.slot} ${composerStyles.hinted}`} aria-hidden="true" />}
    <div className={styles.placeholder} role="status" aria-busy="true" aria-label={ja ? "記事を読み込んでいます" : "Loading articles"} />
  </ResearchToolShell>;
}
