/** The address-bar hash picks the home view (保存したリサーチ, 監視22銘柄 ...). Next.js rewrites the
 * address bar from its own router state, and that can put the old hash back a moment after a menu tap
 * (owner, Oct 16: tapping a menu item sometimes landed on the home view). The hash chosen by a tap is
 * therefore remembered here and wins over the address bar until the reader really navigates (back,
 * forward, a typed hash, another page). */
let remembered: { path: string; hash: string } | null = null;
let installed = false;

const forget = (event?: Event) => {
  // A synthetic hashchange (ours) carries no URLs; a real one does.
  if (event?.type === "hashchange" && !(event as HashChangeEvent).newURL) return;
  remembered = null;
};

export function rememberHash(hash: string) {
  if (typeof window === "undefined") return;
  if (!installed) {
    installed = true;
    window.addEventListener("popstate", forget);
    window.addEventListener("hashchange", forget);
  }
  remembered = { path: window.location.pathname, hash };
}

/** The hash the screen should act on: a tapped one while it still applies, else the address bar's. */
export function effectiveHash(): string {
  if (typeof window === "undefined") return "";
  if (remembered && remembered.path === window.location.pathname) return remembered.hash;
  return window.location.hash;
}

/** Test hook. */
export function resetRememberedHash() { remembered = null; }
