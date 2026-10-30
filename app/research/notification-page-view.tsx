"use client";
import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";
import { earningsOnlyProviders, providers } from "@/lib/research/intake";
import type { Language } from "@/lib/research/data";
import styles from "./notification-page.module.css";

const monitored = providers.map(p => p.ticker);
const tracked = earningsOnlyProviders.map(p => p.ticker);
export type Preferences = { targets: boolean; earnings: boolean; news: boolean; newsTickers: string[]; weeklyNotebook: boolean };
type PrefsState = "idle" | "loading" | "ready" | "error" | "unsupported";
// Shown (and locked) until the server's own settings have been read.
const placeholder: Preferences = { targets: true, earnings: true, news: true, newsTickers: monitored, weeklyNotebook: true };
const svg = (d: ReactNode) => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{d}</svg>;
const icons = {
  bell: svg(<><path d="M6 16.5V11a6 6 0 0 1 12 0v5.5l1.5 1.5h-15z" /><path d="M10 20.5a2.2 2.2 0 0 0 4 0" /></>),
  target: svg(<><circle cx="12" cy="12" r="8" /><circle cx="12" cy="12" r="4" /><circle cx="12" cy="12" r=".8" fill="currentColor" /></>),
  earnings: svg(<><path d="M4 19V9M10 19V5M16 19v-7M21 19H3" /></>),
  news: svg(<><rect x="4" y="5" width="16" height="14" rx="2" /><path d="M8 9h8M8 13h8M8 16h5" /></>),
  notebook: svg(<><path d="M6 4h11a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H6z" /><path d="M6 4v16M10 9h5" /></>),
};

export type PageViewProps = {
  lang: Language; state: string; label: string; busy: boolean; usable: boolean; hasSubscription: boolean;
  message: string; testSent: boolean; received: boolean;
  prefs: Preferences | null; prefsState: PrefsState; prefsMessage: string; onPrefs: (patch: Partial<Preferences>) => void;
  onToggle: () => void; onDisable: () => void; onTest: () => void; onRetry: () => void; onStatus: () => void; onReceived: () => void;
};

function Sheet({ title, sub, action, onClose, children }: { title: string; sub: string; action: string; onClose: () => void; children: ReactNode }) {
  useEffect(() => { const key = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); }; document.addEventListener("keydown", key); return () => document.removeEventListener("keydown", key); }, [onClose]);
  return <div className={styles.scrim} onClick={onClose}>
    <div className={styles.sheet} role="dialog" aria-modal="true" aria-label={title} onClick={e => e.stopPropagation()}>
      <div className={styles.handle} />
      <div className={styles.sheetHead}><h2 className={styles.sheetTitle}>{title}</h2><button type="button" className={styles.close} onClick={onClose}>{action}</button></div>
      <p className={styles.sheetSub}>{sub}</p>
      <div className={styles.scroll}>{children}</div>
    </div>
  </div>;
}

