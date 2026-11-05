/** "Add to Home Screen" guide (owner, Nov 5): who sees which popup, and what is remembered in this browser. */
export type InstallContext = "ios-safari" | "ios-other" | "none";

// Browsers on iPhone that are not Safari (Chrome, Firefox, Edge, Opera, and the in-app browsers of common apps).
// A browser we cannot tell is treated as Safari, so the Safari popup is the one shown when in doubt.
const IOS_OTHER = /CriOS|FxiOS|EdgiOS|OPiOS|OPT\/|GSA\/|DuckDuckGo|YJApp|NAVER|KAKAOTALK|Line\/|FBAN|FBAV|FB_IAB|Instagram|Twitter|MicroMessenger|MQQBrowser|WebView|; wv\)/i;

export function installContext(userAgent: string, standalone: boolean): InstallContext {
  // Only iPhone; already added (standalone display) gets nothing.
  if (!/iPhone/.test(userAgent) || standalone) return "none";
  return IOS_OTHER.test(userAgent) ? "ios-other" : "ios-safari";
}

/** Opened from the Home Screen icon. */
export function isStandalone(win: { navigator: object; matchMedia: (query: string) => { matches: boolean } }) {
  return (win.navigator as { standalone?: boolean }).standalone === true || win.matchMedia("(display-mode: standalone)").matches;
}

/** Which popup to draw: the two iPhone ones, or Android's one-tap install when the browser offers it. */
export type PopupKind = InstallContext | "android";
export function popupKind(context: InstallContext, androidCanInstall: boolean): PopupKind {
  return context !== "none" ? context : androidCanInstall ? "android" : "none";
}

/** The popup is shown once per browser; closing it with × means never again. The notification "オンにする" press can show it again. */
export const SHOWN_KEY = "tech-phase:a2hs-shown:v1";
export const CLOSED_KEY = "tech-phase:a2hs-closed:v1";
export const SHOW_EVENT = "tech-phase:show-a2hs";

export type Store = { getItem(key: string): string | null; setItem(key: string, value: string): void };
export function readFlag(store: Store | null, key: string) {
  try { return store?.getItem(key) === "1"; } catch { return false; }
}
export function writeFlag(store: Store | null, key: string) {
  try { store?.setItem(key, "1"); } catch { /* storage may be blocked */ }
}

/** Show it on first sight; never again once seen or closed. A forced show (the notification button) ignores both. */
export function shouldShow(context: PopupKind, store: Store | null, forced = false) {
  if (context === "none") return false;
  return forced || (!readFlag(store, SHOWN_KEY) && !readFlag(store, CLOSED_KEY));
}
