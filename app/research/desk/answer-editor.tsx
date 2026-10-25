"use client";
import { useEffect, useRef, useState } from "react";
import type { EditorialPost } from "@/lib/research/editorial-posts";
import DeskTextEditor from "./text-editor";
export default function AnswerEditor({ item, onUpdated }: { item: EditorialPost; onUpdated: () => void }) {
  const [open, setOpen] = useState(false), [body, setBody] = useState(item.bodyJa);
  const [busy, setBusy] = useState(false), [message, setMessage] = useState("");
  const inFlight = useRef(false);
  const dirty = body !== item.bodyJa;
  useEffect(() => { if (!dirty) return; const warn = (event: BeforeUnloadEvent) => event.preventDefault(); window.addEventListener("beforeunload", warn); return () => window.removeEventListener("beforeunload", warn); }, [dirty]);
  async function save() {
    if (inFlight.current || !dirty || !body.trim()) return;
    inFlight.current = true; setBusy(true); setMessage("");
    try {
      const response = await fetch("/api/research/questions/moderation", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: `q-${item.id.slice(3)}`, decision: "edit-reply", expectedVersion: item.version, body }), signal: AbortSignal.timeout(15_000) });
      const data = await response.json();
      if (!response.ok || !data.ok) throw Error(data.error);
      setOpen(false); setMessage("回答を更新しました。英語版は翻訳待ちになります。"); onUpdated();
    } catch (error) { setMessage(error instanceof Error && error.message === "answer-conflict" ? "回答が別の操作で更新されています。入力を控え、最新版を読み込んでください。" : "更新できませんでした。入力は残しています。"); }
    finally { inFlight.current = false; setBusy(false); }
  }
  return <section aria-label="運営者の回答編集">
    <button type="button" disabled={busy} onClick={() => setOpen(value => !value)}>{open ? "編集欄を閉じる" : "回答を訂正"}</button>
    {open && <><DeskTextEditor label="回答の訂正" value={body} onChange={setBody} disabled={busy} /><button type="button" disabled={busy || !dirty || !body.trim()} onClick={() => void save()}>{busy ? "更新中…" : "回答を更新する"}</button><button type="button" disabled={busy || !dirty} onClick={() => setBody(item.bodyJa)}>変更を破棄</button></>}
    {message && <p role="status">{message}</p>}
  </section>;
}
