"use client";
import { useEffect, useRef, useState } from "react";
import { validAudioUpload } from "@/lib/research/desk-audio";
import VoiceMemoImport from "./voice-memo-import";
import AudioEditor from "./audio-editor";
import AudioRecorder from "./audio-recorder";
import styles from "./format.module.css";
export default function AudioUpload({ disabled, onUploaded, onBusyChange }: { disabled: boolean; onUploaded: (url: string) => void; onBusyChange: (busy: boolean) => void }) {
  const input = useRef<HTMLInputElement>(null), active = useRef<AbortController | null>(null), mounted = useRef(true);
  const [ready, setReady] = useState<boolean | null>(null), [progress, setProgress] = useState<number | null>(null), [error, setError] = useState("");
  const original = useRef<File | null>(null), audioPlayer = useRef<HTMLAudioElement>(null);
  const [editing, setEditing] = useState(false), [edited, setEdited] = useState(false);
  const [retry, setRetry] = useState(0);
  const [candidate, setCandidate] = useState<File | null>(null), [preview, setPreview] = useState(""), [checked, setChecked] = useState(false), [recording, setRecording] = useState(false), [importing, setImporting] = useState(false);
  const busyCallback = useRef(onBusyChange);
  useEffect(() => { busyCallback.current = onBusyChange; }, [onBusyChange]);
  const pending = recording || importing || candidate !== null || progress !== null;
  useEffect(() => { busyCallback.current(pending); return () => busyCallback.current(false); }, [pending]);
  const previewRef = useRef("");
  useEffect(() => () => { if (previewRef.current) URL.revokeObjectURL(previewRef.current); }, []);
  useEffect(() => {
    if (!pending) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [pending]);
  function discard() {
    original.current = null; setEdited(false);
    if (previewRef.current) URL.revokeObjectURL(previewRef.current);
    previewRef.current = ""; setPreview(""); setCandidate(null); setChecked(false); setError("");
  }
  function choose(file?: File, isEdit = false) {
    if (!file) return;
    if (!validAudioUpload(file.name, file.size)) { setError("50MB以内のMP3・M4A音声を選んでください。動画は添付できません。"); return; }
    if (!isEdit) original.current = file;
    setEdited(isEdit);
    if (previewRef.current) URL.revokeObjectURL(previewRef.current);
    previewRef.current = URL.createObjectURL(file);
    setError(""); setPreview(previewRef.current); setChecked(false); setCandidate(file);
  }
  useEffect(() => {
    mounted.current = true; const controller = new AbortController();
    fetch("/api/research/desk-media", { cache: "no-store", signal: AbortSignal.any([controller.signal, AbortSignal.timeout(10000)]) }).then(async response => {
      const data = await response.json(); if (!response.ok || !data.ok) throw Error();
      if (!controller.signal.aborted) setReady(data.enabled === true);
    }).catch(() => { if (!controller.signal.aborted) setError("音声アップロードの接続を確認できませんでした。"); });
    return () => { mounted.current = false; controller.abort(); active.current?.abort(); };
  }, [retry]);
  async function upload(file?: File) {
    if (!file || active.current || disabled || editing || !checked) return;
    if (!validAudioUpload(file.name, file.size)) { setError("50MB以内のMP3・M4A音声を選んでください。動画は添付できません。"); return; }
    const controller = new AbortController(); active.current = controller;
    setError(""); setProgress(0);
    async function call(body: object) {
      const response = await fetch("/api/research/desk-media", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.any([controller.signal, AbortSignal.timeout(30000)]) });
      const data = await response.json(); if (!response.ok || !data.ok) throw Error(data.error || "failed"); return data;
    }
    try {
      const start = await call({ action: "start", name: file.name, size: file.size });
      await new Promise<void>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        const abort = () => xhr.abort(); controller.signal.addEventListener("abort", abort, { once: true });
        xhr.open("PUT", start.uploadUrl); xhr.setRequestHeader("Content-Type", start.contentType); xhr.timeout = 900000;
        xhr.upload.onprogress = event => { if (mounted.current && event.lengthComputable) setProgress(Math.min(99, Math.round(event.loaded / event.total * 100))); };
        xhr.onload = () => { if (xhr.status >= 200 && xhr.status < 300) resolve(); else reject(Error("upload-failed")); };
        xhr.onerror = xhr.ontimeout = xhr.onabort = () => reject(Error("upload-failed"));
        xhr.onloadend = () => controller.signal.removeEventListener("abort", abort);
        if (controller.signal.aborted) { reject(Error("cancelled")); return; }
        xhr.send(file);
      });
      const result = await call({ action: "finish", file: start.file });
      if (mounted.current && !controller.signal.aborted) { onUploaded(result.url); discard(); }
    } catch (reason) {
      if (mounted.current) setError(controller.signal.aborted ? "アップロードを中止しました。" : reason instanceof Error && reason.message === "audio-only" ? "対応する音声として確認できませんでした。MP3、またはボイスメモから書き出したM4Aを選んでください。" : reason instanceof Error && reason.message === "setup-required" ? "音声の保存先はまだ接続されていません。" : "アップロードできませんでした。ファイルを選び直してください。");
    } finally {
      active.current = null;
      if (mounted.current) { setProgress(null); if (input.current) input.current.value = ""; }
    }
  }
  return <div className={styles.audioUpload}>
    <input ref={input} type="file" accept=".mp3,.m4a,audio/mpeg,audio/mp4,audio/x-m4a" aria-label="MP3・M4A音声を選択" hidden onChange={event => { choose(event.target.files?.[0]); event.target.value = ""; }} />
    <button type="button" disabled={disabled || ready !== true || pending} onClick={() => input.current?.click()}>音声ファイルを選ぶ</button>
    <AudioRecorder disabled={disabled || ready !== true || candidate !== null || importing || progress !== null} onFile={choose} onBusyChange={setRecording} />
    <VoiceMemoImport disabled={disabled || ready !== true || pending} onFile={choose} onBusyChange={setImporting} />
    {candidate && <div className={styles.audioReview}><strong>まだ公開されていません</strong><small>{candidate.name}</small>{preview && <audio ref={audioPlayer} hidden={editing} controls preload="metadata" src={preview} />}<AudioEditor key={candidate.name + candidate.lastModified} file={candidate} disabled={disabled || progress !== null} onApply={file => choose(file, true)} onBusyChange={value => { setEditing(value); if (value) audioPlayer.current?.pause(); }} />{edited && <button type="button" disabled={editing || progress !== null} onClick={() => { if (original.current) choose(original.current); }}>元の音声に戻す</button>}<label><input type="checkbox" checked={checked} disabled={editing || progress !== null} onChange={event => setChecked(event.target.checked)} />この音声を添付することを確認しました</label><div><button type="button" disabled={disabled || editing || !checked || progress !== null} onClick={() => void upload(candidate)}>この音声を添付</button><button type="button" disabled={editing || progress !== null} onClick={discard}>破棄</button></div><small>添付後も、投稿の公開操作が必要です。</small></div>}
    {progress !== null ? <><span role="status">{progress < 99 ? `送信中 ${progress}%` : "音声を確認中…"}</span><button type="button" onClick={() => active.current?.abort()}>中止</button></> : <small>{ready === false ? "保存先の接続準備中" : ready === null ? "接続を確認中…" : "MP3・M4A／50MBまで・音声だけでも投稿できます"}</small>}
    {error && <p role="status">{error}{ready === null && <button type="button" onClick={() => { setError(""); setRetry(value => value + 1); }}>再確認</button>}</p>}
  </div>;
}
