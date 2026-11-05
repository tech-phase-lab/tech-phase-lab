"use client";
import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { readFavoriteThemes } from "@/lib/research/favorite-themes";
import { CLOSED_EVENT, POPUP_OPEN_ATTRIBUTE } from "@/lib/research/home-install";
import { useMemberDisplay, useMemberSettled, useOwnerAccount } from "./member-display-provider";
import ThemeTiles from "./theme-tiles";
import styles from "./first-question.module.css";

/** Once the account has answered or skipped, this browser stops asking without a server call. */
const DONE_KEY = "tech-phase:first-question-done:v1";
const store = () => { try { return window.localStorage; } catch { return null; } };

/** "最初の1問" (owner, Nov 5): shown once after the Home Screen popup. "あとで" and "まだ決めていない" skip it; the choice is saved with the account. */
export default function FirstQuestion() {
  const pathname = usePathname();
  const plan = useMemberDisplay();
  const settled = useMemberSettled();
  const owner = useOwnerAccount();
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const ready = settled && plan !== null && !owner && pathname === "/research";
  useEffect(() => {
    if (!ready || open) return;
    try { if (store()?.getItem(DONE_KEY) === "1") return; } catch { /* ask the server */ }
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const show = () => { clearTimeout(timer); timer = setTimeout(() => { if (!controller.signal.aborted) setOpen(true); }, 500); };
    // After the Home Screen popup: wait for its ×, if it is on screen.
    const afterPopup = () => { if (document.documentElement.hasAttribute(POPUP_OPEN_ATTRIBUTE)) window.addEventListener(CLOSED_EVENT, show, { once: true }); else show(); };
    void (async () => {
      try {
        const response = await fetch("/api/research/account/profile", { cache: "no-store", credentials: "same-origin", signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15_000)]) });
        if (!response.ok) return;
        const themes = readFavoriteThemes(((await response.json()) as { themes?: unknown }).themes);
        if (themes.asked) { try { store()?.setItem(DONE_KEY, "1"); } catch { /* storage may be blocked */ } return; }
        // The Home Screen popup opens about a second after the page settles; look again after it had the chance.
        timer = setTimeout(afterPopup, 1400);
      } catch { /* try again on the next visit */ }
    })();
    return () => { controller.abort(); clearTimeout(timer); window.removeEventListener(CLOSED_EVENT, show); };
  }, [ready, open]);
  async function save(items: string[]) {
    setBusy(true); setFailed(false);
    try {
      const response = await fetch("/api/research/account/profile", { method: "PATCH", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ themes: items }), signal: AbortSignal.timeout(20_000) });
      if (!response.ok) throw new Error("save");
      try { store()?.setItem(DONE_KEY, "1"); } catch { /* storage may be blocked */ }
      setOpen(false);
    } catch { setBusy(false); setFailed(true); }
  }
  if (!open) return null;
  return <div className={styles.screen} role="dialog" aria-modal="true" aria-label="最初の1問">
    <div className={styles.inner}>
      <button type="button" className={styles.later} disabled={busy} onClick={() => void save([])}>あとで</button>
      <h2 className={styles.title}>気になるテーマは<br />ありますか？</h2>
      <p className={styles.sub}>複数選べます。あとから変えられます。</p>
      <ThemeTiles selected={selected} onChange={setSelected} ja disabled={busy} />
      <button type="button" className={styles.start} disabled={busy} onClick={() => void save(selected)}>{busy ? "保存しています…" : "はじめる"}</button>
      {failed && <p className={styles.err} role="alert">保存できませんでした。もう一度お試しください。</p>}
      <p className={styles.note}>通知は、ホームの通知設定からいつでも選べます</p>
    </div>
  </div>;
}
