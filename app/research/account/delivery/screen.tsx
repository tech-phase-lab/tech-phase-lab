"use client";
import { useEffect, useState } from "react";
import OwnerGate from "../owner-gate";
import { getJson } from "../account-data";
import styles from "../account.module.css";

type Delivery = {
  news: { lastFetchedAt: string | null; fetchedCount: number | null; failedCount: number | null; verification: string; lastPollCompletedAt: string | null };
  push: { lastSentAt: string | null; successCount: number | null; failureCount: number | null; lastAttemptAt: string | null; uncertainCount: number | null; expiredCount: number | null };
};
const stamp = (iso: string | null | undefined) => {
  const ms = iso ? Date.parse(iso) : NaN;
  return Number.isFinite(ms) ? new Intl.DateTimeFormat("ja-JP", { timeZone: "Asia/Tokyo", year: "numeric", month: "long", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false }).format(ms) : null;
};

function DeliveryView({ ja }: { ja: boolean }) {
  const t = (a: string, b: string) => ja ? a : b;
  const [data, setData] = useState<Delivery | null | undefined>(undefined);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    getJson("/api/research/account/admin/delivery", controller.signal)
      .then(value => { if (!controller.signal.aborted) setData(value?.news && value?.push ? value as Delivery : null); })
      .catch(() => { if (!controller.signal.aborted) setData(null); });
    return () => controller.abort();
  }, [attempt]);
  const unknown = t("確認できません", "Unavailable");
  // A value the server could not supply is never drawn as 0.
  const date = (iso: string | null | undefined) => data ? stamp(iso) ?? unknown : unknown;
  const count = (n: number | null | undefined) => typeof n === "number" ? t(`${n}件`, `${n}`) : "—";
  const newsOk = data?.news.verification === "verified";
  const row = (label: string, value: string, key: string) => <div className={styles.kv} key={key}><span>{label}</span><b>{value}</b></div>;
  const reload = () => { setData(undefined); setAttempt(v => v + 1); };
  return <>
    <div className={styles.stat}>
      <div className={styles.statHead}>{t("ニュース取得", "News intake")}
        {newsOk ? <span className={`${styles.pt} ${styles.okTag}`}>{t("正常", "Normal")}</span> : <span className={`${styles.pt} ${styles.ptUnknown}`}>{unknown}</span>}</div>
      <div style={{ marginTop: 6 }}>
        {row(t("最終取得", "Last fetch"), date(data?.news.lastFetchedAt), "a")}
        {row(t("取得した記事", "Articles fetched"), count(data?.news.fetchedCount), "b")}
        {row(t("失敗", "Failures"), count(data?.news.failedCount), "c")}
        {data?.news.lastPollCompletedAt && row(t("公式一覧の最終巡回", "Last discovery poll"), date(data.news.lastPollCompletedAt), "d")}
      </div>
    </div>
    <div className={styles.stat}>
      <div className={styles.statHead}>{t("スマホ通知の送信", "Phone-alert sending")}
        <span className={`${styles.pt} ${styles.ptUnknown}`}>{unknown}</span></div>
      <div style={{ marginTop: 6 }}>
        {row(t("最終送信", "Last sent"), date(data?.push.lastSentAt), "a")}
        {row(t("送信受理（24時間）", "Accepted (24h)"), count(data?.push.successCount), "b")}
        {row(t("送信失敗（24時間）", "Failed (24h)"), count(data?.push.failureCount), "c")}
        {data && data.push.lastAttemptAt && row(t("最後に試した時刻", "Last attempt"), date(data.push.lastAttemptAt), "d")}
        {data && typeof data.push.uncertainCount === "number" && row(t("結果が不明（24時間）", "Uncertain (24h)"), count(data.push.uncertainCount), "e")}
        {data && typeof data.push.expiredCount === "number" && row(t("端末の期限切れ（24時間）", "Expired devices (24h)"), count(data.push.expiredCount), "f")}
      </div>
      <p className={styles.help} style={{ marginTop: 6 }}>{t("「送信受理」は、通知サービスが受け付けた数です。端末に届いたことを示すものではありません。", "“Accepted” is what the push service took; it does not show that a device received it.")}</p>
      <button type="button" className={`${styles.btn} ${styles.gbtO} ${styles.btnS}`} style={{ marginTop: 12 }} onClick={reload}>{t("再確認", "Check again")}</button>
    </div>
    {data === null && <p className={styles.note} role="status" style={{ marginTop: 12 }}>{t("配信状況を取得できませんでした。", "Could not load the delivery status.")}</p>}
    <button type="button" className={`${styles.btn} ${styles.gbtO}`} style={{ marginTop: 16 }} onClick={reload}>{data === undefined ? t("読み込んでいます…", "Loading…") : t("再読み込み", "Reload")}</button>
  </>;
}
export default function DeliveryScreen() {
  return <OwnerGate kicker="DELIVERY" title="配信状況">{ja => <DeliveryView ja={ja} />}</OwnerGate>;
}
