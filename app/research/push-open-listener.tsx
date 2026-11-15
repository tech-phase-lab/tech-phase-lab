"use client";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { browserPushOpenSources, createPushOpener } from "@/lib/research/push-open";

// After the app is shown again, look a few times: on iOS the app can come to the front before the worker has written the tap down.
const LOOKS_MS = [0, 700, 2000];
// While a notice shown a moment ago may still be tapped (an iPhone app already open may never tell the worker), look this often.
const WATCH_MS = 1000;
// Ask the browser for a newer worker at most this often (on launch and when the app is shown again).
const UPDATE_EVERY_MS = 10 * 60_000;

/** A tapped phone notification opens its own page even when the app was already open on another one (owner, Nov 15). The service
 * worker asks this page to move when it cannot navigate the window itself; on the iPhone home-screen app, where that message may never
 * arrive, the tap the worker wrote down is read when the app is shown again. Mounted in the research layout, so on every /research page.
 * Also checks for a newer worker. */
export default function PushOpenListener() {
  const router = useRouter();
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    const container = navigator.serviceWorker;
    const opener = createPushOpener({
      sources: browserPushOpenSources(container, typeof caches === "undefined" ? undefined : caches, window.location.origin),
      location: () => window.location,
      navigation: { push: href => router.push(href), setHash: hash => { window.location.hash = hash; } },
    });
    const timers = new Set<ReturnType<typeof setTimeout>>();
    let watch: ReturnType<typeof setTimeout> | undefined;
    let lastUpdate = 0;
    const later = (fn: () => void, ms: number) => { const id = setTimeout(() => { timers.delete(id); fn(); }, ms); timers.add(id); };
    const shown = () => document.visibilityState === "visible";
    function keepWatching() {
      clearTimeout(watch);
      if (!shown() || !opener.watching()) return;
      watch = setTimeout(() => { void opener.check().finally(keepWatching); }, WATCH_MS);
    }
    function update() {
      if (Date.now() - lastUpdate < UPDATE_EVERY_MS) return;
      lastUpdate = Date.now();
      container.getRegistration("/research").then(registration => registration?.update()).catch(() => { /* offline: checked again next time */ });
    }
    function look() {
      if (!shown()) return;
      // focus, pageshow and visibilitychange arrive together on resume: one series of looks is enough.
      for (const id of timers) clearTimeout(id);
      timers.clear();
      for (const ms of LOOKS_MS) later(() => { void opener.check().finally(keepWatching); }, ms);
      update();
    }
    const onMessage = (event: MessageEvent) => { opener.message(event); keepWatching(); };
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
      clearTimeout(watch);
    };
  }, [router]);
  return null;
}
