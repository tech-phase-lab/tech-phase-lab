"use client";
import Link from "next/link";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { earningsOnlyProviders, providers } from "@/lib/research/intake";
import type { Language } from "@/lib/research/data";
import { SHOW_EVENT, installContext, isStandalone } from "@/lib/research/home-install";
import styles from "./notification-page.module.css";

const monitored = providers.map(p => p.ticker);
const tracked = earningsOnlyProviders.map(p => p.ticker);
export type Quiet = { on: boolean; start: number; end: number };
export type Preferences = { targets: boolean; earnings: boolean; news: boolean; newsTickers: string[]; weeklyNotebook: boolean;
  /** Economic-indicator results, and which indicators (Nov 4). */ economic: boolean; economicKinds: string[];
  /** A new issue of 週刊 Tech Phase PRO is out. */ weeklyIssue: boolean; /** Your question to Rizel was answered. */ rizelAnswer: boolean;
  /** おやすみモード: hours in Japan time. */ quiet: Quiet;
  /** A new "リゼルのひとりごと" post; off until turned on. */ rizelNote: boolean; /** Owner only: a weekly issue draft is ready. */ weeklyDraft?: boolean };
type PrefsState = "idle" | "loading" | "ready" | "error" | "unsupported";
// The nine indicators; the first six start on. Only jobless claims has no result reader yet ("soon"): the Department of Labor blocks automated reading of its page.
export const indicators: { key: string; ja: string; en: string; whenJa: string; whenEn: string; ready: boolean }[] = [
  { key: "jobs", ja: "雇用統計", en: "Jobs report", whenJa: "毎月第1金曜", whenEn: "First Friday monthly", ready: true },
  { key: "cpi", ja: "CPI（消費者物価）", en: "CPI", whenJa: "毎月", whenEn: "Monthly", ready: true },
  { key: "pce", ja: "PCE（個人消費支出）", en: "PCE", whenJa: "毎月", whenEn: "Monthly", ready: true },
  { key: "fomc", ja: "FOMC（政策金利）", en: "FOMC", whenJa: "年8回", whenEn: "8 times a year", ready: true },
  { key: "adp", ja: "ADP雇用統計", en: "ADP employment", whenJa: "毎月", whenEn: "Monthly", ready: true },
  { key: "ism", ja: "ISM製造業景況指数", en: "ISM manufacturing", whenJa: "毎月初め", whenEn: "Early each month", ready: true },
  { key: "gdp", ja: "GDP", en: "GDP", whenJa: "四半期ごと", whenEn: "Quarterly", ready: true },
  { key: "retail", ja: "小売売上高", en: "Retail sales", whenJa: "毎月", whenEn: "Monthly", ready: true },
  { key: "claims", ja: "新規失業保険申請件数", en: "Jobless claims", whenJa: "毎週木曜", whenEn: "Every Thursday", ready: false },
];
const defaultKinds = ["jobs", "cpi", "pce", "fomc", "adp", "ism"];
const hour = (h: number) => `${String(h).padStart(2, "0")}:00`;
// Shown (and locked) until the server's own settings have been read.
const placeholder: Preferences = { targets: true, earnings: true, news: true, newsTickers: monitored, weeklyNotebook: true, economic: true, economicKinds: defaultKinds,
  weeklyIssue: false, rizelAnswer: false, quiet: { on: true, start: 23, end: 7 }, rizelNote: false };
