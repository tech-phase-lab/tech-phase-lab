"use client";
import { createContext, useCallback, useContext, useEffect, useRef, useState, type MouseEvent, type ReactNode } from "react";
import { SAMPLE_HINTS, SAMPLE_TIME, guardedTarget, type SampleFeature } from "@/lib/research/pro-experience-samples";
import styles from "./samples.module.css";

type Lang = "ja" | "en";
/** The small notice a sample shows instead of leaving for a real PRO screen (owner, Nov 16: 「PROで使えます」と小さく出すだけ). */
export const PRO_ONLY = { ja: "PROで使えます", en: "Available with PRO" } as const;
export const PRO_ONLY_VIEW = { ja: "PROで見られます", en: "View it with PRO" } as const;
const Notice = createContext<(text?: { ja: string; en: string }) => void>(() => {});
/** Shows the small 「PROで使えます」 notice (or another short text) inside the current sample. */
export const useProOnly = () => useContext(Notice);

/** Above the sample: 「サンプル」 on the left, the same made-up time on the right. Around it: a dotted frame. Under it: one line on what to do.
 * Inside it nothing leaves the page: any link that is not handled by the sample itself (sources, other screens) only shows the notice. */
export default function SampleFrame({ feature, lang, children }: { feature: SampleFeature; lang: Lang; children: ReactNode }) {
  const [notice, setNotice] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const show = useCallback((text: { ja: string; en: string } = PRO_ONLY) => {
    clearTimeout(timer.current);
    setNotice(text[lang]);
    timer.current = setTimeout(() => setNotice(null), 1800);
  }, [lang]);
  useEffect(() => () => clearTimeout(timer.current), []);
  // Bubbling: a control the sample handles itself has already prevented the default; every other link is stopped here.
  const guard = (event: MouseEvent<HTMLDivElement>) => {
    const link = guardedTarget(event.target as Element | null, event.defaultPrevented);
    if (!link || !event.currentTarget.contains(link)) return;
    event.preventDefault();
    show();
  };
  return <section className={styles.sample} aria-label={lang === "ja" ? "サンプル" : "Sample"}>
    <div className={styles.sampleHead}><span className={styles.sampleTag}>{lang === "ja" ? "サンプル" : "Sample"}</span><span className={styles.sampleTime}>{SAMPLE_TIME[lang]}</span></div>
    <Notice.Provider value={show}>
      <div className={styles.sampleBox} data-sample={feature} onClick={guard}>
        {children}
        {notice && <p className={styles.notice} role="status">{notice}</p>}
      </div>
    </Notice.Provider>
    <p className={styles.sampleHint}>{SAMPLE_HINTS[feature][lang]}</p>
  </section>;
}
