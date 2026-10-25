"use client";
import { useEffect, useRef, useState, type ReactNode } from "react";
import type { EditorialPost } from "@/lib/research/editorial-posts";
import DeskTextEditor from "./text-editor";
import styles from "./format.module.css";
export default function PostActions({ item, onUpdated, editing, setEditing, children }: { children?: ReactNode; item: EditorialPost; onUpdated: () => void; editing: boolean; setEditing: (value: boolean) => void }) {
  const [body, setBody] = useState(item.bodyJa), [busy, setBusy] = useState(false), [message, setMessage] = useState("");
  const inFlight = useRef(false), version = useRef(item.version);
  const dirty = body !== item.bodyJa;
  useEffect(() => { if (!dirty) return; const warn = (event: BeforeUnloadEvent) => event.preventDefault(); window.addEventListener("beforeunload", warn); return () => window.removeEventListener("beforeunload", warn); }, [dirty]);
  async function save(action: "edit" | "delete") {
    if (inFlight.current || (action === "edit" && !body.trim())) return;
    if (action === "delete" && !window.confirm(item.kind === "qa" ? "この回答を削除しますか？質問は残ります。" : "この投稿を削除しますか？")) return;
    inFlight.current = true; setBusy(true); setMessage("");
    try {
      const response = await fetch("/api/research/desk-post", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: item.id, version: version.current, kind: item.kind, action, bodyJa: body }), signal: AbortSignal.timeout(20_000) });
      const data = await response.json();
      if (!response.ok || !data.ok) throw Error(data.error);
      version.current = data.item.version; setEditing(false); onUpdated();
    } catch (error) { setMessage(error instanceof Error && error.message === "post-conflict" ? "別の操作で更新されています。入力を控えて再読み込みしてください。" : "保存できませんでした。入力は残しています。"); }
    finally { inFlight.current = false; setBusy(false); }
  }
  return <>
    <div className={styles.postHeader}>{children}<div className={styles.postActions}>
      <button type="button" aria-label={item.kind === "qa" ? "回答を編集" : "投稿を編集"} title="編集" disabled={busy} onClick={() => { if (!editing) { setBody(item.bodyJa); version.current = item.version; } setEditing(true); }}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m15 5 4 4M4 20l4-1L20 7a2.8 2.8 0 0 0-4-4L4 15z" /></svg></button>
      <button type="button" aria-label={item.kind === "qa" ? "回答を削除" : "投稿を削除"} title="削除" disabled={busy} onClick={() => void save("delete")}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v5M14 11v5" /></svg></button>
    </div></div>
    {editing && <div className={styles.inlineEditor}><DeskTextEditor label={item.kind === "qa" ? "回答の本文" : "投稿の本文"} value={body} onChange={setBody} disabled={busy} media={item.kind === "notes"} /><div className={styles.toolbar}><button type="button" disabled={busy || !dirty || !body.trim()} onClick={() => void save("edit")}>{busy ? "保存中…" : "保存"}</button><button type="button" disabled={busy} onClick={() => { setBody(item.bodyJa); setEditing(false); setMessage(""); }}>キャンセル</button></div></div>}
    {message && <p className={styles.actionMessage} role="status">{message}</p>}
  </>;
}
