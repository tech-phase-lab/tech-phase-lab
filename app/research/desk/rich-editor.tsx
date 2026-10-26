"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import type { Editor } from "@tiptap/core";
import type { EditorProps } from "@tiptap/pm/view";
import { Slice } from "@tiptap/pm/model";
import { EditorContent, useEditor, useEditorState } from "@tiptap/react";
import DeskBody, { mediaSource } from "./body";
import { deskDocument, deskText } from "./document";
import { deskExtensions } from "./editor-extensions";
import AudioUpload from "./audio-upload";
import styles from "./format.module.css";
function parts(value: string, enabled: boolean) {
  const attachments: string[] = [], lines: string[] = [];
  for (const line of value.split("\n")) {
    const match = enabled && /^\[(audio|video|image)\]\(((?:https:\/\/|\/api\/research\/desk-media\/)[^\s]+)\)$/.exec(line.trim());
    if (match && mediaSource(match[2], match[1])) attachments.push(line.trim()); else lines.push(line);
  }
  return { text: lines.join("\n"), attachments };
}
export default function DeskTextEditor({ value, onChange, disabled = false, label = "本文", media = false, onMediaBusyChange }: { onMediaBusyChange?: (busy: boolean) => void; value: string; onChange: (value: string) => void; disabled?: boolean; label?: string; media?: boolean }) {
  const attachmentPanel = useRef<HTMLDetailsElement>(null);
  useEffect(() => { if (media && new URL(window.location.href).searchParams.get("voiceMemo") === "1" && attachmentPanel.current) attachmentPanel.current.open = true; }, [media]);
  const last = useRef(value), reserved = useRef(0);
  const [uploading, setUploading] = useState(false);
  const locked = disabled || uploading;
  const [url, setUrl] = useState(""), [kind, setKind] = useState("image"), [message, setMessage] = useState("");
  const { attachments } = parts(value, media);
  const attachmentLength = attachments.length ? attachments.join("\n").length + 1 : 0;
  function emit(text: string, files = attachments) {
    const next = [text, ...files].filter(Boolean).join("\n");
    if (next.length > 6000) { setMessage("6,000文字以内で入力してください。"); return false; }
    last.current = next; onChange(next); setMessage(""); return true;
  }
  // Keep editor configuration stable while native selection handles move.
  const [initialContent] = useState(() => deskDocument(parts(value, media).text));
  // eslint-disable-next-line react-hooks/refs -- Budget is read only by an editing transaction.
  const [extensions] = useState(() => deskExtensions(() => 6000 - reserved.current));
  const editorProps = useMemo<EditorProps>(() => ({
      attributes: { class: styles.editable, role: "textbox", "aria-label": label, "aria-multiline": "true", spellcheck: "true" },
      handlePaste(view, event) {
        const text = event.clipboardData?.getData("text/plain");
        if (text === undefined) return false;
        event.preventDefault();
        const slice = Slice.maxOpen(view.state.schema.nodeFromJSON(deskDocument(text)).content);
        view.dispatch(view.state.tr.replaceSelection(slice)); return true;
      },
      handleDrop: () => true,
  }), [label]);
  const editor = useEditor({
    immediatelyRender: false,
    shouldRerenderOnTransaction: false,
    extensions, content: initialContent, editable: !locked,
    enableInputRules: false, enablePasteRules: false, editorProps,
    onUpdate: ({ editor: current }) => { emit(deskText(current.getJSON())); },
  });
  useEffect(() => { reserved.current = attachmentLength; }, [attachmentLength]);
  useEffect(() => {
    if (editor && last.current !== value) { editor.commands.setContent(deskDocument(parts(value, media).text), { emitUpdate: false }); last.current = value; }
  }, [editor, value, media]);
  useEffect(() => { editor?.setEditable(!locked); }, [editor, locked]);
  function insertMedia() {
    const source = mediaSource(url, kind);
    if (!source || (kind === "video" && !source.embed)) { setMessage("画像のHTTPS URL、またはYouTubeの共有リンクを入力してください。"); return; }
    if (emit(editor ? deskText(editor.getJSON()) : parts(value, media).text, [...attachments, `[${kind}](${url})`])) setUrl("");
  }
  return <div className={styles.editor}>
    <EditorToolbar editor={editor} disabled={locked} label={label} />
    <EditorContent editor={editor} />
    {attachments.map((attachment, index) => <div className={styles.attachment} key={`${index}-${attachment}`}><DeskBody text={attachment} media /><button type="button" aria-label="添付を削除" disabled={locked} onClick={() => emit(editor ? deskText(editor.getJSON()) : parts(value, media).text, attachments.filter((_, i) => i !== index))}>×</button></div>)}
    {media && <details ref={attachmentPanel}><summary>添付</summary><AudioUpload disabled={disabled} onBusyChange={busy => { setUploading(busy); onMediaBusyChange?.(busy); }} onUploaded={audioUrl => {
      const current = parts(last.current, media);
      emit(current.text, [...current.attachments, `[audio](${audioUrl})`]);
    }} /><div className={styles.mediaInput}><select aria-label="メディアの種類" value={kind} disabled={locked} onChange={event => setKind(event.target.value)}><option value="image">画像</option><option value="video">YouTube</option></select><input type="url" aria-label="画像またはYouTubeのURL" value={url} disabled={locked} onChange={event => setUrl(event.target.value)} placeholder="https://" /><button type="button" disabled={locked || !url} onClick={insertMedia}>追加</button></div><p className={styles.hint}>動画はYouTubeにアップロードしてリンクを貼れます。MP4の直接アップロードはできません。</p></details>}
    {message && <p role="status">{message}</p>}
  </div>;
}

