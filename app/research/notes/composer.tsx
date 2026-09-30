"use client";
import { useEffect, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import styles from "./composer.module.css";

export default function NoteComposer({ onPublished }: { onPublished: () => void }) {
  const [body, setBody] = useState("");
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
    if (inFlight.current || !body.trim()) return;
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
  return <form className={styles.composer} onSubmit={event => void publish(event)} aria-label="ひとりごとを投稿" aria-busy={busy}>
    <textarea aria-label="ひとりごとの本文" value={body} onChange={event => setBody(event.target.value)} maxLength={6000} disabled={busy} />
    <div className={styles.actions}>
      <Link href="/research/write">過去の投稿・下書き</Link>
      <span>{body.length.toLocaleString()} / 6,000</span>
      <button type="submit" disabled={busy || !body.trim()}>{busy ? "投稿中…" : "投稿"}</button>
    </div>
    {message && <p role="status">{message}</p>}
  </form>;
}
