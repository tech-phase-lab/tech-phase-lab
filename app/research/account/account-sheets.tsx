"use client";
import Link from "next/link";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { billingRequest, billingSummary, sandboxApproval } from "@/lib/membership/billing-client";
import { INITIAL, TILES, tileBackground, tileById } from "./avatars";
import styles from "./account.module.css";

export type Mode = "live" | "sandbox";
const check = <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#2a1f05" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 12l5 5 9-10" /></svg>;

function Sheet({ title, onClose, children, plain = false, dismissible = true }: { title: string; onClose: () => void; children: ReactNode; plain?: boolean; dismissible?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    ref.current?.focus();
    const key = (event: KeyboardEvent) => { if (event.key === "Escape" && dismissible) onClose(); };
    document.addEventListener("keydown", key);
    return () => { document.removeEventListener("keydown", key); previous?.focus?.(); };
  }, [onClose, dismissible]);
  return <div className={styles.scrim} onClick={() => dismissible && onClose()}>
    <div ref={ref} tabIndex={-1} className={`${styles.sheet} ${plain ? styles.sheetPlain : ""}`} role="dialog" aria-modal="true" aria-label={title} onClick={event => event.stopPropagation()}>
      <div className={styles.handle} />
      <h2 className={styles.sTitle}>{title}</h2>
      {children}
    </div>
  </div>;
}

