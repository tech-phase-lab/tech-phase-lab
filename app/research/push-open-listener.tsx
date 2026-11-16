"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { browserPushOpenSources, createPushOpener, PUSH_BANNER_MS, type PushBanner } from "@/lib/research/push-open";
import { createPushDiagnostics, PUSH_DIAG_EVENT, pushDiagnosticSignature, recentPushDiagnostic, type PushDiagnostic } from "@/lib/research/push-diagnostic";
import { refreshPushWorker, type ContainerLike } from "@/lib/research/push-sw-facts";
import { useOwnerAccount } from "./member-display-provider";
import { useResearchLanguage } from "./use-research-language";
import styles from "./push-open-banner.module.css";

// After the app is shown again, look a few times: on iOS the app can come to the front before the worker has written the tap down.
const LOOKS_MS = [0, 700, 2000];
// Ask the browser for a newer worker at most this often (on launch and when the app is shown again).
const UPDATE_EVERY_MS = 10 * 60_000;
// The owner's step record is sent this long after its last change, so one look sends one line.
const DIAG_SEND_DELAY_MS = 3000;

const storage = () => { try { return window.localStorage; } catch { return null; } };

/** A tapped phone notification opens its own page even when the app was already open on another one (owner, Nov 15). The service
 * worker asks this page to move when it cannot navigate the window itself; on the iPhone home-screen app, where that message may never
 * arrive, the tap the worker wrote down is read when the app is shown again. When iOS never tells the worker about the tap at all
 * (WebKit 282935), a notice that arrived while the app is shown, or within 30 minutes before it comes back to the front (or that the
 * phone still lists, up to a day), gets a banner at
 * the top: 「新しい通知：<title>」 with 開く and ✕, hidden after 15 seconds. Mounted in the research layout, so on every /research page.
 * Also checks for a newer worker, and keeps the step record (sent to the server log for the owner's account only). */
export default function PushOpenListener() {
  const router = useRouter();
  const [lang] = useResearchLanguage();
  const ownerAccount = useOwnerAccount();
  const owner = useRef(ownerAccount);
  useEffect(() => { owner.current = ownerAccount; }, [ownerAccount]);
  const [banner, setBanner] = useState<PushBanner | null>(null);
  const actions = useRef<{ open: () => void; dismiss: () => void }>({ open: () => {}, dismiss: () => {} });
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    const container = navigator.serviceWorker;
    let sendTimer: ReturnType<typeof setTimeout> | undefined;
    let lastSent = "";
    // Owner accounts only (the server refuses everyone else): the latest step record, once per change, with nothing personal in it.
    function send(record: PushDiagnostic) {
      clearTimeout(sendTimer);
      if (!owner.current) return;
      sendTimer = setTimeout(() => {
        const signature = pushDiagnosticSignature(record);
        if (!owner.current || signature === lastSent || !recentPushDiagnostic(record, Date.now())) return;
        lastSent = signature;
        void fetch("/api/research/notifications", { method: "POST", credentials: "same-origin", keepalive: true,
          headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "diagnostic", record }) }).catch(() => { lastSent = ""; });
      }, DIAG_SEND_DELAY_MS);
    }
    const diagnostics = createPushDiagnostics({ storage: storage(), changed: record => {
      window.dispatchEvent(new Event(PUSH_DIAG_EVENT));
      send(record);
    } });
    let hideTimer: ReturnType<typeof setTimeout> | undefined;
    const shown = () => document.visibilityState === "visible";
    function timeBanner() {
      clearTimeout(hideTimer);
      if (shown() && opener.banner()) hideTimer = setTimeout(() => opener.dismissBanner("timeout"), PUSH_BANNER_MS);
    }
    const opener = createPushOpener({
      sources: browserPushOpenSources(container, typeof caches === "undefined" ? undefined : caches, window.location.origin),
      location: () => window.location,
      navigation: { push: href => router.push(href), setHash: hash => { window.location.hash = hash; } },
      banner: notice => { setBanner(notice); if (notice) timeBanner(); else clearTimeout(hideTimer); },
      diagnostics,
    });
    actions.current = { open: () => { opener.openBanner(); }, dismiss: () => opener.dismissBanner("close") };
    const timers = new Set<ReturnType<typeof setTimeout>>();
    let lastUpdate = 0;
    const later = (fn: () => void, ms: number) => { const id = setTimeout(() => { timers.delete(id); fn(); }, ms); timers.add(id); };
    function update() {
      if (Date.now() - lastUpdate < UPDATE_EVERY_MS) return;
      lastUpdate = Date.now();
      // Nov 16: also moves a registration made before then onto updateViaCache "none" (registered again, which checks for a new version too).
      refreshPushWorker(container as unknown as ContainerLike).catch(() => { /* offline: checked again next time */ });
    }
    // Nov 16: when the app comes to the front (or is launched), so a notice that vanished from the phone's list just before can be
    // told apart from one swiped away earlier (lib/research/push-open.ts, PUSH_TAP_GAP_MS).
    let away = true;
    function look() {
      if (!shown()) { away = true; clearTimeout(hideTimer); return; }
      if (away) { away = false; opener.foreground(Date.now()); }
      // focus, pageshow and visibilitychange arrive together on resume: one series of looks is enough.
      for (const id of timers) clearTimeout(id);
      timers.clear();
      diagnostics.note({ foreground: Date.now(), controlled: Boolean(container.controller),
        standalone: window.matchMedia?.("(display-mode: standalone)").matches === true || (navigator as { standalone?: boolean }).standalone === true });
      for (const ms of LOOKS_MS) later(() => { void opener.check(); }, ms);
      timeBanner();
      update();
    }
    const onMessage = (event: MessageEvent) => { opener.message(event); };
    container.addEventListener("message", onMessage);
    container.startMessages?.();
    look();
    window.addEventListener("pageshow", look);
    window.addEventListener("focus", look);
    document.addEventListener("visibilitychange", look);
    return () => {
      container.removeEventListener("message", onMessage);
      window.removeEventListener("pageshow", look);
      window.removeEventListener("focus", look);
      document.removeEventListener("visibilitychange", look);
      for (const id of timers) clearTimeout(id);
      clearTimeout(hideTimer);
      clearTimeout(sendTimer);
    };
  }, [router]);
  if (!banner) return null;
  const ja = lang === "ja";
  const text = banner.title ? `${ja ? "新しい通知：" : "New notification: "}${banner.title}` : ja ? "新しい通知" : "New notification";
  return <div className={styles.banner} role="status" aria-live="polite">
    <p className={styles.text}>{text}</p>
    <button type="button" className={styles.open} onClick={() => actions.current.open()}>{ja ? "開く" : "Open"}</button>
    <button type="button" className={styles.close} aria-label={ja ? "閉じる" : "Dismiss"} onClick={() => actions.current.dismiss()}>✕</button>
  </div>;
}
