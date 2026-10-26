"use client";
import { useEffect, useRef, useState } from "react";
import { validAudioUpload } from "@/lib/research/desk-audio";
import styles from "./format.module.css";
export default function AudioUpload({ disabled, onUploaded, onBusyChange }: { disabled: boolean; onUploaded: (url: string) => void; onBusyChange: (busy: boolean) => void }) {
  const input = useRef<HTMLInputElement>(null), active = useRef<AbortController | null>(null), mounted = useRef(true);
  const [ready, setReady] = useState<boolean | null>(null), [progress, setProgress] = useState<number | null>(null), [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    mounted.current = true; const controller = new AbortController();
    fetch("/api/research/desk-media", { cache: "no-store", signal: AbortSignal.any([controller.signal, AbortSignal.timeout(10000)]) }).then(async response => {
      const data = await response.json(); if (!response.ok || !data.ok) throw Error();
      if (!controller.signal.aborted) setReady(data.enabled === true);
    }).catch(() => { if (!controller.signal.aborted) setError("音声アップロードの接続を確認できませんでした。"); });
    return () => { mounted.current = false; controller.abort(); active.current?.abort(); };
  }, [retry]);
  async function upload(file?: File) {
    if (!file || active.current || disabled) return;
    if (!validAudioUpload(file.name, file.size)) { setError("50MB以内のMP3ファイルを選んでください。MP4・M4Aには対応していません。"); return; }
    const controller = new AbortController(); active.current = controller;
    setError(""); setProgress(0); onBusyChange(true);
    async function call(body: object) {
      const response = await fetch("/api/research/desk-media", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.any([controller.signal, AbortSignal.timeout(30000)]) });
      const data = await response.json(); if (!response.ok || !data.ok) throw Error(data.error || "failed"); return data;
    }
    try {
      const start = await call({ action: "start", name: file.name, size: file.size });
      await new Promise<void>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        const abort = () => xhr.abort(); controller.signal.addEventListener("abort", abort, { once: true });
        xhr.open("PUT", start.uploadUrl); xhr.setRequestHeader("Content-Type", "audio/mpeg"); xhr.timeout = 900000;
        xhr.upload.onprogress = event => { if (mounted.current && event.lengthComputable) setProgress(Math.min(99, Math.round(event.loaded / event.total * 100))); };
        xhr.onload = () => { if (xhr.status >= 200 && xhr.status < 300) resolve(); else reject(Error("upload-failed")); };
        xhr.onerror = xhr.ontimeout = xhr.onabort = () => reject(Error("upload-failed"));
        xhr.onloadend = () => controller.signal.removeEventListener("abort", abort);
        if (controller.signal.aborted) { reject(Error("cancelled")); return; }
        xhr.send(file);
      });
      const result = await call({ action: "finish", file: start.file });
      if (mounted.current && !controller.signal.aborted) onUploaded(result.url);
    } catch (reason) {
      if (mounted.current) setError(controller.signal.aborted ? "アップロードを中止しました。" : reason instanceof Error && reason.message === "mp3-only" ? "MP3として確認できませんでした。MP3形式で書き出したファイルを選んでください。" : reason instanceof Error && reason.message === "setup-required" ? "音声の保存先はまだ接続されていません。" : "アップロードできませんでした。ファイルを選び直してください。");
    } finally {
      active.current = null;
      if (mounted.current) { setProgress(null); onBusyChange(false); if (input.current) input.current.value = ""; }
    }
  }
  return <div className={styles.audioUpload}>
    <input ref={input} type="file" accept=".mp3,audio/mpeg" aria-label="MP3ファイルを選択" hidden onChange={event => void upload(event.target.files?.[0])} />
    <button type="button" disabled={disabled || ready !== true || progress !== null} onClick={() => input.current?.click()}>MP3を添付</button>
    {progress !== null ? <><span role="status">{progress < 99 ? `送信中 ${progress}%` : "音声を確認中…"}</span><button type="button" onClick={() => active.current?.abort()}>中止</button></> : <small>{ready === false ? "保存先の接続準備中" : ready === null ? "接続を確認中…" : "50MBまで・音声だけでも投稿できます"}</small>}
    {error && <p role="status">{error}{ready === null && <button type="button" onClick={() => { setError(""); setRetry(value => value + 1); }}>再確認</button>}</p>}
  </div>;
}
