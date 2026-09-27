"use client";
import { useState } from "react";
import type { Language } from "@/lib/research/data";
import styles from "./price-targets-panel.module.css";

export default function NotificationSettings({ lang, initiallyOpen = false }: { lang: Language; initiallyOpen?: boolean }) {
  const [open, setOpen] = useState(initiallyOpen);
  // Interaction preview only. Never claim to enroll a device without member authentication.
  const [previewEnabled, setPreviewEnabled] = useState(false);
  const t = (ja: string, en: string) => lang === "ja" ? ja : en;
  return <>
    <button type="button" className={styles.notificationToggle} aria-expanded={open} aria-controls={open ? "price-target-notifications" : undefined} onClick={() => setOpen(!open)}>
      {t("スマホ通知設定", "Phone notifications")}
    </button>
    {open && <div id="price-target-notifications" className={styles.notificationBody}>
      <div className={styles.notificationPreference}>
        <div>
          <strong className={styles.notificationTitle} id="price-target-alert-label">{t("目標株価のスマホ通知", "Price target phone alerts")}</strong>
          <p>{t("引き上げ・引き下げをお知らせ", "Get notified of increases and decreases")}</p>
        </div>
        <button type="button" role="switch" aria-checked={previewEnabled} aria-labelledby="price-target-alert-label" aria-describedby="notification-preview-note" className={styles.notificationSwitch} onClick={() => setPreviewEnabled(value => !value)}>
          <span aria-hidden="true">{previewEnabled ? t("オン", "On") : t("オフ", "Off")}</span>
          <span className={styles.switchTrack} aria-hidden="true"><span /></span>
        </button>
      </div>
      <p id="notification-preview-note" className={styles.pilotNote}>{t("表示確認用です。通知は送信されません。", "Display preview only. No notifications will be sent.")}</p>
    </div>}
  </>;
}
