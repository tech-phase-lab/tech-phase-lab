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
  const [active, setActive] = useState({ bold: false, red: false, highlight: false });
  function syncFormat() {
    const red = document.queryCommandValue("foreColor").toLowerCase();
    const highlight = document.queryCommandValue("hiliteColor").toLowerCase();
    setActive({ bold: document.queryCommandState("bold"), red: ["rgb(255, 136, 136)", "#ff8888"].includes(red), highlight: ["rgb(112, 91, 0)", "#705b00"].includes(highlight) });
  }
  const [url, setUrl] = useState(""), [kind, setKind] = useState("image"), [message, setMessage] = useState("");
  const { attachments } = parts(value, media);
  useEffect(() => {
    if (field.current && last.current !== value) { field.current.innerHTML = editorHtml(parts(value, media).text); last.current = value; range.current = null; }
  }, [value, media]);
  useEffect(() => {
    function remember() {
      const selection = window.getSelection();
      if (selection?.rangeCount && field.current?.contains(selection.anchorNode) && field.current.contains(selection.focusNode)) { range.current = selection.getRangeAt(0).cloneRange(); syncFormat(); }
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
  function format(command: "bold" | "red" | "highlight" | "clear") {
    const editor = field.current;
    if (!editor || disabled) return;
    let selected = range.current;
    editor.focus({ preventScroll: true });
    if (!selected || !editor.contains(selected.commonAncestorContainer)) {
      selected = document.createRange(); selected.selectNodeContents(editor); selected.collapse(false);
    }
    const selection = window.getSelection(); selection?.removeAllRanges(); selection?.addRange(selected);
    document.execCommand("styleWithCSS", false, "true");
    if (command === "bold") document.execCommand("bold");
    if (command === "red") document.execCommand("foreColor", false, active.red ? "#f0ece4" : "#ff8888");
    if (command === "highlight") document.execCommand("hiliteColor", false, active.highlight ? "transparent" : "#705b00");
    if (command === "clear") {
      document.execCommand("removeFormat");
      if (selected.collapsed) {
        if (document.queryCommandState("bold")) document.execCommand("bold");
        document.execCommand("foreColor", false, "#f0ece4");
        document.execCommand("hiliteColor", false, "transparent");
      }
    }
    input(); syncFormat();
    if (selection?.rangeCount) range.current = selection.getRangeAt(0).cloneRange();
  }
  function selectText() {
    if (!field.current || disabled) return;
    field.current.focus({ preventScroll: true });
    const selected = document.createRange(); selected.selectNodeContents(field.current);
    const selection = window.getSelection(); selection?.removeAllRanges(); selection?.addRange(selected);
    range.current = selected; syncFormat();
  }
  function insertMedia() {
    if (!mediaSource(url, kind)) { setMessage("HTTPSの画像・音声・動画ファイル、またはYouTubeのURLを入力してください。"); return; }
    if (emit(field.current ? editorText(field.current) : parts(value, media).text, [...attachments, `[${kind}](${url})`])) setUrl("");
  }
  return <div className={styles.editor}>
    <div className={styles.toolbar} role="group" aria-label={`${label}の文字装飾`}>
      <button type="button" aria-label="太字" aria-pressed={active.bold} disabled={disabled} onMouseDown={e => e.preventDefault()} onClick={() => format("bold")} title="太字"><strong>B</strong></button>
      <button type="button" className={styles.red} aria-label="赤文字" aria-pressed={active.red} disabled={disabled} onMouseDown={e => e.preventDefault()} onClick={() => format("red")}>赤</button>
      <button type="button" aria-label="黄色マーカー" aria-pressed={active.highlight} disabled={disabled} onMouseDown={e => e.preventDefault()} onClick={() => format("highlight")}>マーカー</button>
      <button type="button" aria-label="装飾を解除" disabled={disabled} onMouseDown={e => e.preventDefault()} onClick={() => format("clear")}>解除</button>
      <button type="button" aria-label="本文を全選択" disabled={disabled} onMouseDown={e => e.preventDefault()} onClick={selectText}>選択</button>
    </div>
    <div ref={field} className={styles.editable} role="textbox" aria-label={label} aria-multiline="true" aria-disabled={disabled} contentEditable={!disabled} suppressContentEditableWarning onInput={input} onPaste={event => { event.preventDefault(); document.execCommand("insertText", false, event.clipboardData.getData("text/plain")); input(); }} onDrop={event => event.preventDefault()} />
    {attachments.map((attachment, index) => <div className={styles.attachment} key={`${index}-${attachment}`}><DeskBody text={attachment} media /><button type="button" aria-label="添付を削除" disabled={disabled} onClick={() => emit(field.current ? editorText(field.current) : parts(value, media).text, attachments.filter((_, i) => i !== index))}>×</button></div>)}
    {media && <details><summary>添付</summary><div className={styles.mediaInput}><select aria-label="メディアの種類" value={kind} disabled={disabled} onChange={event => setKind(event.target.value)}><option value="image">画像</option><option value="audio">音声</option><option value="video">動画</option></select><input type="url" aria-label="画像・音声・動画のURL" value={url} disabled={disabled} onChange={event => setUrl(event.target.value)} placeholder="https://" /><button type="button" disabled={disabled || !url} onClick={insertMedia}>追加</button></div><p className={styles.hint}>文章なしでも投稿できます。画像・音声・動画はURLで追加します。</p></details>}
    {message && <p role="status">{message}</p>}
  </div>;
}
