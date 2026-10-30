"use client";
import Link from "next/link";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { waitForIdentity } from "@/lib/research/member-recovery";
import type { Language } from "@/lib/research/data";
import styles from "./price-targets-panel.module.css";
import NotificationPageView, { type Preferences } from "./notification-page-view";

const DEVICE_KEY = "tech-phase:notification-device-state";
const readDeviceState = () => { try { return localStorage.getItem(DEVICE_KEY) ?? ""; } catch { return ""; } };
type State = "checking" | "off" | "on" | "unknown" | "blocked" | "unsupported" | "unavailable" | "sign-in" | "pro-required";
export default function NotificationSettings({ lang, initiallyOpen = false, page = false }: { lang: Language; initiallyOpen?: boolean; page?: boolean }) {
  const [open, setOpen] = useState(initiallyOpen || page);
  const [state, setState] = useState<State>("checking");
  const [hasSubscription, setHasSubscription] = useState(false);
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [testSent, setTestSent] = useState(false);
  const [received, setReceived] = useState(false);
  const [retryAt, setRetryAt] = useState(0);
  const inspection = useRef(0);
  const operation = useRef(false);
  const pendingInspection = useRef(false);
  const [refresh, setRefresh] = useState(0);
  // Per-device choices live on the server. Nothing stored in this browser is ever sent back.
  // The last settled device state is remembered only to draw the card at once; the check below has the final say.
  const remembered = useSyncExternalStore(() => () => {}, readDeviceState, () => "");
  const [starting, setStarting] = useState(false);
  const [prefs, setPrefs] = useState<Preferences | null>(null);
  const [prefsState, setPrefsState] = useState<"idle" | "loading" | "ready" | "error" | "unsupported">("idle");
  const [prefsMessage, setPrefsMessage] = useState("");
  const confirmed = useRef<Preferences | null>(null);
  const saveQueue = useRef<Promise<void>>(Promise.resolve());
  const saving = useRef(0);
  const t = (ja: string, en: string) => lang === "ja" ? ja : en;
  async function loadPreferences(subscription: PushSubscription, signal: AbortSignal, active: () => boolean) {
    // Wait for any save in flight so an older read cannot replace a newer choice.
    if (saving.current) return;
    setPrefsState(current => current === "ready" ? current : "loading");
    try {
      const response = await fetch("/api/research/notifications", { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "preferences", subscription: subscription.toJSON() }), signal });
      const result = await response.json();
      if (!active() || saving.current) return;
      if (!response.ok || !result.ok || !result.preferences) throw new Error("preferences");
      confirmed.current = result.preferences; setPrefs(result.preferences); setPrefsState("ready"); setPrefsMessage("");
    } catch { if (active()) { setPrefsState("error"); setPrefsMessage(t("設定を読み込めませんでした。再読み込みしてください。", "Could not load your settings. Reload to try again.")); } }
  }
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    let requestController: AbortController | undefined;
    let resumeTimer: ReturnType<typeof setTimeout> | undefined;
    let expiryTimer: ReturnType<typeof setTimeout> | undefined;
    async function inspect() {
      if (operation.current) { pendingInspection.current = true; return; }
      pendingInspection.current = false;
      const current = ++inspection.current;
      requestController?.abort();
      requestController = new AbortController();
      const signal = AbortSignal.any([requestController.signal, AbortSignal.timeout(15_000)]);
      const active = () => !cancelled && current === inspection.current && !signal.aborted;
      clearTimeout(expiryTimer);
      setState("checking"); setKey(""); setTestSent(false); setReceived(false); setMessage("");
      try {
        const response = await fetch("/api/research/notifications", { cache: "no-store", signal });
        const config = await response.json();
        if (!active()) return;
        // Resolve membership before device guidance so signed-out and Free users
        // are not asked to change permissions for a feature they cannot use yet.
        const supported = "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
        const registration = supported ? await waitForIdentity(navigator.serviceWorker.getRegistration("/research"), signal) : undefined;
        const subscription = registration ? await waitForIdentity(registration.pushManager.getSubscription(), signal) : undefined;
        if (!active()) return;
        setHasSubscription(Boolean(subscription));
        if (config.reason === "sign-in" || config.reason === "pro-required") { setState(config.reason); return; }
        if (!response.ok || !config.enabled || !config.publicKey) { setState("unavailable"); return; }
        setPrefsState(current => config.preferencesVersion === 1 ? current === "unsupported" ? "idle" : current : "unsupported");
        if (!Number.isFinite(config.validUntil) || config.validUntil <= Date.now()) { setState("pro-required"); return; }
        // A capped browser timer is a recheck, not proof that paid access expired.
        expiryTimer = setTimeout(() => { void inspect(); }, Math.min(config.validUntil - Date.now(), 2_147_483_647));
        if (!supported) { setState("unsupported"); return; }
        if (Notification.permission === "denied") { setState("blocked"); return; }
        setKey(config.publicKey);
        if (subscription) {
          const check = await fetch("/api/research/notifications", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "status", subscription: subscription.toJSON() }), signal });
          const result = await check.json();
          if (active()) setState(check.status === 401 ? "sign-in" : check.status === 403 ? "pro-required" : check.ok && result.ok ? result.registered ? "on" : "off" : "unknown");
          if (active() && page && config.preferencesVersion === 1 && check.ok && result.ok && result.registered) await loadPreferences(subscription, signal, active);
        } else if (active()) setState("off");
      } catch { if (!cancelled && current === inspection.current) setState("unavailable"); }
    }
    const visible = () => { if (document.visibilityState === "visible") { clearTimeout(resumeTimer); resumeTimer = setTimeout(() => { void inspect(); }, 0); } };
    void inspect();
    window.addEventListener("focus", visible);
    window.addEventListener("pageshow", visible);
    window.addEventListener("online", visible);
    document.addEventListener("visibilitychange", visible);
    window.addEventListener("tech-phase:membership-changed", inspect);
    return () => { cancelled = true; requestController?.abort(); clearTimeout(expiryTimer); clearTimeout(resumeTimer); window.removeEventListener("focus", visible); window.removeEventListener("pageshow", visible); window.removeEventListener("online", visible); document.removeEventListener("visibilitychange", visible); window.removeEventListener("tech-phase:membership-changed", inspect); };
  }, [open, refresh]);
  async function request(action: string, subscription: PushSubscription) {
    const response = await fetch("/api/research/notifications", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, subscription: subscription.toJSON(), allTargets: true, language: lang }),
      signal: AbortSignal.timeout(15_000),
    });
    if (response.status === 401 || response.status === 403) { setState(response.status === 401 ? "sign-in" : "pro-required"); throw new Error(t("ログインとPRO会員の有効期限を確認してください。", "Check your sign-in and PRO membership.")); }
    const result = await response.json();
    if (!response.ok || !result.ok) throw new Error(t("接続できませんでした。もう一度お試しください。", "Unable to connect. Please try again."));
    return result;
  }
  async function run(action: "enable" | "disable" | "status" | "test") {
    if (operation.current) return;
    operation.current = true;
    inspection.current++; // An older inspection must not overwrite this device action.
    setBusy(true); setMessage("");
    try {
      if (action === "enable") {
        if (Notification.permission !== "granted") {
          const permission = await Notification.requestPermission();
          if (permission !== "granted") { setState(permission === "denied" ? "blocked" : "off"); return; }
        }
      }
      const registration = await navigator.serviceWorker.register("/research-sw.js", { scope: "/" });
      // Wait for installation without relying on an indefinitely pending ready promise.
      if (!registration.active) await new Promise<void>((resolve, reject) => {
        const worker = registration.installing || registration.waiting;
        if (!worker) { reject(new Error("Service worker unavailable")); return; }
        const timeout = setTimeout(() => { worker.removeEventListener("statechange", changed); reject(new Error("Service worker timeout")); }, 10_000);
        function changed() { if (worker?.state === "activated") { clearTimeout(timeout); worker.removeEventListener("statechange", changed); resolve(); } }
        worker.addEventListener("statechange", changed); changed();
      });
      let subscription = await registration.pushManager.getSubscription();
      if (action === "disable") {
        // A successful browser unsubscribe stops this device even if the server is unavailable.
        if (subscription) {
          if (!await subscription.unsubscribe()) throw new Error(t("停止できませんでした。", "Could not stop notifications."));
          try { await request("remove", subscription); } catch { /* Browser endpoint has already been revoked. */ }
        }
        setHasSubscription(false); setState("off"); setTestSent(false); setReceived(false); confirmed.current = null; setPrefs(null); setPrefsState("idle"); return;
      }
      if (action === "enable") {
        const bytes = Uint8Array.from(atob(key.replace(/-/g, "+").replace(/_/g, "/")), c => c.charCodeAt(0));
        subscription = subscription || await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: bytes });
        setHasSubscription(true);
        const result = await request("register", subscription);
        setState(result.registered ? "on" : "unknown"); setReceived(false); setTestSent(false);
        if (page && result.registered) await loadPreferences(subscription, AbortSignal.timeout(15_000), () => true);
      } else if (!subscription) { setState("off"); }
      else if (action === "status") {
        const result = await request("status", subscription); setState(result.registered ? "on" : "off");
      } else {
        if (Date.now() < retryAt) throw new Error(t("次のテストは1分後に送れます。", "Wait one minute before testing again."));
        setReceived(false); setTestSent(false); setRetryAt(Date.now() + 60_000);
        const result = await request("test", subscription);
        if (result.expired) { setState("off"); await subscription.unsubscribe(); }
        setTestSent(result.accepted === true);
        const failure = result.retryAfter ? t("次のテストは1分後に送れます。", "Wait one minute before testing again.")
          : result.expired ? t("端末の通知登録が期限切れです。通知をオンにし直してください。", "This device subscription expired. Turn notifications on again.")
          : result.providerStatus === 401 || result.providerStatus === 403 ? t("通知サービスの送信認証で失敗しました。管理者が設定を確認します。", "Push service authentication failed. The administrator needs to check the configuration.")
          : result.providerStatus === 429 ? t("通知サービスが送信を制限しています。時間をおいて再試行してください。", "The push service is limiting requests. Try again later.")
          : result.providerStatus === 0 ? t("通知送信処理でエラーが発生しました。管理者がログを確認します。", "The push sender encountered an error. The administrator needs to inspect the logs.")
          : t("通知サービスに受け付けられませんでした。1分後に再試行できます。", "The push service did not accept the message. You can retry in one minute.");
        setMessage(result.accepted ? t("送信を受け付けました。スマホに届いたら「届きました」を押してください。", "Send accepted. Select Received after it appears on your phone.") : failure);
      }
    } catch (error) { setMessage(error instanceof Error ? error.message : t("接続を確認してください。", "Check your connection.")); if (action === "enable") setState(current => current === "sign-in" || current === "pro-required" ? current : "unknown"); }
    finally { operation.current = false; setBusy(false); if (pendingInspection.current) setRefresh(value => value + 1); }
  }
  const label = { "sign-in": t("通知を利用するにはログインしてください", "Sign in to use notifications"), "pro-required": t("スマホ通知はPRO会員向けです", "Phone notifications are available with PRO"), checking: t("確認中…", "Checking…"), off: t("この端末：通知オフ", "This device: off"), on: t("この端末：通知オン", "This device: on"), unknown: t("この端末：登録状態を確認", "This device: verify registration"), blocked: t("この端末：通知が許可されていません", "This device: permission blocked"), unsupported: t("このブラウザでは通知を利用できません", "Notifications unavailable in this browser"), unavailable: t("通知サービスに接続できません", "Notification service unavailable") }[state];
  const usable = ["off", "on", "unknown"].includes(state);
  // Saves run one at a time. A failed save returns to the last value the server confirmed.
  function savePreferences(patch: Partial<Preferences>) {
    if (!prefs || prefsState !== "ready") return;
    setPrefs({ ...prefs, ...patch }); setPrefsMessage("");
    saving.current++;
    saveQueue.current = saveQueue.current.then(async () => {
      try {
        const registration = await navigator.serviceWorker.getRegistration("/research");
        const subscription = await registration?.pushManager.getSubscription();
        if (!subscription) throw new Error("subscription");
        const response = await fetch("/api/research/notifications", { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "save-preferences", subscription: subscription.toJSON(), preferences: patch }), signal: AbortSignal.timeout(15_000) });
        const result = await response.json();
        if (response.status === 401 || response.status === 403) setState(response.status === 401 ? "sign-in" : "pro-required");
        if (!response.ok || !result.ok || !result.preferences) throw new Error("save");
        confirmed.current = result.preferences;
        if (saving.current === 1) setPrefs(result.preferences);
      } catch {
        if (saving.current === 1 && confirmed.current) setPrefs(confirmed.current);
        setPrefsMessage(t("保存できませんでした。もう一度お試しください。", "Could not save. Please try again."));
      } finally { saving.current--; }
    });
  }
  // While the check runs the card keeps showing the remembered state (off on a first visit).
  const shownState: State = state === "checking" ? remembered === "on" ? "on" : "off" : state;
  useEffect(() => {
    if (state === "on" || state === "off") { try { localStorage.setItem(DEVICE_KEY, state); } catch { /* storage may be blocked */ } }
  }, [state]);
  // A press made before the check finished waits for it, then turns notifications on.
  useEffect(() => {
    if (!starting || state === "checking") return;
    const id = setTimeout(() => { setStarting(false); if (state === "off") void run("enable"); }, 0);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [starting, state]);
  const toggle = () => { if (state === "checking" && shownState === "off") { setStarting(true); return; } void run(shownState === "on" ? "disable" : "enable"); };
  if (page) return <NotificationPageView lang={lang} state={shownState} label={label} busy={busy} starting={starting} usable={usable || state === "checking"} hasSubscription={hasSubscription} message={message} testSent={testSent} received={received}
    prefs={prefs} prefsState={prefsState} prefsMessage={prefsMessage} onPrefs={savePreferences}
    onToggle={toggle} onDisable={() => void run("disable")} onTest={() => void run("test")} onRetry={() => setRefresh(value => value + 1)} onStatus={() => void run("status")} onReceived={() => { setReceived(true); setMessage(""); }} />;
  return <>
    <button type="button" className={styles.notificationToggle} aria-expanded={open} aria-controls={open ? "price-target-notifications" : undefined} onClick={() => setOpen(!open)}><svg className={styles.bellIcon} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 22a2.3 2.3 0 0 0 2.3-2.3H9.7A2.3 2.3 0 0 0 12 22zm6.6-6.4V11a6.6 6.6 0 0 0-5.1-6.4V3.9a1.5 1.5 0 0 0-3 0v.7A6.6 6.6 0 0 0 5.4 11v4.6L3.6 17.4V19h16.8v-1.6z"/></svg>{t("スマホ通知設定", "Phone notifications")}</button>
    {open && <div id="price-target-notifications" className={styles.notificationBody}>
      <strong className={styles.notificationTitle}>{t("目標株価・決算速報のスマホ通知", "Price target and earnings phone alerts")}</strong>
      <p role="status">{label}</p>
      {(state === "unavailable" || state === "checking") && <button type="button" disabled={busy} onClick={() => setRefresh(value => value + 1)}>{t("再確認", "Try again")}</button>}
      {(state === "sign-in" || state === "pro-required") && <Link href="/research/account">{t("ログイン・会員情報", "Sign in / Membership")}</Link>}
      {!usable && hasSubscription && <button type="button" disabled={busy} onClick={() => void run("disable")}>{t("この端末の通知をオフ", "Turn off on this device")}</button>}
      {state === "unsupported" && <p>{t("iPhoneではSafariの共有メニューからホーム画面に追加し、そのアイコンから開いてください。", "On iPhone, add this site to your Home Screen using Safari’s Share menu, then open that icon.")}</p>}
      {state === "blocked" && <p>{t("端末またはブラウザの設定で、Tech Phaseの通知を許可してください。", "Allow Tech Phase notifications in your device or browser settings.")}</p>}
      {usable && <>
        <div className={styles.notificationActions}>
          <button type="button" disabled={busy} onClick={() => void run(state === "on" ? "disable" : "enable")}>{state === "on" ? t("この端末の通知をオフ", "Turn off on this device") : t("通知をオンにする", "Turn on notifications")}</button>
          {state === "unknown" && <><button type="button" disabled={busy} onClick={() => void run("status")}>{t("登録状態を確認", "Check registration")}</button><button type="button" disabled={busy} onClick={() => void run("disable")}>{t("この端末の通知をオフ", "Turn off on this device")}</button></>}
          {state === "on" && <button type="button" disabled={busy} onClick={() => void run("test")}>{t("テスト通知を送る", "Send test notification")}</button>}
        </div>
        {state === "on" && <p><Link href="/research/notifications">{t("届く内容を選ぶ", "Choose what you receive")}</Link></p>}
        {state !== "on" && <p>{t("通知をオンにすると、この設定で届きます。", "This applies once notifications are on.")}</p>}
      </>}
      {busy && <p role="status">{t("処理中…", "Working…")}</p>}
      {message && <p role="status">{message}</p>}
      {testSent && !received && <button type="button" onClick={() => { setReceived(true); setMessage(""); }}>{t("届きました", "Received")}</button>}
      {received && <p role="status">{t("この端末で受信を確認しました。", "Receipt confirmed on this device.")}</p>}
    </div>}
  </>;
}
