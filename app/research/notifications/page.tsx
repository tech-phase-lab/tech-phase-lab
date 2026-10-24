"use client";
import ResearchToolShell from "../research-tool-shell";
import NotificationSettings from "../notification-settings";
import { useResearchLanguage } from "../use-research-language";
export default function NotificationsPage() {
  const [lang, setLang] = useResearchLanguage();
  return <ResearchToolShell lang={lang} setLang={setLang} title={lang === "ja" ? "スマホ通知設定" : "Phone notifications"} description=""><div style={{ marginTop: 24 }}><NotificationSettings lang={lang} initiallyOpen /></div></ResearchToolShell>;
}