const svg = (d: ReactNode) => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{d}</svg>;
const icons = {
  bell: svg(<><path d="M6 16.5V11a6 6 0 0 1 12 0v5.5l1.5 1.5h-15z" /><path d="M10 20.5a2.2 2.2 0 0 0 4 0" /></>),
  target: svg(<><circle cx="12" cy="12" r="8" /><circle cx="12" cy="12" r="4" /><circle cx="12" cy="12" r=".8" fill="currentColor" /></>),
  earnings: svg(<><path d="M4 19V9M10 19V5M16 19v-7M21 19H3" /></>),
  news: svg(<><rect x="4" y="5" width="16" height="14" rx="2" /><path d="M8 9h8M8 13h8M8 16h5" /></>),
  notebook: svg(<><path d="M6 4h11a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H6z" /><path d="M6 4v16M10 9h5" /></>),
  calendar: svg(<><rect x="4" y="5" width="16" height="15" rx="2" /><path d="M4 10h16M9 3v4M15 3v4" /></>),
  weekly: svg(<><rect x="5" y="4" width="14" height="16" rx="2" /><path d="M8 16v-3M12 16V8M16 16v-5" /></>),
  chat: svg(<><path d="M5 5h14a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1h-7l-4 3.5V16H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1z" /></>),
  moon: svg(<><path d="M19 14.5A7.5 7.5 0 0 1 9.5 5a7.5 7.5 0 1 0 9.5 9.5z" /></>),
  pencil: svg(<><path d="M5 19l1-4L16.5 4.5a2 2 0 0 1 3 3L9 18z" /><path d="M14.5 6.5l3 3" /></>),
};

export type PageViewProps = {
  lang: Language; state: string; label: string; busy: boolean; starting: boolean; usable: boolean; hasSubscription: boolean;
  message: string; testSent: boolean; received: boolean;
  prefs: Preferences | null; prefsState: PrefsState; prefsMessage: string; owner?: boolean; onPrefs: (patch: Partial<Preferences>) => void;
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

/** One column of hours: tap one, and it is the choice. The chosen hour scrolls to the middle. */
function HourPicker({ label, value, onChange }: { label: string; value: number; onChange: (hour: number) => void }) {
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => { const chosen = box.current?.querySelector<HTMLElement>("[aria-checked='true']"); if (chosen && box.current) box.current.scrollTop = chosen.offsetTop - box.current.clientHeight / 2 + chosen.clientHeight / 2; }, [value]);
  return <div className={styles.pickerCol}><p className={styles.pickerLabel}>{label}</p>
    <div ref={box} className={styles.picker} role="radiogroup" aria-label={label}>
      {Array.from({ length: 24 }, (_, h) => <button key={h} type="button" role="radio" aria-checked={h === value} className={`${styles.hour} ${h === value ? styles.hourOn : ""}`} onClick={() => onChange(h)}>{hour(h)}</button>)}
    </div></div>;
}

