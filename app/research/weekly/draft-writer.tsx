"use client";
import { useEffect, useRef, useState } from "react";
import styles from "./styles.module.css";

/** The owner's entry for writing a weekly draft by hand (owner, Nov 21: 「週刊PROの下書きを書くがないけど？」). It sat at the top of the
 * weekly page, folded, until the page was rebuilt around numbered issues on Nov 3 (#314) and the old composer was left behind. The draft is
 * saved to the same issue store as the Saturday draft, so it then appears under 「確認待ちの下書き」 to be checked, previewed and published.
 * Only the owner sees it; the server checks the owner again on every save. */
const today = () => new Date(Date.now() + 9 * 3_600_000).toISOString().slice(0, 10);
export default function WeeklyDraftWriter({ onSaved }: { onSaved: (message: string) => void }) {
  const [date, setDate] = useState(""), [headline, setHeadline] = useState(""), [lead, setLead] = useState(""), [heading, setHeading] = useState(""), [body, setBody] = useState(""), [sourcesText, setSourcesText] = useState("");
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const flight = useRef(false);
  const dirty = !!(headline || lead || heading || body || sourcesText);
  useEffect(() => { setDate(today()); }, []);
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);
  const ready = !!headline.trim() && !!lead.trim() && !!heading.trim() && !!body.trim();
  async function save() {
    if (!ready || flight.current) return;
    flight.current = true; setBusy(true); setError("");
    const sources = sourcesText.split("\n").map(line => line.trim()).filter(Boolean).map(line => { const at = line.indexOf("|"); return { title: (at < 0 ? line : line.slice(0, at)).trim(), url: at < 0 ? "" : line.slice(at + 1).trim() }; });
    try {
      // No id: the service makes a new draft. A person's draft is never marked automatic (the route sets auto: false).
      const response = await fetch("/api/research/weekly-issues", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "draft", payload: { id: null, date: date || today(), headline, lead, parts: [{ type: "text", heading, body }], sources, notes: [] } }), signal: AbortSignal.timeout(20_000) });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || data.ok === false) throw Error();
      setHeadline(""); setLead(""); setHeading(""); setBody(""); setSourcesText("");
      onSaved("下書きを保存しました");
    } catch { setError("保存できませんでした。文字数や空欄、出典のURL(https://…)を確認してください。入力は残しています。"); }
    finally { flight.current = false; setBusy(false); }
  }
  return <details className={styles.composer}><summary>下書きを書く</summary><form onSubmit={event => { event.preventDefault(); void save(); }} aria-busy={busy}>
    <fieldset disabled={busy}>
      <label>号の日付<input type="date" value={date} onChange={event => setDate(event.target.value)} /></label>
      <label>見出し(今回のひとこと)<input value={headline} maxLength={120} onChange={event => setHeadline(event.target.value)} /></label>
      <label>リード<textarea rows={3} value={lead} maxLength={400} onChange={event => setLead(event.target.value)} /></label>
      <label>本文の見出し<input value={heading} maxLength={80} onChange={event => setHeading(event.target.value)} /></label>
      <label>本文<textarea className={styles.body} value={body} maxLength={3000} onChange={event => setBody(event.target.value)} /></label>
      <label>出典（1行に「資料名 | URL」）<textarea rows={2} value={sourcesText} maxLength={8000} onChange={event => setSourcesText(event.target.value)} /></label>
    </fieldset>
    <div className={styles.actions}><button type="submit" disabled={busy || !ready}>{busy ? "保存中…" : "下書き保存"}</button></div>
    {error && <p role="alert">{error}</p>}
  </form></details>;
}

/** Before the membership display has started, the owner's device (hint set before the first paint) keeps the folded entry's place, so the
 * issue below does not move down when it appears. Same size as the closed entry above; hidden on every other device. */
export function WeeklyDraftWriterSlot() {
  return <details className={`${styles.composer} ${styles.hinted}`} aria-hidden="true" inert><summary>下書きを書く</summary></details>;
}
