"use client";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { handlePushOpenMessage } from "@/lib/research/push-open";

/** A tapped phone notification opens its own page even when the app was already open on another one (owner, Nov 15):
 * the service worker asks this page to move when it cannot navigate the window itself. Also checks for a newer worker. */
export default function PushOpenListener() {
  const router = useRouter();
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    const container = navigator.serviceWorker;
    const onMessage = (event: MessageEvent) => {
      handlePushOpenMessage(event, window.location, {
        push: href => router.push(href),
        setHash: hash => { window.location.hash = hash; },
      });
    };
    container.addEventListener("message", onMessage);
    container.startMessages?.();
    container.getRegistration("/research").then(registration => registration?.update()).catch(() => { /* offline: checked again next time */ });
    return () => container.removeEventListener("message", onMessage);
  }, [router]);
  return null;
}
