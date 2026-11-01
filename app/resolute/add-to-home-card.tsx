"use client";
import { useSyncExternalStore } from "react";
import AddToHomeSteps from "./add-to-home-steps";
import styles from "./diagnosis.module.css";

/** The home card that explains how to put RESOLUTE on the home screen. Hidden inside the installed app, and for 30 days after "×". */
const KEY = "tech-phase:resolute-add-to-home-until";
const listeners = new Set<() => void>();
const subscribe = (notify: () => void) => { listeners.add(notify); return () => { listeners.delete(notify); }; };
const snapshot = () => {
  try {
    const installed = (navigator as Navigator & { standalone?: boolean }).standalone === true || window.matchMedia("(display-mode: standalone)").matches;
    return installed || Number(localStorage.getItem(KEY)) > Date.now() ? "hidden" : "shown";
  } catch { return "shown"; }
};
function close() { try { localStorage.setItem(KEY, String(Date.now() + 30 * 86_400_000)); } catch { /* optional */ } listeners.forEach(listener => listener()); }

export default function AddToHomeCard({ en }: { en: boolean }) {
  const state = useSyncExternalStore(subscribe, snapshot, () => "hidden");
  if (state === "hidden") return null;
  return <section className={styles.homeGuide} aria-label={en ? "Put RESOLUTE on your home screen" : "ホーム画面にRESOLUTEを置く"}>
    <div className={styles.homeGuideHead}><b>{en ? "Put RESOLUTE on your home screen" : "ホーム画面にRESOLUTEを置く"}</b>
      <button type="button" aria-label={en ? "Close (hidden for 30 days)" : "閉じる(30日間表示しません)"} onClick={close}>×</button></div>
    <p>{en ? "Open it in one tap, like an app." : "アプリのように、1タップで開けます。"}</p>
    <AddToHomeSteps en={en} />
  </section>;
}