/** A5 / A5b: the consent starts off, and "PayPalへ進む" stays dimmed until it is ticked. */
export function UpgradeSheet({ ja, mode, blocked, preview = false, refresh, onClose }: { ja: boolean; mode: Mode | null; blocked?: boolean; preview?: boolean; refresh: (force?: boolean) => Promise<void>; onClose: () => void }) {
  const [agreed, setAgreed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const t = (a: string, b: string) => ja ? a : b;
  // preview: the owner is looking at the FREE screen; the sheet works as it does for a FREE member, except that no payment is started.
  const closed = !preview && (!mode || blocked);
  async function go() {
    if (busy || !agreed) return;
    if (preview) { setError("preview"); return; }
    if (!mode) return;
    setBusy(true); setError("");
    try {
      await refresh(true);
      const result = await billingRequest("create", { currency: "JPY", acceptedTerms: mode === "live" ? "pro-live-v1" : "sandbox-v1" }, AbortSignal.timeout(20_000), mode);
      window.location.assign(sandboxApproval(result.approvalUrl, mode));
    } catch (e) {
      setBusy(false);
      setError(e instanceof Error && e.message === "existing-subscription" ? "existing" : "failed");
    }
  }
  return <Sheet title={t("PROにアップグレード", "Upgrade to PRO")} onClose={onClose} dismissible={!busy}>
    <div className={styles.sBox}>
      <div className={styles.kv}><span>{t("プラン", "Plan")}</span><b>Tech Phase PRO</b></div>
      <div className={styles.kv}><span>{t("月額料金", "Monthly price")}</span><b>¥2,980</b></div>
      <div className={styles.kv}><span>{t("更新", "Renewal")}</span><b>{t("毎月自動で更新", "Renews monthly")}</b></div>
      <div className={styles.kv}><span>{t("お支払い", "Payment")}</span><b>PayPal</b></div>
    </div>
    <label className={styles.check}>
      <input type="checkbox" checked={agreed} disabled={busy || closed} onChange={event => setAgreed(event.target.checked)} />
      <span className={styles.box}><i>{agreed && check}</i></span>
      <span>{ja ? <><Link href="/terms">利用規約</Link>に同意し、毎月自動で更新されることを確認しました。</> : <>I agree to the <Link href="/terms">Terms</Link> and understand it renews monthly.</>}</span>
    </label>
    {closed && <p className={styles.err}>{t("お申し込みの受付は、現在停止中です。", "New subscriptions are closed right now.")}</p>}
    {error === "preview" && <p className={styles.note} role="status" style={{ margin: "0 0 12px" }}>{t("表示の確認中のため、PayPalへは進みません。", "Previewing: PayPal is not opened.")}</p>}
    {error === "failed" && <p className={styles.err} role="alert">{t("お申し込みを開始できませんでした。時間をおいて、もう一度お試しください。", "Could not start checkout. Please try again shortly.")}</p>}
    {error === "existing" && <p className={styles.err} role="alert">{t("手続き中の契約があります。", "A checkout is already in progress.")} <Link href="/research/account/billing" style={{ color: "#e7c982" }}>{t("手続きを再開する", "Resume")}</Link></p>}
    <button type="button" className={`${styles.btn} ${styles.gbt}`} disabled={!agreed || busy || closed} onClick={() => void go()}>{busy ? t("PayPalへ移動しています…", "Opening PayPal…") : t("PayPalへ進む", "Continue to PayPal")}</button>
    <button type="button" className={styles.sCancel} disabled={busy} onClick={onClose}>{t("キャンセル", "Cancel")}</button>
  </Sheet>;
}

/** Stop automatic renewal: look up the contract id, then the existing billing "cancel" call. */
export function StopSheet({ ja, mode, until, onDone, onClose }: { ja: boolean; mode: Mode; until: string | null; onDone: () => void; onClose: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const t = (a: string, b: string) => ja ? a : b;
  async function stop() {
    setBusy(true); setError(false);
    try {
      const signal = AbortSignal.timeout(30_000);
      const current = billingSummary(await billingRequest("status", undefined, signal, mode), mode);
      const sub = current.subscription;
      if (!sub || !["active", "suspended"].includes(sub.state)) throw new Error("not-cancellable");
      await billingRequest("cancel", { id: sub.id }, signal, mode);
      onDone();
    } catch { setBusy(false); setError(true); }
  }
  return <Sheet title={t("自動更新を停止しますか？", "Stop automatic renewal?")} onClose={onClose} dismissible={!busy}>
    <p className={styles.sBody}>{t("停止すると、次回の請求はありません。", "No further charges after you stop.")}{until && <><br />{t(`${until}まで、PROの機能を利用できます。`, `PRO stays available until ${until}.`)}</>}</p>
    {error && <p className={styles.err} role="alert">{t("停止できませんでした。契約の状態を確認して、もう一度お試しください。", "Could not stop renewal. Check your contract and try again.")}</p>}
    <button type="button" className={`${styles.btn} ${styles.gbt}`} disabled={busy} onClick={onClose}>{t("このまま続ける", "Keep renewing")}</button>
    <button type="button" className={`${styles.btn} ${styles.stopBtn}`} style={{ marginTop: 12 }} disabled={busy} onClick={() => void stop()}>{busy ? t("停止しています…", "Stopping…") : t("自動更新を停止する", "Stop automatic renewal")}</button>
  </Sheet>;
}

/** A9: the initial, or one of 23 emoji tiles. No photo upload. */
export function AvatarSheet({ ja, initial, current, onSave, onClose }: { ja: boolean; initial: string; current: string; onSave: (id: string) => Promise<void>; onClose: () => void }) {
  const [pick, setPick] = useState(current);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const t = (a: string, b: string) => ja ? a : b;
  const tile = tileById(pick);
  async function save() { setBusy(true); setError(false); try { await onSave(pick); onClose(); } catch { setBusy(false); setError(true); } }
  return <Sheet title={t("アイコンを選ぶ", "Choose an icon")} onClose={onClose} plain dismissible={!busy}>
    <div className={styles.preview}><div className={styles.pv} style={tile ? { background: tileBackground(tile), fontFamily: '"Noto Color Emoji",sans-serif' } : { background: "rgba(93,224,176,.06)", color: "#9fe3c4", borderColor: "#3d7a64", fontFamily: '"Noto Serif JP",serif', fontSize: 38, fontWeight: 600 }}>{tile ? tile.glyph : initial}</div></div>
    <div className={styles.tiles}>
      <button type="button" aria-pressed={pick === INITIAL} aria-label={t("頭文字", "Initial")} className={`${styles.tile} ${styles.tileInit}`} style={{ background: "radial-gradient(circle at 30% 25%,#5de0b055,#0f5a45cc 75%),#10161f" }} onClick={() => setPick(INITIAL)}>{initial}</button>
      {TILES.map(item => <button key={item.id} type="button" aria-pressed={pick === item.id} aria-label={item.glyph} className={styles.tile} style={{ background: tileBackground(item) }} onClick={() => setPick(item.id)}>{item.glyph}</button>)}
    </div>
    {error && <p className={styles.err} role="alert">{t("保存できませんでした。もう一度お試しください。", "Could not save. Please try again.")}</p>}
    <button type="button" className={`${styles.btn} ${styles.mbt}`} disabled={busy} onClick={() => void save()}>{busy ? t("保存しています…", "Saving…") : t("決定", "Done")}</button>
  </Sheet>;
}

/** Display name: saved on the existing sign-in account (first name). */
export function NameSheet({ ja, current, onSave, onClose }: { ja: boolean; current: string; onSave: (name: string) => Promise<void>; onClose: () => void }) {
  const [value, setValue] = useState(current);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const t = (a: string, b: string) => ja ? a : b;
  const clean = value.trim();
  async function save() { setBusy(true); setError(false); try { await onSave(clean); onClose(); } catch { setBusy(false); setError(true); } }
  return <Sheet title={t("表示名を変更", "Change display name")} onClose={onClose} plain dismissible={!busy}>
    <label className={styles.field}><span>{t("表示名", "Display name")}</span><input value={value} maxLength={30} onChange={event => setValue(event.target.value)} autoComplete="nickname" /></label>
    {error && <p className={styles.err} role="alert">{t("保存できませんでした。もう一度お試しください。", "Could not save. Please try again.")}</p>}
    <button type="button" className={`${styles.btn} ${styles.mbt}`} disabled={busy || !clean || clean === current} onClick={() => void save()}>{busy ? t("保存しています…", "Saving…") : t("保存", "Save")}</button>
    <button type="button" className={styles.sCancel} disabled={busy} onClick={onClose}>{t("キャンセル", "Cancel")}</button>
  </Sheet>;
}