export default function NotificationPageView(p: PageViewProps) {
  const { lang, state } = p;
  const t = (ja: string, en: string) => lang === "ja" ? ja : en;
  const [sheet, setSheet] = useState<"" | "earnings" | "news">("");
  const prefs = p.prefs ?? placeholder;
  const news = prefs.newsTickers.filter(x => monitored.includes(x));
  const saveNews = (next: string[]) => p.onPrefs({ newsTickers: next });
  const on = state === "on";
  const editable = on && p.prefsState === "ready" && !p.busy;
  const needsAccount = state === "sign-in" || state === "pro-required";
  const sheets = <>
    {sheet === "earnings" && <Sheet title={t("決算を通知する50社", "50 companies with earnings alerts")} sub={t("決算の結果が出たときに、お知らせします。", "You are notified when results are out.")} action={t("閉じる", "Close")} onClose={() => setSheet("")}>
      <p className={styles.group}>{t(`監視 ${monitored.length}銘柄`, `MONITORED ${monitored.length}`)}</p>
      <ul className={styles.chips}>{monitored.map(x => <li key={x} className={styles.chip}>{x}</li>)}</ul>
      <p className={styles.group}>{t(`追跡 ${tracked.length}社`, `TRACKED ${tracked.length}`)}</p>
      <ul className={styles.chips}>{tracked.map(x => <li key={x} className={styles.chip}>{x}</li>)}</ul>
    </Sheet>}
    {sheet === "news" && <Sheet title={t("ニュースを受け取る銘柄", "Stocks for news alerts")} sub={t("選んだ銘柄のニュースが、スマホに届きます。", "News for the stocks you pick reaches your phone.")} action={t("完了", "Done")} onClose={() => setSheet("")}>
      <div className={styles.pickBar}><span>{t(`${news.length} / ${monitored.length}銘柄を選択中`, `${news.length} / ${monitored.length} selected`)}</span>
        {news.length === monitored.length ? <button type="button" disabled={!editable} className={styles.none} onClick={() => saveNews([])}>{t("すべて外す", "Clear all")}</button> : <button type="button" disabled={!editable} className={styles.all} onClick={() => saveNews(monitored)}>{t("すべて選ぶ", "Select all")}</button>}</div>
      <ul className={styles.chips}>{monitored.map(x => { const chosen = news.includes(x); return <li key={x}><button type="button" aria-pressed={chosen} disabled={!editable} className={`${styles.chip} ${chosen ? styles.chipOn : ""}`} style={{ width: "100%" }} onClick={() => saveNews(chosen ? news.filter(v => v !== x) : monitored.filter(v => v === x || news.includes(v)))}>{x}</button></li>; })}</ul>
    </Sheet>}
  </>;
  const row = (icon: ReactNode, title: string, desc: string, checked: boolean, onChange: (v: boolean) => void, link?: ReactNode) =>
    <li className={styles.row}><span className={styles.icon}>{icon}</span><div><p className={styles.rowTitle}>{title}</p><p className={styles.rowDesc}>{desc}</p></div>
      <button type="button" role="switch" aria-checked={checked} aria-label={title} disabled={!editable} className={`${styles.switch} ${checked ? styles.switchOn : ""}`} onClick={() => onChange(!checked)} />{link}</li>;
  return <div className={styles.page}>
    <div className={styles.status}>
      <div className={styles.statusRow}>
        <span className={`${styles.bell} ${on ? styles.bellOn : ""}`}>{icons.bell}</span>
        <span className={styles.statusName}>{t("この端末の通知", "Notifications on this device")}</span>
        <span className={`${styles.tag} ${on ? styles.tagOn : ""}`} role="status"><i />{on ? t("オン", "On") : t("オフ", "Off")}</span>
      </div>
      <p className={styles.statusText} role="status">{needsAccount || !p.usable ? p.label : on ? t("下で選んだお知らせが、この端末に届きます。", "The alerts you pick below reach this device.") : t("オンにすると、下で選んだお知らせがこの端末に届きます。", "Turn on to receive the alerts you pick below on this device.")}</p>
      {p.usable && <button type="button" className={on ? styles.outline : styles.main} disabled={p.busy} onClick={p.onToggle}>{on ? t("通知をオフにする", "Turn off notifications") : t("通知をオンにする", "Turn on notifications")}</button>}
      {(state === "unavailable" || state === "checking") && <div className={styles.aux}><button type="button" disabled={p.busy} onClick={p.onRetry}>{t("再確認", "Try again")}</button></div>}
      {needsAccount && <div className={styles.aux}><Link href="/research/account">{t("ログイン・会員情報", "Sign in / Membership")}</Link></div>}
      {!p.usable && p.hasSubscription && <div className={styles.aux}><button type="button" disabled={p.busy} onClick={p.onDisable}>{t("この端末の通知をオフ", "Turn off on this device")}</button></div>}
      {state === "unsupported" && <p className={styles.note}>{t("iPhoneではSafariの共有メニューからホーム画面に追加し、そのアイコンから開いてください。", "On iPhone, add this site to your Home Screen using Safari’s Share menu, then open that icon.")}</p>}
      {state === "blocked" && <p className={styles.note}>{t("端末またはブラウザの設定で、Tech Phaseの通知を許可してください。", "Allow Tech Phase notifications in your device or browser settings.")}</p>}
      {state === "unknown" && <div className={styles.aux}><button type="button" disabled={p.busy} onClick={p.onStatus}>{t("登録状態を確認", "Check registration")}</button><button type="button" disabled={p.busy} onClick={p.onDisable}>{t("この端末の通知をオフ", "Turn off on this device")}</button></div>}
      {on && <div className={styles.aux}><button type="button" disabled={p.busy} onClick={p.onTest}>{t("テスト通知を送る", "Send test notification")}</button>{p.testSent && !p.received && <button type="button" onClick={p.onReceived}>{t("届きました", "Received")}</button>}</div>}
      {p.busy && <p className={styles.note} role="status">{t("処理中…", "Working…")}</p>}
      {p.message && <p className={styles.note} role="status">{p.message}</p>}
      {p.received && <p className={styles.note} role="status">{t("この端末で受信を確認しました。", "Receipt confirmed on this device.")}</p>}
    </div>
    <p className={styles.heading}>{t("届く内容", "WHAT YOU GET")}</p>
    <ul className={`${styles.rows} ${on ? "" : styles.rowsOff}`}>
      {row(icons.target, t("目標株価の変更", "Price target changes"), t("主要AI株の多くが対象", "Most major AI stocks are covered"), prefs.targets, v => p.onPrefs({ targets: v }))}
      {row(icons.earnings, t("決算の速報", "Earnings flashes"), t(`監視${monitored.length}銘柄と追跡${tracked.length}社、計${monitored.length + tracked.length}社が対象`, `${monitored.length} monitored and ${tracked.length} tracked, ${monitored.length + tracked.length} in all`), prefs.earnings, v => p.onPrefs({ earnings: v }),
        <button type="button" className={styles.link} onClick={() => setSheet("earnings")}>{t(`対象の${monitored.length + tracked.length}社を見る ›`, `See the ${monitored.length + tracked.length} companies ›`)}</button>)}
      {row(icons.news, t("銘柄のニュース", "Stock news"), t(`監視${monitored.length}銘柄のうち、選んだ銘柄だけ`, `Only the stocks you pick of the ${monitored.length} monitored`), prefs.news, v => p.onPrefs({ news: v }),
        <button type="button" className={styles.link} onClick={() => setSheet("news")}>{t(`銘柄を選ぶ（${news.length}銘柄を選択中） ›`, `Pick stocks (${news.length} selected) ›`)}</button>)}
      {row(icons.notebook, t("銘柄手帳のまとめ", "Stock Notebook recap"), t("日曜の夜に、今週の動きをお知らせ", "Sunday night: this week’s moves"), prefs.weeklyNotebook, v => p.onPrefs({ weeklyNotebook: v }))}
    </ul>
    {p.prefsMessage && <p className={styles.note} role="status">{p.prefsMessage}</p>}
    {p.prefsState === "unsupported" && <p className={styles.note} role="status">{t("届く内容の保存は、現在準備中です。", "Saving what you receive is not available yet.")}</p>}
    <p className={styles.foot}>{t("通知の設定は、この端末だけに反映されます。", "These settings apply to this device only.")}</p>
    {sheets}
  </div>;
}
