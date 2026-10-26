"use client";
import { useEffect, useRef, useState, type FormEvent } from "react";
import DeskTextEditor from "../desk/text-editor";
import AudioShortcut from "../desk/audio-shortcut";
import styles from "./composer.module.css";

export default function NoteComposer({ onPublished }: { onPublished: () => void }) {
  const [body, setBody] = useState("");
  const [mediaBusy, setMediaBusy] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const post = useRef<{ id: string; version: number } | null>(null);
  const inFlight = useRef(false);
  useEffect(() => {
    if (!body) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [body]);
  async function publish(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (inFlight.current || mediaBusy || !body.trim()) return;
    if (body.includes("[audio](") && !window.confirm("この音声を公開しますか？PRO会員が再生できるようになります。")) return;
    inFlight.current = true; setBusy(true); setMessage("");
    post.current ??= { id: crypto.randomUUID(), version: 0 };
    try {
      const response = await fetch("/api/research/author", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...post.current, bodyJa: body, action: "publish" }),
        signal: AbortSignal.timeout(45_000),
      });
      const data = await response.json();
      // Keep the saved draft version if publication fails, so a retry can resume safely.
      if (data.item) post.current = { id: data.item.id, version: data.item.version };
      if (!response.ok || !data.ok) throw new Error(data.error);
      post.current = null; setBody(""); setMessage("投稿しました。"); onPublished();
    } catch (error) {
      setMessage(error instanceof Error && error.message === "owner-required"
        ? "運営者アカウントでログインしてください。入力は残しています。"
        : "投稿を完了できませんでした。入力は残しています。下書きに保存されている場合があります。");
    } finally { inFlight.current = false; setBusy(false); }
  }
  return <form id="note-composer" className={styles.composer} onSubmit={event => void publish(event)} aria-label="ひとりごとを投稿" aria-busy={busy}>
    <DeskTextEditor label="ひとりごとの本文" value={body} onChange={setBody} disabled={busy} media onMediaBusyChange={setMediaBusy} />
    <div className={styles.actions}>
      <span>{body.length.toLocaleString()} / 6,000</span>
      <button type="submit" disabled={busy || mediaBusy || !body.trim()}>{busy ? "投稿中…" : "投稿"}</button>
    </div>
    <AudioShortcut />
    {message && <p role="status">{message}</p>}
  </form>;
}
