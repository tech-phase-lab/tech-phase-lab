"use client";
import ResearchToolShell from "../research-tool-shell";
import NotificationSettings from "../notification-settings";
import { useResearchLanguage } from "../use-research-language";
import styles from "../notification-page.module.css";
export default function NotificationsPage() {
  const [lang, setLang] = useResearchLanguage();
  const ja = lang === "ja";
  return <ResearchToolShell lang={lang} setLang={setLang} title={ja ? "スマホ通知設定" : "Phone notifications"} description="" showHeading={false}>
    <div className={styles.page} style={{ paddingBottom: 0 }}>
      <div className={styles.eyebrow}><span>NOTIFICATIONS</span><b>PRO</b></div>
      <h1 className={styles.title}>{ja ? "スマホ通知設定" : "Phone notifications"}</h1>
      <p className={styles.sub}>{ja ? "大事な動きを、スマホにお知らせします。" : "Important moves, sent to your phone."}</p>
    </div>
    <NotificationSettings lang={lang} page />
  </ResearchToolShell>;
}
