/** 今夜のひと息: the phone's landscape view for the video (owner, Nov 26: 「スマホで自分で設定しないと動画が横画面にならないの不便すぎる」).
 *
 * The page cannot turn a phone that has rotation lock on, so the view does what it can on each phone:
 * - Android Chrome: the player box goes full screen and the screen is locked to landscape (Screen Orientation API). The lock
 *   needs full screen, so it comes after it. When either is refused the view leaves full screen and stays in the page, turned by
 *   CSS instead: the browser's own full-screen style sets `transform: none !important`, so a full-screen box cannot be turned.
 * - iPhone Safari: there is no full screen for page elements and no orientation lock (screen.orientation.lock is missing, and
 *   the WebKit bug on it, 257695, says iPhone needs the HTML full-screen API first). Safari's own video player
 *   (webkitEnterFullscreen) only turns with the phone, and Apple says rotation lock keeps the screen "so that it doesn't
 *   change when you rotate iPhone", so with the lock on it stays upright. The view therefore fills the page and the CSS turns it
 *   90° while the page is upright, which gives a landscape picture with the lock on as well.
 * When the phone is held sideways (lock off, or the Android lock took), the page is landscape and nothing is turned.
 * PCs keep the plain full-screen button. */

type FullscreenTarget = { requestFullscreen?: (options?: FullscreenOptions) => Promise<void>; webkitRequestFullscreen?: () => void };
type OrientationLike = { lock?: (orientation: string) => Promise<void>; unlock?: () => void };
export type LandscapeEnvironment = {
 fullscreenElement: () => Element | null;
 exitFullscreen?: () => Promise<void>;
 orientation?: OrientationLike | null;
};

export function browserLandscapeEnvironment(): LandscapeEnvironment {
 const orientation = (typeof screen !== "undefined" ? (screen.orientation as unknown as OrientationLike | undefined) : undefined) ?? null;
 return {
  fullscreenElement: () => document.fullscreenElement,
  exitFullscreen: document.exitFullscreen ? () => document.exitFullscreen() : undefined,
  orientation,
 };
}

/** How the view ended up: in real full screen with the screen locked sideways, or in the page (turned by CSS while upright). */
export type LandscapeMode = "locked" | "page";

/** Call from the tap itself (full screen needs the user's gesture). Never throws; resolves with the mode it reached. */
export async function enterLandscape(box: FullscreenTarget, env: LandscapeEnvironment): Promise<LandscapeMode> {
 if (typeof box.requestFullscreen !== "function") return "page";
 try { await box.requestFullscreen({ navigationUI: "hide" }); } catch { return "page"; }
 const lock = env.orientation?.lock;
 if (typeof lock === "function") { try { await lock.call(env.orientation, "landscape"); return "locked"; } catch { /* refused: fall back below */ } }
 if (env.fullscreenElement() && env.exitFullscreen) { try { await env.exitFullscreen(); } catch { /* already left */ } }
 return "page";
}

/** Undo whatever enterLandscape did. Safe to call more than once and when nothing was entered. */
export async function exitLandscape(env: LandscapeEnvironment): Promise<void> {
 try { env.orientation?.unlock?.call(env.orientation); } catch { /* not locked, or not supported */ }
 if (env.fullscreenElement() && env.exitFullscreen) { try { await env.exitFullscreen(); } catch { /* already left */ } }
}

/** Phones get the landscape view; PCs (and tablets at PC width) keep the plain full-screen button. */
export const LANDSCAPE_VIEW_QUERY = "(hover: none) and (pointer: coarse) and (max-width: 1023.98px)";
