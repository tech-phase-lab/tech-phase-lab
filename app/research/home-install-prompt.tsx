"use client";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { CLOSED_EVENT, CLOSED_KEY, POPUP_OPEN_ATTRIBUTE, SHOWN_KEY, SHOW_EVENT, installContext, isStandalone, popupKind, shouldShow, writeFlag, type PopupKind } from "@/lib/research/home-install";
import { useMemberDisplay, useMemberSettled } from "./member-display-provider";
import { useResearchLanguage } from "./use-research-language";
import styles from "./home-install-prompt.module.css";

type InstallEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> };
const icon = (path: ReactNode) => <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#9fb0e8" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{path}</svg>;
const share = icon(<><path d="M12 15V4M8 8l4-4 4 4" /><path d="M6 11H5a1 1 0 0 0-1 1v7a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-7a1 1 0 0 0-1-1h-1" /></>);
const plus = icon(<><rect x="4" y="4" width="16" height="16" rx="3" /><path d="M12 8v8M8 12h8" /></>);
const done = icon(<path d="M5 12.5l4.5 4.5L19 7.5" />);

/** Where the browser keeps its flags; blocked storage just means the popup may show again. */
const storage = () => { try { return window.localStorage; } catch { return null; } };

export default function HomeInstallPrompt() {
  const pathname = usePathname();
  const plan = useMemberDisplay();
  const settled = useMemberSettled();
  const [lang] = useResearchLanguage();
  const ja = lang === "ja";
  const [kind, setKind] = useState<PopupKind>("none");
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState<"" | "done" | "failed">("");
  const install = useRef<InstallEvent | null>(null);
  const [androidReady, setAndroidReady] = useState(false);
  const signedIn = settled && plan !== null;
  const context = () => installContext(navigator.userAgent, isStandalone(window));
  // Android: Chrome offers its own install prompt when the site qualifies; keep it for the one-tap button.
  useEffect(() => {
    const keep = (event: Event) => { event.preventDefault(); install.current = event as InstallEvent; setAndroidReady(true); };
    window.addEventListener("beforeinstallprompt", keep);
    return () => window.removeEventListener("beforeinstallprompt", keep);
  }, []);
  // The notification screen asks for it again when "オンにする" is pressed on an iPhone that has not added the app.
  useEffect(() => {
    const again = () => { const next = popupKind(context(), false); if (next !== "none") { setKind(next); setCopied(""); setOpen(true); } };
    window.addEventListener(SHOW_EVENT, again);
    return () => window.removeEventListener(SHOW_EVENT, again);
  }, []);
  // On the home screen, once, for a signed-in member.
  useEffect(() => {
    if (!signedIn || pathname !== "/research" || open) return;
    // Chrome on a computer also offers its own install prompt; only an Android phone gets the one-tap popup (owner, Nov 10).
    const next = popupKind(context(), androidReady && /Android/.test(navigator.userAgent) && !isStandalone(window));
    if (!shouldShow(next, storage())) return;
    // Opened a moment after the page settles, never inside the render pass.
    const timer = setTimeout(() => { writeFlag(storage(), SHOWN_KEY); setKind(next); setCopied(""); setOpen(true); }, 600);
    return () => clearTimeout(timer);
  }, [signedIn, pathname, androidReady, open]);
  const close = () => { writeFlag(storage(), CLOSED_KEY); setOpen(false); window.dispatchEvent(new Event(CLOSED_EVENT)); };
  useEffect(() => {
    const root = document.documentElement;
    if (open) root.setAttribute(POPUP_OPEN_ATTRIBUTE, "1"); else root.removeAttribute(POPUP_OPEN_ATTRIBUTE);
    return () => root.removeAttribute(POPUP_OPEN_ATTRIBUTE);
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const key = (event: KeyboardEvent) => { if (event.key === "Escape") close(); };
    document.addEventListener("keydown", key);
    return () => document.removeEventListener("keydown", key);
  }, [open]);
  if (!open || kind === "none") return null;
  async function copy() {
    try { await navigator.clipboard.writeText(window.location.href); setCopied("done"); } catch { setCopied("failed"); }
  }
  async function addAndroid() {
    const event = install.current;
    if (!event) return;
    try { await event.prompt(); await event.userChoice; } catch { /* the browser decides */ }
    install.current = null; close();
  }
  return <div className={styles.scrim} role="dialog" aria-modal="true" aria-label={ja ? "ホーム画面に追加" : "Add to Home Screen"}>
    <div className={styles.box}>
      <div className={styles.pop}>
        <div className={styles.head}>
          <div className={styles.av}><i /><i />
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img className={styles.rz} src="/a2hs/rizel.jpg" alt="" width={60} height={60} />
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img className={styles.bd} src="/tech-phase-192.png" alt="" width={28} height={28} />
          </div>
          <h2 className={styles.title}>{ja ? <>Tech Phaseのアプリを<br />ホーム画面に追加しよう!!</> : <>Add the Tech Phase app<br />to your Home Screen!</>}</h2>
        </div>
        {kind === "android" ? <button type="button" className={styles.install} onClick={() => void addAndroid()}>{ja ? "ホーム画面に追加" : "Add to Home Screen"}</button> : <>
          <ol className={styles.steps}>
            <li className={styles.step}><span className={styles.n}>1</span><span className={styles.t}>{ja ? <>画面下の<b>共有</b>ボタンをタップ</> : <>Tap the <b>Share</b> button at the bottom</>}</span>{share}</li>
            <li className={styles.step}><span className={styles.n}>2</span><span className={styles.t}>{ja ? <><b>ホーム画面に追加</b>を選ぶ</> : <>Choose <b>Add to Home Screen</b></>}</span>{plus}</li>
            <li className={styles.step}><span className={styles.n}>3</span><span className={styles.t}>{ja ? <>右上の<b>追加</b>をタップ</> : <>Tap <b>Add</b> at the top right</>}</span>{done}</li>
          </ol>
          {kind === "ios-safari"
            ? <div className={styles.foot}>{/* eslint-disable-next-line @next/next/no-img-element */}<img src="/a2hs/safari.png" alt="" width={16} height={16} />{ja ? "Safari以外のブラウザでは追加できません" : "Only Safari can add it to the Home Screen"}</div>
            : <>
              <button type="button" className={styles.copy} onClick={() => void copy()}>{copied === "done" ? (ja ? "コピーしました" : "Copied") : copied === "failed" ? (ja ? "コピーできませんでした" : "Could not copy") : (ja ? "アドレスをコピー" : "Copy address")}</button>
              <div className={`${styles.foot} ${styles.footPlain}`}>{/* eslint-disable-next-line @next/next/no-img-element */}<img src="/a2hs/safari.png" alt="" width={16} height={16} />{ja ? "Safariに貼り付けて開いてください" : "Paste it into Safari to open"}</div>
            </>}
        </>}
      </div>
      <button type="button" className={styles.x} aria-label={ja ? "閉じる" : "Close"} onClick={close}><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg></button>
    </div>
  </div>;
}