// Selection updates render only the toolbar, never the editable surface.
function EditorToolbar({ editor, disabled, label }: { editor: Editor | null; disabled: boolean; label: string }) {
  const active = useEditorState({ editor, selector: ({ editor: current }) => ({ bold: current?.isActive("bold") ?? false, red: current?.isActive("textStyle", { color: "#ff8888" }) ?? false, highlight: current?.isActive("highlight") ?? false }) });
  function format(command: "bold" | "red" | "highlight" | "clear") {
    if (!editor || disabled) return;
    const chain = editor.chain().focus();
    if (command === "bold") chain.toggleBold().run();
    if (command === "red") { if (editor.isActive("textStyle", { color: "#ff8888" })) chain.unsetColor().run(); else chain.setColor("#ff8888").run(); }
    if (command === "highlight") chain.toggleHighlight().run();
    if (command === "clear") chain.unsetBold().unsetColor().unsetHighlight().run();
  }
  function selectText() { editor?.chain().focus().selectAll().run(); }
  return (
    <div className={styles.toolbar} role="group" aria-label={`${label}の文字装飾`}>
      <button type="button" aria-label="太字" aria-pressed={active?.bold ?? false} disabled={disabled} onMouseDown={e => e.preventDefault()} onClick={() => format("bold")} title="太字"><strong>B</strong></button>
      <button type="button" className={styles.red} aria-label="赤文字" aria-pressed={active?.red ?? false} disabled={disabled} onMouseDown={e => e.preventDefault()} onClick={() => format("red")}>赤</button>
      <button type="button" aria-label="黄色マーカー" aria-pressed={active?.highlight ?? false} disabled={disabled} onMouseDown={e => e.preventDefault()} onClick={() => format("highlight")}>マーカー</button>
      <button type="button" aria-label="装飾を解除" disabled={disabled} onMouseDown={e => e.preventDefault()} onClick={() => format("clear")}>解除</button>
      <button type="button" aria-label="本文を全選択" disabled={disabled} onMouseDown={e => e.preventDefault()} onClick={selectText}>選択</button>
    </div>
  );
}
