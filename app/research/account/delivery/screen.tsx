"use client";
import { useEffect, useState } from "react";
import type { MonitorState } from "@/lib/research/use-live-intake";
import OwnerGate from "../owner-gate";
import styles from "../account.module.css";

const stamp = (iso: string | null | undefined) => {
  const ms = iso ? Date.parse(iso) : NaN;
  return Number.isFinite(ms) ? new Intl.DateTimeFormat("ja-JP", { timeZone: "Asia/Tokyo", year: "numeric", month: "long", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false }).format(ms) : null;
};

function Delivery({ ja }: { ja: boolean }) {
  const t = (a: string, b: string) => ja ? a : b;
  const [monitor, setMonitor] = useState<MonitorState | null | undefined>(undefined);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/research/live", { cache: "no-store", signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15_000)]) })
      .then(async response => { const value = await response.json(); if (!controller.signal.aborted) setMonitor(response.ok && value?.mode === "automatic" && value.monitor ? value.monitor as MonitorState : null); })
      .catch(() => { if (!controller.signal.aborted) setMonitor(null); });
    return () => controller.abort();
  }, [attempt]);
  const unknown = t("確認できません", "Unavailable");
  const news = monitor?.health?.status;
  const push = monitor?.webPush;
  const pushOk = push?.enabled && push.status === "ready" && !push.pollOverdue;
  const cell = (label: string, value: string | number | null | undefined) => <div>{label}<b>{value ?? unknown}</b></div>;
  return <>
    <div className={styles.stat}>
      <div className={styles.statHead}>{t("ニュース取得", "News intake")}
        {monitor && news ? <span className={`${styles.pt} ${news === "ready" ? styles.okTag : styles.ptStop}`}>{news === "ready" ? t("正常", "Normal") : news === "starting" ? t("起動中", "Starting") : t("要確認", "Needs attention")}</span> : <span className={`${styles.pt} ${styles.ptUnknown}`}>{unknown}</span>}</div>
      <div className={styles.statGrid}>
        {cell(t("最終取得", "Last fetch"), stamp(monitor?.lastCycleAt))}
        {cell(t("取得した記事", "Articles fetched"), undefined)}
        {cell(t("失敗", "Failures"), undefined)}
      </div>
    </div>
    <div className={styles.stat}>
      <div className={styles.statHead}>{t("スマホ通知の送信", "Phone-alert sending")}
        {push ? <span className={`${styles.pt} ${pushOk ? styles.okTag : styles.ptStop}`}>{!push.enabled || push.status === "disabled" ? t("送信オフ", "Off") : pushOk ? t("稼働中", "Running") : t("要確認", "Needs attention")}</span> : <span className={`${styles.pt} ${styles.ptUnknown}`}>{unknown}</span>}</div>
      <div className={styles.statGrid}>
        {cell(t("最終送信", "Last sent"), stamp(push?.lastAttemptAt))}
        {cell(t("送信成功（24時間）", "Accepted (24h)"), push ? push.accepted24Hours : undefined)}
        {cell(t("送信失敗（24時間）", "Failed (24h)"), push ? Math.max(0, push.attempted24Hours - push.accepted24Hours) : undefined)}
        {cell(t("登録端末", "Devices"), push ? `${push.activeDevices}` : undefined)}
      </div>
    </div>
    <div className={styles.stack}>
      <button type="button" className={`${styles.btn} ${styles.gbtO} ${styles.btnS}`} onClick={() => { setMonitor(undefined); setAttempt(v => v + 1); }}>{monitor === undefined ? t("確認しています…", "Checking…") : t("再確認", "Check again")}</button>
    </div>
    <p className={styles.help}>{t("取得できない項目は「確認できません」と表示します。", "Items that cannot be read show as unavailable.")}</p>
  </>;
}
export default function DeliveryScreen() {
  return <OwnerGate kicker="DELIVERY" title="配信状況">{ja => <Delivery ja={ja} />}</OwnerGate>;
}
