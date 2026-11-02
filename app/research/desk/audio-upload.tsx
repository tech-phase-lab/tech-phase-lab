"use client";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { validAudioUpload } from "@/lib/research/desk-audio";
import { loadAudioDraft, saveAudioDraft, type AudioDraftMeta } from "@/lib/research/desk-audio-draft";
import VoiceMemoImport from "./voice-memo-import";
import InboxSheet from "./inbox-sheet";
import AudioCard from "./audio-card";
import AudioEditor from "./audio-editor";
import AudioRecorder from "./audio-recorder";
import styles from "./format.module.css";
const tileIcons = {
  file: <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 3h7l4 4v14H7zM14 3v4h4M10 12h5M10 16h5" /></svg>,
  inbox: <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 12h2.500M8.500 8v8M12 4v16M15.500 8v8M19.500 12H22" /></svg>,
};
export default function AudioUpload({ disabled, onUploaded, onBusyChange, draftKey = "new-note", onRestored, extraTiles }: { extraTiles?: ReactNode; draftKey?: string; onRestored?: () => void; disabled: boolean; onUploaded: (url: string, title: string) => boolean | void; onBusyChange: (busy: boolean) => void }) {
  const input = useRef<HTMLInputElement>(null), active = useRef<AbortController | null>(null), mounted = useRef(true);
  const [ready, setReady] = useState<boolean | null>(null), [progress, setProgress] = useState<number | null>(null), [error, setError] = useState("");
  const original = useRef<File | null>(null);
  const [editing, setEditing] = useState(false), [edited, setEdited] = useState(false);
  const [retry, setRetry] = useState(0);
  const [title, setTitle] = useState("");
  const [restoring, setRestoring] = useState(true);
  const draftScope = useRef(""), meta = useRef<AudioDraftMeta>({ title: "", edited: false, cut: null });
  const restoredCallback = useRef(onRestored);
  useEffect(() => { restoredCallback.current = onRestored; }, [onRestored]);
  function persist(patch: Partial<AudioDraftMeta>, files?: { file: File; original: File }) {
    meta.current = { ...meta.current, ...patch };
    if (draftScope.current) void saveAudioDraft(draftScope.current, meta.current, files).catch(() => { if (mounted.current) setError("端末に保存できませんでした。"); });
  }

  const [candidate, setCandidate] = useState<File | null>(null), [preview, setPreview] = useState(""), [recording, setRecording] = useState(false), [importing, setImporting] = useState(false), [inbox, setInbox] = useState(false);
  const busyCallback = useRef(onBusyChange);
  useEffect(() => { busyCallback.current = onBusyChange; }, [onBusyChange]);
  const pending = restoring || recording || importing || candidate !== null || progress !== null;
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
    if (draftScope.current) void saveAudioDraft(draftScope.current, null).catch(() => { if (mounted.current) setError("端末の音声を削除できませんでした。"); });
    meta.current = { title: "", edited: false, cut: null };
    original.current = null; setEdited(false); setTitle("");
    if (previewRef.current) URL.revokeObjectURL(previewRef.current);
    previewRef.current = ""; setPreview(""); setCandidate(null); setError("");
  }
  function choose(file?: File, isEdit = false, keepTitle = false) {
    if (!file) return;
    if (!validAudioUpload(file.name, file.size)) { setError("MP3・M4A／50MBまでです。"); return; }
    if (!isEdit) original.current = file;
    const nextTitle = !isEdit && !keepTitle ? (/^(voice-memo-|rizel-)/.test(file.name) ? "音声メモ" : file.name.replace(/\.(mp3|m4a)$/i, "").slice(0, 80)) : meta.current.title;
    setTitle(nextTitle);
    persist({ title: nextTitle, edited: isEdit, cut: null }, { file, original: original.current || file });
    setEdited(isEdit);
    if (previewRef.current) URL.revokeObjectURL(previewRef.current);
    previewRef.current = URL.createObjectURL(file);
    setError(""); setPreview(previewRef.current); setCandidate(file);
  }
  useEffect(() => {
    mounted.current = true; const controller = new AbortController();
    fetch("/api/research/desk-media", { cache: "no-store", signal: AbortSignal.any([controller.signal, AbortSignal.timeout(10000)]) }).then(async response => {
      const data = await response.json(); if (!response.ok || !data.ok) throw Error();
      if (controller.signal.aborted) return;
      setReady(data.enabled === true);
      if (typeof data.draftOwner === "string") {
        draftScope.current = `${data.draftOwner}:${draftKey}`;
        try {
          const draft = await loadAudioDraft(draftScope.current);
          if (controller.signal.aborted) return;
          if (draft && validAudioUpload(draft.file.name, draft.file.size) && validAudioUpload(draft.original.name, draft.original.size)) {
            original.current = draft.original; meta.current = draft.meta;
            setTitle(draft.meta.title); setEdited(draft.meta.edited);
            if (previewRef.current) URL.revokeObjectURL(previewRef.current);
            previewRef.current = URL.createObjectURL(draft.file); setPreview(previewRef.current); setCandidate(draft.file);
            restoredCallback.current?.();
          }
        } catch { if (!controller.signal.aborted) setError("端末の音声を読み込めませんでした。"); }
      }
      if (!controller.signal.aborted) setRestoring(false);
    }).catch(() => { if (!controller.signal.aborted) { setError("接続できませんでした。"); setRestoring(false); } });
    return () => { mounted.current = false; controller.abort(); active.current?.abort(); };
  }, [retry, draftKey]);
  async function upload(file?: File) {
    if (!file || active.current || disabled || editing) return;
    if (!validAudioUpload(file.name, file.size)) { setError("MP3・M4A／50MBまでです。"); return; }
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
      if (mounted.current && !controller.signal.aborted) { if (onUploaded(result.url, title.trim() || "音声メモ") !== false) discard(); else setError("本文が長すぎます。"); }
    } catch (reason) {
      if (mounted.current) setError(controller.signal.aborted ? "アップロードを中止しました。" : reason instanceof Error && reason.message === "audio-only" ? "対応していない音声です。" : reason instanceof Error && reason.message === "setup-required" ? "保存先に接続できません。" : "アップロードできませんでした。");
    } finally {
      active.current = null;
      if (mounted.current) { setProgress(null); if (input.current) input.current.value = ""; }
    }
  }
  return <div className={styles.audioUpload}>
    <input ref={input} type="file" accept=".mp3,.m4a,audio/mpeg,audio/mp4,audio/x-m4a" aria-label="MP3・M4A音声を選択" hidden onChange={event => { choose(event.target.files?.[0]); event.target.value = ""; }} />
    <button className={`${styles.attachTile} ${styles.audioFileEntry}`} type="button" aria-label="音声ファイルを選ぶ" disabled={disabled || ready !== true || pending} onClick={() => { setError(""); input.current?.click(); }}>{tileIcons.file}<span>音声ファイル</span></button>
    <AudioRecorder disabled={disabled || restoring || ready !== true || candidate !== null || importing || progress !== null} onFile={choose} onBusyChange={setRecording} onMessage={setError} />
    <button className={`${styles.attachTile} ${styles.audioInboxEntry}`} type="button" aria-label="受信箱から選ぶ" disabled={disabled || ready !== true || pending} onClick={() => { setError(""); setInbox(true); }}>{tileIcons.inbox}<span>受信箱</span></button>
    {extraTiles}
    {/* Kept until the inbox can receive from the phone: copy the voice memo on the iPhone, then paste it here. */}
    <div className={styles.memoRow}><VoiceMemoImport disabled={disabled || ready !== true || pending} onFile={choose} onBusyChange={setImporting} onMessage={setError} /></div>
    {candidate && <div className={styles.audioReview}>
      <AudioCard file={candidate} original={original.current} title={title} onTitle={value => { setTitle(value); persist({ title: value }); }} edited={edited} preview={preview} hold={editing} busy={progress !== null}
        edit={<AudioEditor key={candidate.name + candidate.lastModified} file={candidate} disabled={disabled || progress !== null} onApply={file => choose(file, true)} onBusyChange={value => setEditing(value)} />}
        onRemove={discard} />
      {edited && <button type="button" className={styles.audioPlain} disabled={editing || progress !== null} onClick={() => { if (original.current) choose(original.current, false, true); }}>元の音声に戻す</button>}
      <button type="button" className={styles.audioAttach} disabled={disabled || editing || progress !== null || ready !== true} onClick={() => void upload(candidate)}>この音声を添付</button>
    </div>}
    {progress !== null ? <><span role="status">{progress < 99 ? `送信中 ${progress}%` : "音声を確認中…"}</span><button type="button" onClick={() => active.current?.abort()}>中止</button></> : ready !== true ? <small>{ready === false ? "保存先の接続準備中" : "接続を確認中…"}</small> : null}
    {error && <p role="status">{error}{ready === null && <button type="button" onClick={() => { setError(""); setRetry(value => value + 1); }}>再確認</button>}</p>}
    {inbox && <InboxSheet onClose={() => setInbox(false)} onPick={file => { setInbox(false); choose(file); }} />}
  </div>;
}
