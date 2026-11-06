"use client";
import { useRef, useState } from "react";
import Link from "next/link";
import ResearchToolShell from "../research-tool-shell";
import { useResearchLanguage } from "../use-research-language";
import { useMemberDisplay, useMemberSettled, useOwnerAccount, useResearchOwner } from "../member-display-provider";
import { inLanguage, nextFeature, proFeatures, type ProFeature } from "@/lib/research/pro-experience";
import ProTag from "./pro-tag";
import styles from "./styles.module.css";

const playIcon = <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true"><path d="M2 1l7 4-7 4z" fill="currentColor" /></svg>;

/** The list (owner, Nov 5; Nov 5 again): eight features, a thumbnail on the left, the name and one line, and › on the right. */
export function ProExperienceList() {
  const [lang, setLang] = useResearchLanguage(), ja = lang === "ja";
  return <ResearchToolShell lang={lang} setLang={setLang} title={ja ? "PRO機能体験" : "PRO feature tour"} description="" showHeading={false} showTools={false}>
    <div className={styles.page}>
      <Link className={styles.back} href="/research">‹ {ja ? "メニュー" : "Menu"}</Link>
      <div className={styles.titleRow}><h1 className={styles.title}>{ja ? "PRO機能体験" : "PRO feature tour"}</h1><ProTag /></div>
      <p className={styles.lead}>{ja ? "PROでできることを、画像と動画で見られます。" : "See what you can do with PRO, in images and video."}</p>
      <ul className={styles.list}>{proFeatures.map(feature => <li key={feature.id}>
        <Link className={styles.row} href={`/research/pro-experience/${feature.id}`}>
          <span className={styles.thumb} aria-hidden="true">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            {(feature.thumbnailUrl || feature.imageUrl) && <img src={feature.thumbnailUrl || feature.imageUrl} alt="" loading="lazy" />}
            {feature.videoUrl && <span className={styles.play}>{playIcon}</span>}
          </span>
          <span><p className={styles.name}>{inLanguage(feature.name, lang)}</p><p className={styles.summary}>{inLanguage(feature.summary, lang)}</p></span>
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

/** The video loops without sound and plays on a phone; the button stops and starts it. With reduced motion it starts stopped. */
function FeatureVideo({ feature, ja }: { feature: ProFeature; ja: boolean }) {
  const video = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(true);
  const toggle = () => {
    const element = video.current;
    if (!element) return;
    if (element.paused) { void element.play().then(() => setPlaying(true), () => setPlaying(false)); } else { element.pause(); setPlaying(false); }
  };
  return <div className={styles.media}>
    <video ref={video} className={styles.video} src={feature.videoUrl} muted loop playsInline autoPlay preload="metadata" aria-label={ja ? `${feature.name.ja}の動画` : `${feature.name.en || feature.name.ja} video`}
      onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} />
    {feature.videoLabel && <span className={styles.videoLabel}>{feature.videoLabel}</span>}
    <button type="button" className={styles.pause} onClick={toggle} aria-pressed={!playing} aria-label={playing ? (ja ? "動画を止める" : "Pause video") : (ja ? "動画を再生" : "Play video")}>
      {playing ? <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"><path d="M3 2h3v10H3zM8 2h3v10H8z" fill="currentColor" /></svg> : <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"><path d="M3 1.5l9 5.5-9 5.5z" fill="currentColor" /></svg>}
    </button>
  </div>;
}

/** One feature: video, text, image, text, then "PROではじめる" (only for people who are not PRO) and the next feature. */
export function ProExperienceDetail({ id }: { id: string }) {
  const [lang, setLang] = useResearchLanguage(), ja = lang === "ja";
  const plan = useMemberDisplay(), settled = useMemberSettled(), owner = useOwnerAccount(), ownerRole = useResearchOwner();
  const feature = proFeatures.find(item => item.id === id);
  const next = nextFeature(id);
  if (!feature) return null;
  // The button is for people who are not PRO. It waits for the membership check, so a PRO member never sees it flash.
  const showStart = settled && plan !== "pro" && !owner && !ownerRole;
  const before = inLanguage(feature.textBeforeImage, lang), after = inLanguage(feature.textAfterImage, lang), caption = inLanguage(feature.imageCaption, lang);
  return <ResearchToolShell lang={lang} setLang={setLang} title={inLanguage(feature.name, lang)} description="" showHeading={false} showTools={false}>
    <div className={styles.page}>
      <Link className={styles.back} href="/research/pro-experience">‹ {ja ? "PRO機能体験" : "PRO feature tour"}</Link>
      <div className={styles.titleRow}><h1 className={styles.title}>{inLanguage(feature.name, lang)}</h1><ProTag /></div>
      {feature.videoUrl && <FeatureVideo feature={feature} ja={ja} />}
      {before && <p className={styles.text}>{before}</p>}
      {feature.imageUrl && <figure className={styles.figure}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={feature.imageUrl} alt={ja ? `${feature.name.ja}の画面` : `${feature.name.en || feature.name.ja} screen`} loading="lazy" />
        {caption && <figcaption>{caption}</figcaption>}
      </figure>}
      {after && <p className={styles.text}>{after}</p>}
      {showStart && <Link className={styles.go} href="/research/account?upgrade=1" prefetch={false}>
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" aria-hidden="true"><path d="M3 8l4.5 4L12 5l4.5 7L21 8l-2 11H5z" /></svg>{ja ? "PROではじめる" : "Start with PRO"}</Link>}
      {next && <div className={styles.nextRow}><span>{ja ? "次の機能" : "Next feature"}</span><Link className={styles.next} href={`/research/pro-experience/${next.id}`}>{inLanguage(next.name, lang)} ›</Link></div>}
    </div>
  </ResearchToolShell>;
}
