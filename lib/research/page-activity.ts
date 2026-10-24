/** Resume public feeds after app switching or a back/forward-cache restore. */
export function observePageActivity(resume: () => void, pause: () => void) {
  const visible = () => { if (document.visibilityState === "visible") resume(); else pause(); };
  const hide = () => pause();
  document.addEventListener("visibilitychange", visible);
  window.addEventListener("pagehide", hide);
  window.addEventListener("pageshow", visible);
  window.addEventListener("focus", visible);
  window.addEventListener("online", visible);
  if (document.visibilityState === "hidden") pause();
  return () => {
    document.removeEventListener("visibilitychange", visible);
    window.removeEventListener("pagehide", hide);
    window.removeEventListener("pageshow", visible);
    window.removeEventListener("focus", visible);
    window.removeEventListener("online", visible);
  };
}
