"use client";
import { useEffect, useRef, useState, type MouseEvent } from "react";
import Link from "next/link";
import ResearchToolShell from "../research-tool-shell";
import { useResearchLanguage } from "../use-research-language";
import { useMemberDisplay, useMemberSettled, useOwnerAccount, useResearchOwner } from "../member-display-provider";
import { inLanguage, nextFeature, proFeatures, videoFor, type ProFeature } from "@/lib/research/pro-experience";
import { hasSample, showStartButton } from "@/lib/research/pro-experience-samples";
import ProTag from "./pro-tag";
import FeatureIcon from "./feature-icons";
import FeatureSample from "./samples";
import styles from "./styles.module.css";

/** The one feature still shown by video (the others have a hands-on sample); only it carries 「動画で見る」 (owner's mockup, Nov 16). */
export const VIDEO_FEATURE = "phone-alerts";

/** The list (owner, Nov 5; redesigned Nov 16 from the mockup 01-list): a heading like the other pages (eyebrow, white title, no PRO tag),
 * eight features with a 56px mini screen on the left, the name and one line, and › on the right. Gold is only inside the mini screens. */
export function ProExperienceList() {
  const [lang, setLang] = useResearchLanguage(), ja = lang === "ja";
  return <ResearchToolShell lang={lang} setLang={setLang} title={ja ? "PRO機能体験" : "PRO feature tour"} description="" showHeading={false} showTools={false}>
    <div className={styles.page}>
      {/* No 「‹ メニュー」 link here (owner, Nov 16): it only went home, and a second tap on a feature page's back link landed on it. */}
      <p className={styles.eyebrow}>PRO PREVIEW</p>
      <h1 className={styles.listTitle}>{ja ? "PRO機能体験" : "PRO feature tour"}</h1>
      <p className={styles.lead}>{ja ? "PROの機能を、サンプルで実際に触って試せます。" : "Try PRO features hands-on with samples."}</p>
      <ul className={styles.list}>{proFeatures.map(feature => <li key={feature.id}>
        <Link className={styles.row} href={`/research/pro-experience/${feature.id}`}>
          <span className={styles.thumb} aria-hidden="true"><FeatureIcon id={feature.id} /></span>
          <span className={styles.rowText}><span className={styles.name}>{inLanguage(feature.name, lang)}</span><span className={styles.summary}>{inLanguage(feature.summary, lang)}</span>
            {feature.id === VIDEO_FEATURE && <span className={styles.videoPill}>{ja ? "動画で見る" : "Watch video"}</span>}</span>
          <span className={styles.chev} aria-hidden="true">›</span>
        </Link></li>)}</ul>
      {/* Not a feature page: the one difference that is only a number, in words (owner, Nov 5). Nothing here opens a page. */}
      <h2 className={styles.others}><span>{ja ? "そのほかのPROの違い" : "Other differences with PRO"}</span></h2>
      <div className={styles.diff}>
        <p className={styles.diffName}>{ja ? "ハイテク速報" : "Tech Alerts"}</p>
        <p className={styles.diffLine}><b className={styles.free}>FREE</b><span>{ja ? "30分遅れ・新着5件まで" : "30-minute delay · latest 5 updates"}</span></p>
        <p className={styles.diffLine}><b className={styles.pro}>PRO</b><span>{ja ? "リアルタイム・件数の制限なし" : "Real-time · no limit on items"}</span></p>
      </div>
    </div>
  </ResearchToolShell>;
}

/** The phone-notification video (owner, Nov 17): portrait, the full width of the column, never cropped. It does not start by itself; a tap
 * plays it (the browser's own controls). The English view shows the English video, or the Japanese one while none is set. The poster is the
 * first frame, so the box is never black before it plays. The video has no sound. */
function FeatureVideo({ feature, lang }: { feature: ProFeature; lang: "ja" | "en" }) {
  const ja = lang === "ja";
  const { src, poster } = videoFor(feature, lang);
  return <figure className={styles.videoFigure}>
    <div className={styles.media}>
      <video key={src} className={styles.video} src={src} poster={poster || undefined} controls playsInline muted preload="metadata" width={720} height={1566}
        aria-label={ja ? `${feature.name.ja}の動画` : `${feature.name.en || feature.name.ja} video`} />
    </div>
  </figure>;
}

export const LIST_HREF = "/research/pro-experience";
/** How long the back link stays locked if the navigation never completes (it normally unmounts first). */
export const BACK_LOCK_MS = 4000;

