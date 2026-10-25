"use client";
import { useEffect, useRef, useState } from "react";
import DeskBody, { mediaSource } from "./body";
import { editorHtml, editorText } from "./rich-text";
import styles from "./format.module.css";
function parts(value: string, enabled: boolean) {
  const attachments: string[] = [], lines: string[] = [];
  for (const line of value.split("\n")) {
    const match = enabled && /^\[(audio|video|image)\]\((https:\/\/[^\s]+)\)$/.exec(line.trim());
    if (match && mediaSource(match[2], match[1])) attachments.push(line.trim()); else lines.push(line);
  }
  return { text: lines.join("\n"), attachments };
}
export default function DeskTextEditor({ value, onChange, disabled = false, label = "本文", media = false }: { value: string; onChange: (value: string) => void; disabled?: boolean; label?: string; media?: boolean }) {
  const field = useRef<HTMLDivElement>(null), range = useRef<Range | null>(null);
  const last = useRef<string | null>(null);
  const [url, setUrl] = useState(""), [kind, setKind] = useState("image"), [message, setMessage] = useState("");
  const { attachments } = parts(value, media);
  useEffect(() => {
    if (field.current && last.current !== value) { field.current.innerHTML = editorHtml(parts(value, media).text); last.current = value; range.current = null; }
  }, [value, media]);
  useEffect(() => {
    function remember() {
      const selection = window.getSelection();
      if (selection?.rangeCount && field.current?.contains(selection.anchorNode) && field.current.contains(selection.focusNode)) range.current = selection.getRangeAt(0).cloneRange();
    }
    document.addEventListener("selectionchange", remember);
    return () => document.removeEventListener("selectionchange", remember);
  }, []);
  function emit(text: string, files = attachments) {
    const next = [text, ...files].filter(Boolean).join("\n");
    if (next.length > 6000) { setMessage("6,000文字以内で入力してください。"); return false; }
    last.current = next; onChange(next); setMessage(""); return true;
  }
  function input() {
    if (!field.current) return;
    if (!emit(editorText(field.current))) { field.current.innerHTML = editorHtml(parts(value, media).text); range.current = null; }
  }
  function format(command: string, argument?: string) {
    if (!field.current || disabled) return;
    const selected = range.current;
    if (!selected || selected.collapsed || !field.current.contains(selected.commonAncestorContainer)) { setMessage("装飾したい文字を選択してください。"); field.current.focus(); return; }
    field.current.focus(); const selection = window.getSelection(); selection?.removeAllRanges(); selection?.addRange(selected);
    // Native editing retains selection, mobile handles and the browser undo stack.
    document.execCommand(command, false, argument); input();
    if (selection?.rangeCount) range.current = selection.getRangeAt(0).cloneRange();
  }
  function insertMedia() {
    if (!mediaSource(url, kind)) { setMessage("HTTPSの画像・音声・動画ファイル、またはYouTubeのURLを入力してください。"); return; }
    if (emit(field.current ? editorText(field.current) : parts(value, media).text, [...attachments, `[${kind}](${url})`])) setUrl("");
  }
  return <div className={styles.editor}>
    <div className={styles.toolbar} role="group" aria-label={`${label}の文字装飾`}>
      <button type="button" disabled={disabled} onPointerDown={e => e.preventDefault()} onClick={() => format("bold")} title="選択した文字を太字に"><strong>太字</strong></button>
      <button type="button" className={styles.red} disabled={disabled} onPointerDown={e => e.preventDefault()} onClick={() => format("foreColor", "#ff8888")}>赤文字</button>
      <button type="button" disabled={disabled} onPointerDown={e => e.preventDefault()} onClick={() => format("hiliteColor", "#705b00")}>黄色マーカー</button>
      <button type="button" disabled={disabled} onPointerDown={e => e.preventDefault()} onClick={() => format("removeFormat")}>装飾を解除</button>
    </div>
    <div ref={field} className={styles.editable} role="textbox" aria-label={label} aria-multiline="true" aria-disabled={disabled} contentEditable={!disabled} suppressContentEditableWarning onInput={input} onPaste={event => { event.preventDefault(); document.execCommand("insertText", false, event.clipboardData.getData("text/plain")); input(); }} onDrop={event => event.preventDefault()} />
    {attachments.map((attachment, index) => <div className={styles.attachment} key={`${index}-${attachment}`}><DeskBody text={attachment} media /><button type="button" aria-label="添付を削除" disabled={disabled} onClick={() => emit(field.current ? editorText(field.current) : parts(value, media).text, attachments.filter((_, i) => i !== index))}>×</button></div>)}
    {media && <details><summary>画像・音声・動画を添える</summary><div className={styles.mediaInput}><select aria-label="メディアの種類" value={kind} disabled={disabled} onChange={event => setKind(event.target.value)}><option value="image">画像</option><option value="audio">音声</option><option value="video">動画</option></select><input type="url" aria-label="画像・音声・動画のURL" value={url} disabled={disabled} onChange={event => setUrl(event.target.value)} placeholder="https://" /><button type="button" disabled={disabled || !url} onClick={insertMedia}>追加</button></div><p className={styles.hint}>文章なしでも投稿できます。画像・音声・動画はURLで追加します。</p></details>}
    {message && <p role="status">{message}</p>}
  </div>;
}