export default function NotificationPageView(p: PageViewProps) {
  const { lang, state } = p;
  const t = (ja: string, en: string) => lang === "ja" ? ja : en;
  const [sheet, setSheet] = useState<"" | "earnings" | "news" | "economic" | "quiet">("");
  const prefs: Preferences = { ...placeholder, ...(p.prefs ?? {}) };
  const [draft, setDraft] = useState<Quiet>(prefs.quiet);
  const news = prefs.newsTickers.filter(x => monitored.includes(x));
  const saveNews = (next: string[]) => p.onPrefs({ newsTickers: next });
  const kinds = prefs.economicKinds;
  const on = state === "on";
  const editable = on && p.prefsState === "ready" && !p.busy;
  const needsAccount = state === "sign-in" || state === "pro-required";
  const quietText = prefs.quiet.on ? `${hour(prefs.quiet.start)}〜${hour(prefs.quiet.end)}` : t("オフ", "Off");
  const openQuiet = () => { setDraft(prefs.quiet); setSheet("quiet"); };
  const sw = (title: string, checked: boolean, onChange: (v: boolean) => void) =>
    <button type="button" role="switch" aria-checked={checked} aria-label={title} disabled={!editable} className={`${styles.switch} ${checked ? styles.switchOn : ""}`} onClick={() => onChange(!checked)} />;
  const sheets = <>
    {sheet === "earnings" && <Sheet title={t("決算を通知する50社", "50 companies with earnings alerts")} sub={t("決算の結果が出たときに、お知らせします。", "Get notified when earnings are released.")} action={t("閉じる", "Close")} onClose={() => setSheet("")}>
      <p className={styles.group}>{t(`監視 ${monitored.length}銘柄`, `MONITORED ${monitored.length}`)}</p>
      <ul className={styles.chips}>{monitored.map(x => <li key={x} className={styles.chip}>{x}</li>)}</ul>
      <p className={styles.group}>{t(`追跡 ${tracked.length}社`, `TRACKED ${tracked.length}`)}</p>
      <ul className={styles.chips}>{tracked.map(x => <li key={x} className={styles.chip}>{x}</li>)}</ul>
    </Sheet>}
    {sheet === "news" && <Sheet title={t("ニュースを受け取る銘柄", "Stocks for news alerts")} sub={t("選んだ銘柄のニュースが、スマホに届きます。", "Get news alerts on your phone for the stocks you choose.")} action={t("完了", "Done")} onClose={() => setSheet("")}>
      <div className={styles.pickBar}><span>{t(`${news.length} / ${monitored.length}銘柄を選択中`, `${news.length} / ${monitored.length} selected`)}</span>
        {news.length === monitored.length ? <button type="button" disabled={!editable} className={styles.none} onClick={() => saveNews([])}>{t("すべて外す", "Clear all")}</button> : <button type="button" disabled={!editable} className={styles.all} onClick={() => saveNews(monitored)}>{t("すべて選ぶ", "Select all")}</button>}</div>
      <ul className={styles.chips}>{monitored.map(x => { const chosen = news.includes(x); return <li key={x}><button type="button" aria-pressed={chosen} disabled={!editable} className={`${styles.chip} ${chosen ? styles.chipOn : ""}`} style={{ width: "100%" }} onClick={() => saveNews(chosen ? news.filter(v => v !== x) : monitored.filter(v => v === x || news.includes(v)))}>{x}</button></li>; })}</ul>
    </Sheet>}
    {sheet === "economic" && <Sheet title={t("経済指標を選ぶ", "Choose indicators")} sub={t("発表のあとに、結果を届けます。", "Get the results after each release.")} action="×" onClose={() => setSheet("")}>
      <ul className={styles.kinds}>{indicators.map(k => { const chosen = kinds.includes(k.key); return <li key={k.key} className={styles.kind}>
        <div><p className={styles.rowTitle}>{t(k.ja, k.en)}{!k.ready && <span className={styles.soon}>{t("準備中", "Soon")}</span>}</p><p className={styles.rowDesc}>{t(k.whenJa, k.whenEn)}</p></div>
        {sw(t(k.ja, k.en), chosen, v => p.onPrefs({ economicKinds: v ? indicators.map(x => x.key).filter(x => x === k.key || kinds.includes(x)) : kinds.filter(x => x !== k.key) }))}</li>; })}</ul>
      <p className={styles.foot}>{t("日本時間の発表の時刻に届きます。おやすみモード中は届きません。", "Sent at the release time in Japan. Nothing is sent during Do Not Disturb.")}</p>
    </Sheet>}
    {sheet === "quiet" && <Sheet title={t("おやすみモード", "Quiet hours")} sub="" action="×" onClose={() => setSheet("")}>
      <div className={styles.quietUse}><div><p className={styles.rowTitle}>{t("おやすみモードを使う", "Use Do Not Disturb")}</p><p className={styles.rowDesc}>{t("この時間は、通知を止めます。", "Notifications pause during these hours.")}</p></div>
        {sw(t("おやすみモードを使う", "Use Do Not Disturb"), draft.on, v => setDraft({ ...draft, on: v }))}</div>
      <div className={`${styles.pickers} ${draft.on ? "" : styles.rowsOff}`}>
        <HourPicker label={t("はじめ", "From")} value={draft.start} onChange={h => setDraft({ ...draft, start: h })} />
        <HourPicker label={t("おわり", "To")} value={draft.end} onChange={h => setDraft({ ...draft, end: h })} />
      </div>
      {draft.on && draft.start === draft.end && <p className={styles.note} role="status">{t("はじめとおわりは、別の時刻にしてください。", "Pick two different hours.")}</p>}
      <button type="button" className={styles.main} disabled={!editable || (draft.on && draft.start === draft.end)} onClick={() => { p.onPrefs({ quiet: draft }); setSheet(""); }}>{t("決定", "Done")}</button>
    </Sheet>}
  </>;
  const row = (icon: ReactNode, title: string, desc: string, checked: boolean, onChange: (v: boolean) => void) =>
    <li className={styles.row}><span className={styles.icon}>{icon}</span><div className={styles.rowText}><p className={styles.rowTitle}>{title}</p><p className={styles.rowDesc}>{desc}</p></div>{sw(title, checked, onChange)}</li>;
  const more = (icon: ReactNode, title: string, value: string, open: () => void) =>
    <li><button type="button" className={styles.more} onClick={open}><span className={styles.icon}>{icon}</span><span className={styles.rowTitleBig}>{title}</span><span className={styles.value}>{value}</span><span className={styles.chev} aria-hidden="true">›</span></button></li>;
  const statusText = state === "unavailable" || state === "unknown" ? t("通知の状態を確認できませんでした。", "Could not check the notification status.")
    : needsAccount || !p.usable ? p.label : on ? t("選んだお知らせが届きます。", "The alerts you pick below reach this device.") : t("オンにすると、お知らせが届きます。", "Turn on notifications, then choose which updates you'd like to receive.");
  return <div className={styles.page}>
    <div className={styles.status}>
      <div className={styles.statusRow}>
        <span className={`${styles.bell} ${on ? styles.bellOn : ""}`}>{icons.bell}</span>
        <div className={styles.statusBody}>
          <p className={styles.statusName}>{t("この端末の通知", "This device")}<span className={`${styles.tag} ${on ? styles.tagOn : ""}`} role="status"><i />{on ? t("オン", "On") : t("オフ", "Off")}</span></p>
          <p className={styles.statusText} data-oneline={lang === "ja"} role="status">{statusText}</p>
        </div>
        {state === "unsupported" && installContext(navigator.userAgent, isStandalone(window)) !== "none" && <button type="button" className={styles.statusOn} onClick={() => window.dispatchEvent(new Event(SHOW_EVENT))}>{t("オンにする", "Turn on")}</button>}
        {p.usable && <button type="button" className={on ? styles.statusOff : styles.statusOn} disabled={p.busy || p.starting} onClick={p.onToggle}>{p.busy || p.starting ? t("設定中…", "Setting up…") : on ? t("オフにする", "Turn off") : t("オンにする", "Turn on")}</button>}
      </div>
      {(state === "unavailable" || state === "unknown") && <div className={styles.aux}><button type="button" disabled={p.busy} onClick={state === "unknown" ? p.onStatus : p.onRetry}>{t("もう一度確認する", "Check again")}</button></div>}
      {(needsAccount || (!p.usable && p.hasSubscription)) && <div className={styles.aux}>
        {needsAccount && <Link href="/research/account">{t("ログイン・会員情報", "Sign in or view plans")}</Link>}
        {!p.usable && p.hasSubscription && <button type="button" disabled={p.busy} onClick={p.onDisable}>{t("通知をオフにする", "Turn off notifications")}</button>}
      </div>}
      {state === "unsupported" && <p className={styles.note}>{t("iPhoneではSafariの共有メニューからホーム画面に追加し、そのアイコンから開いてください。", "On iPhone, add this site to your Home Screen using Safari’s Share menu, then open that icon.")}</p>}
      {state === "blocked" && <p className={styles.note}>{t("端末またはブラウザの設定で、Tech Phaseの通知を許可してください。", "Allow Tech Phase notifications in your device or browser settings.")}</p>}
      {!on && p.message && <p className={styles.note} role="status">{p.message}</p>}
    </div>
    <div className={on ? "" : styles.rowsOff}>
      <p className={styles.section}>{t("銘柄", "STOCKS")}</p>
      <ul className={styles.rows}>
        {row(icons.target, t("目標株価の変更", "Price target changes"), t("主要AI株の多くが対象", "Most major AI stocks are covered"), prefs.targets, v => p.onPrefs({ targets: v }))}
        {row(icons.earnings, t("決算の速報", "Earnings updates"), t(`監視${monitored.length}銘柄と追跡${tracked.length}社、計${monitored.length + tracked.length}社を網羅`, `${monitored.length} monitored and ${tracked.length} tracked, ${monitored.length + tracked.length} in all`), prefs.earnings, v => p.onPrefs({ earnings: v }))}
        {row(icons.news, t("監視株ニュース", "News for selected stocks"), t(`監視${monitored.length}銘柄のうち、選んだ銘柄だけ`, `Only the stocks you pick of the ${monitored.length} monitored`), prefs.news, v => p.onPrefs({ news: v }))}
      </ul>
      <p className={styles.section}>{t("市場", "MARKET")}</p>
      <ul className={styles.rows}>
        {row(icons.calendar, t("経済指標", "Economic indicators"), t("雇用統計やCPIなど、重要な指標すべて", "Jobs reports, CPI, and other key economic data"), prefs.economic, v => p.onPrefs({ economic: v }))}
        {row(icons.notebook, t("銘柄手帳のまとめ", "Stock Notebook recap"), t("日曜の夜に、ウォッチリストの1週間を配信", "Your watchlist's weekly recap, every Sunday night"), prefs.weeklyNotebook, v => p.onPrefs({ weeklyNotebook: v }))}
        {row(icons.weekly, t("週刊PRO", "PRO Weekly"), t("毎週、新しい号が公開されたときにお知らせ", "When a new issue is published each week"), prefs.weeklyIssue, v => p.onPrefs({ weeklyIssue: v }))}
      </ul>
      <p className={styles.section}>{t("リゼル", "RIZEL")}</p>
      <ul className={styles.rows}>
        {row(icons.bell, t("ひとりごと", "RIZEL’s Notes"), t("リゼルが新しく書いたら、すぐ通知", "As soon as Rizel posts a new note"), prefs.rizelNote ?? false, v => p.onPrefs({ rizelNote: v }))}
        {row(icons.chat, t("リゼルに聞く", "Ask Rizel"), t("あなたの質問に回答がついたとき", "When your question gets an answer"), prefs.rizelAnswer, v => p.onPrefs({ rizelAnswer: v }))}
      </ul>
    </div>
    {p.prefsMessage && <p className={styles.note} role="status">{p.prefsMessage}</p>}
    {p.prefsState === "unsupported" && <p className={styles.note} role="status">{t("届く内容の保存は、現在準備中です。", "Saving what you receive is not available yet.")}</p>}
    <section id="details" className={styles.details} aria-label={t("詳しい設定", "Details")}>
      <h2 className={styles.detailsHead}>{t("詳しい設定", "Details")}<span>{t("対象や時間を細かく決められます", "Choose what you get and when")}</span></h2>
      <ul className={`${styles.moreList} ${on ? "" : styles.rowsOff}`}>
        {more(icons.earnings, t("決算の対象", "Earnings coverage"), t(`${monitored.length + tracked.length}社`, `${monitored.length + tracked.length}`), () => setSheet("earnings"))}
        {more(icons.news, t("監視株ニュース", "News for selected stocks"), t(`${news.length}銘柄`, `${news.length}`), () => setSheet("news"))}
        {more(icons.calendar, t("経済指標の種類", "Economic indicators"), t(`${kinds.length}件`, `${kinds.length}`), () => setSheet("economic"))}
        {more(icons.moon, t("おやすみモード", "Quiet hours"), quietText, openQuiet)}
      </ul>
      {on && <div className={styles.testBlock}>
        <button type="button" className={styles.testButton} disabled={p.busy} onClick={p.onTest}><span>{t("テスト通知を送る", "Send test notification")}</span><span className={styles.value}>{t("動作の確認", "Check it works")}</span></button>
        {p.testSent && !p.received && <button type="button" className={styles.testButton} onClick={p.onReceived}>{t("届きました", "Received")}</button>}
        {p.message && <p className={styles.note} role="status">{p.message}</p>}
        {p.received && <p className={styles.note} role="status">{t("この端末で受信を確認しました。", "Receipt confirmed on this device.")}</p>}
      </div>}
    </section>
    {p.owner && <><p className={styles.section}>{t("運営者だけ", "OWNER ONLY")}</p>
      <ul className={`${styles.rows} ${on ? "" : styles.rowsOff}`}>{row(icons.pencil, t("週刊の下書き", "Weekly drafts"), t("下書きができたときにお知らせ", "When a draft is ready"), prefs.weeklyDraft ?? false, v => p.onPrefs({ weeklyDraft: v }))}</ul></>}
    <p className={styles.foot}>{t("通知の設定は、この端末だけに反映されます。", "These settings apply to this device only.")}</p>
    {sheets}
  </div>;
}
