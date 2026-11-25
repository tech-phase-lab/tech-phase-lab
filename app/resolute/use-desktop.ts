"use client";
import { useSyncExternalStore } from "react";

/** RESOLUTE's PC layout (owner, Nov 25): 1024px wide or more. Phones and narrow windows keep the phone layout.
 * The server and the first client render use the phone layout; the PC one follows straight after hydration. */
export const DESKTOP_QUERY = "(min-width: 1024px)";
function subscribe(change: () => void) {
 const query = window.matchMedia(DESKTOP_QUERY);
 query.addEventListener("change", change);
 return () => query.removeEventListener("change", change);
}
export function useDesktop() {
 return useSyncExternalStore(subscribe, () => window.matchMedia(DESKTOP_QUERY).matches, () => false);
}
/** A touch screen (phone or tablet) at PC width still gets this device's own notification switch. */
export function useTouchDevice() {
 return useSyncExternalStore(() => () => {}, () => window.matchMedia("(hover: none) and (pointer: coarse)").matches, () => false);
}