/** 「‹ PRO機能体験に戻る」 (owner, Nov 16): small grey text, no button chrome. Mint only while the finger is on it; the tap area reaches 8px past
 * the text on every side (::after) without changing the look. After the first tap it takes no more taps until the list has opened, so a
 * second tap cannot start a second navigation. The list is prefetched, so the switch is immediate. A short buzz only where the browser
 * supports it (Android; iPhone Safari has no vibration for web pages). */
export function BackToList({ ja }: { ja: boolean }) {
  const [pressed, setPressed] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const locked = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  const go = (event: MouseEvent<HTMLAnchorElement>) => {
    if (locked.current) { event.preventDefault(); return; }
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    locked.current = true;
    setLeaving(true);
    setPressed(false);
    try { if (typeof navigator.vibrate === "function") navigator.vibrate(10); } catch { /* not supported */ }
    timer.current = setTimeout(() => { locked.current = false; setLeaving(false); }, BACK_LOCK_MS);
  };
  return <Link className={styles.back} href={LIST_HREF} prefetch onClick={go} aria-disabled={leaving || undefined} data-pressed={pressed || undefined}
    onPointerDown={() => { if (!locked.current) setPressed(true); }} onPointerUp={() => setPressed(false)} onPointerCancel={() => setPressed(false)} onPointerLeave={() => setPressed(false)}>
    ‹ {ja ? "PRO機能体験に戻る" : "Back to PRO feature tour"}
  </Link>;
}

/** One feature: its sample (or, for phone notifications, the video), text, image, text, then "PROではじめる" (only for people who are not PRO)
 * and the next feature. FREE visitors read this page, so its frame and text carry no gold (owner, Nov 16); only 「PROではじめる」 is gold. */
export function ProExperienceDetail({ id }: { id: string }) {
  const [lang, setLang] = useResearchLanguage(), ja = lang === "ja";
  const plan = useMemberDisplay(), settled = useMemberSettled(), owner = useOwnerAccount(), ownerRole = useResearchOwner();
  const feature = proFeatures.find(item => item.id === id);
  const next = nextFeature(id);
  const sample = hasSample(id) ? id : null;
  if (!feature) return null;
  // The button is for people who are not PRO. It waits for the membership check, so a PRO member never sees it flash.
  const showStart = showStartButton({ settled, plan: plan ?? null, ownerAccount: owner, ownerRole });
  const before = inLanguage(feature.textBeforeImage, lang), after = inLanguage(feature.textAfterImage, lang), caption = inLanguage(feature.imageCaption, lang);
  return <ResearchToolShell lang={lang} setLang={setLang} title={inLanguage(feature.name, lang)} description="" showHeading={false} showTools={false}>
    <div className={styles.page}>
      <BackToList ja={ja} />
      <div className={styles.titleRow}><h1 className={styles.title}>{inLanguage(feature.name, lang)}</h1><ProTag tone="plain" /></div>
      {/* A feature with a sample shows the sample, never a video: the samples read only saved files (no request for real data). */}
      {sample ? <FeatureSample feature={sample} lang={lang} /> : feature.videoUrl && <FeatureVideo feature={feature} lang={lang} />}
      {/* Owner, Nov 23: a sample needs no one-line summary under it (the tour list already has it). */}
      {before && !sample && <p className={styles.text}>{before}</p>}
      {feature.imageUrl && <figure className={styles.figure}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={feature.imageUrl} alt={ja ? `${feature.name.ja}の画面` : `${feature.name.en || feature.name.ja} screen`} loading="lazy" />
        {caption && <figcaption>{caption}</figcaption>}
      </figure>}
      {after && <p className={styles.text}>{after}</p>}
      {showStart && <div className={styles.start}>
        <Link className={styles.go} href="/research/account?upgrade=1" prefetch={false}>{ja ? "PROではじめる" : "Start with PRO"}</Link>
        {sample && <p className={styles.startNote}>{ja ? "PROなら好きな銘柄で使えます" : "With PRO, use it with any stock you like"}</p>}
      </div>}
      {/* Owner, Nov 23: back to the tour on the left, the next feature on the right, on one line (the last feature leads to the first). */}
      <div className={styles.nextRow}><BackToList ja={ja} />
        {next && <Link className={styles.next} href={`/research/pro-experience/${next.id}`} aria-label={`${ja ? "次の機能" : "Next feature"}: ${inLanguage(next.name, lang)}`}>{inLanguage(next.name, lang)} ›</Link>}</div>
    </div>
  </ResearchToolShell>;
}
