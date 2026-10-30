"use client";
import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";
import ResearchToolShell from "../research-tool-shell";
import { useResearchLanguage } from "../use-research-language";
import styles from "./account.module.css";

const back = <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#e7c982" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M15 5l-7 7 7 7" /></svg>;

/** Owner-only pages: the shell, the back link, and a check that the signed-in member is the owner. */
export default function OwnerGate({ kicker, title, children }: { kicker: string; title: string; children: (ja: boolean) => ReactNode }) {
  const [lang, setLang] = useResearchLanguage();
  const ja = lang === "ja";
  const [state, setState] = useState<"checking" | "owner" | "denied" | "error">("checking");
  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/research/member", { cache: "no-store", credentials: "same-origin", signal: AbortSignal.any([controller.signal, AbortSignal.timeout(10_000)]) })
      .then(async response => { const value = await response.json(); if (!controller.signal.aborted) setState(response.ok && value.status === "signed-in" && value.isAdmin === true ? "owner" : response.ok ? "denied" : "error"); })
      .catch(() => { if (!controller.signal.aborted) setState("error"); });
    return () => controller.abort();
  }, []);
  return <ResearchToolShell showTools={false} showHeading={false} lang={lang} setLang={setLang} title={title} description="">
    <div className={styles.page}>
      <Link className={styles.back} href="/research/account">{back}{ja ? "運営者メニュー" : "Owner menu"}</Link>
      <div className={`${styles.kick} ${styles.kickGold}`} style={{ marginTop: 10 }}>{kicker}</div>
      <h1 className={styles.h1}>{title}</h1>
      {state === "checking" && <div className={styles.skel} style={{ marginTop: 20 }} aria-busy="true" />}
      {state === "denied" && <p className={styles.note} style={{ marginTop: 20 }}>{ja ? "この画面は運営者だけが開けます。" : "Only the owner can open this page."}</p>}
      {state === "error" && <p className={styles.note} style={{ marginTop: 20 }}>{ja ? "運営者の確認ができませんでした。時間をおいて、もう一度お試しください。" : "Could not verify the owner. Try again shortly."}</p>}
      {state === "owner" && children(ja)}
    </div>
  </ResearchToolShell>;
}
