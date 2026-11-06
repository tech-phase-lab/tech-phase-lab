"use client";
import ResearchToolShell from "../research-tool-shell";
import NotificationSettings from "../notification-settings";
import { useResearchLanguage } from "../use-research-language";
import styles from "../notification-page.module.css";
export default function NotificationsPage() {
  const [lang, setLang] = useResearchLanguage();
  const ja = lang === "ja";
  return <ResearchToolShell lang={lang} setLang={setLang} title={ja ? "スマホ通知設定" : "Mobile notifications"} description="" showHeading={false}>
    <div className={styles.page} style={{ paddingBottom: 0 }}>
      <div className={styles.eyebrow}><span>NOTIFICATIONS</span><b>PRO</b></div>
      <h1 className={styles.title}>{ja ? "スマホ通知設定" : "Mobile notifications"}</h1>
      <div className={styles.subRow}>
        <p className={styles.sub}>{ja ? "大事な動きを、スマホにお知らせします。" : "Get important updates on your phone."}</p>
        <button type="button" className={styles.jump} onClick={() => document.getElementById("details")?.scrollIntoView({ behavior: "smooth", block: "start" })}>{ja ? "詳しい設定 ↓" : "Details ↓"}</button>
      </div>
    </div>
    <NotificationSettings lang={lang} page />
  </ResearchToolShell>;
}
