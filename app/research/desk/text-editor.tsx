"use client";
import { useRef, useState } from "react";
import DeskBody, { mediaSource } from "./body";
import styles from "./format.module.css";
export default function DeskTextEditor({ value, onChange, disabled = false, label = "本文", media = false }: { value: string; onChange: (value: string) => void; disabled?: boolean; label?: string; media?: boolean }) {
  const field = useRef<HTMLTextAreaElement>(null);
  const [url, setUrl] = useState("");
  const [kind, setKind] = useState("audio");
  const [message, setMessage] = useState("");
  function wrap(open: string, close: string) {
    const element = field.current; if (!element || disabled) return;
    const start = element.selectionStart, end = element.selectionEnd;
    const next = value.slice(0, start) + open + value.slice(start, end) + close + value.slice(end);
    if (next.length > 6000) { setMessage("6,000文字以内で入力してください。"); return; }
    onChange(next); setMessage("");
    requestAnimationFrame(() => { element.focus(); element.setSelectionRange(start + open.length, end + open.length); });
  }
  function insertMedia() {
    if (!mediaSource(url, kind)) { setMessage("音声はHTTPSのmp3・m4a・ogg・wav、動画はYouTubeまたはmp4・webmのURLを入力してください。"); return; }
    const next = `${value}${value ? "\n" : ""}[${kind}](${url})\n`;
    if (next.length > 6000) { setMessage("6,000文字以内で入力してください。"); return; }
    onChange(next); setUrl(""); setMessage("");
  }
  return <div className={styles.editor}>
    <div className={styles.toolbar} role="group" aria-label={`${label}の文字装飾`}>
      <button type="button" disabled={disabled} onClick={() => wrap("**", "**")}><strong>太字</strong></button>
      <button type="button" disabled={disabled} onClick={() => wrap("[red]", "[/red]")}>赤文字</button>
      <button type="button" disabled={disabled} onClick={() => wrap("==", "==")}>黄色マーカー</button>
    </div>
    <textarea ref={field} aria-label={label} value={value} onChange={event => onChange(event.target.value)} disabled={disabled} maxLength={6000} />
    <p className={styles.hint}>文字を選んで装飾できます。下のプレビューで仕上がりを確認してください。</p>
    {media && <details><summary>音声・動画を添える</summary><p className={styles.hint}>公開済みファイルやYouTubeのURLを添付します。音声・動画自体の翻訳や字幕作成は行いません。外部URLの公開範囲は配信元で管理してください。</p><div className={styles.mediaInput}><select aria-label="メディアの種類" value={kind} disabled={disabled} onChange={event => setKind(event.target.value)}><option value="audio">音声</option><option value="video">動画</option></select><input type="url" aria-label="音声・動画のURL" value={url} disabled={disabled} onChange={event => setUrl(event.target.value)} placeholder="https://" /><button type="button" disabled={disabled || !url} onClick={insertMedia}>追加</button></div></details>}
    {message && <p role="status">{message}</p>}
    <details className={styles.preview}><summary>表示プレビュー</summary><DeskBody text={value} media={media} /></details>
  </div>;
}
