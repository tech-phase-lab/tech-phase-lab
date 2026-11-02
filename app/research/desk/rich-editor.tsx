"use client";
import { useMemo, useEffect, useRef, useState, type ReactNode } from "react";
import type { Editor } from "@tiptap/core";
import type { EditorProps } from "@tiptap/pm/view";
import { Slice } from "@tiptap/pm/model";
import { EditorContent, useEditor, useEditorState } from "@tiptap/react";
import DeskBody, { mediaSource } from "./body";
import { deskDocument, deskText } from "./document";
import { deskExtensions } from "./editor-extensions";
import AudioUpload from "./audio-upload";
import PhotoTile from "./photo-tile";
import styles from "./format.module.css";
function parts(value: string, enabled: boolean) {
  const attachments: string[] = [], lines: string[] = [];
  for (const line of value.split("\n")) {
    const match = enabled && /^\[(audio|video|image)\]\(((?:https:\/\/|\/api\/research\/desk-media\/)[^\s]+)\)$/.exec(line.trim());
    if (match && mediaSource(match[2], match[1])) attachments.push(line.trim()); else lines.push(line);
  }
  return { text: lines.join("\n"), attachments };
}
export default function DeskTextEditor({ value, onChange, disabled = false, label = "本文", media = false, onMediaBusyChange, audioDraftKey, actions }: { actions?: ReactNode; audioDraftKey?: string; onMediaBusyChange?: (busy: boolean) => void; value: string; onChange: (value: string) => void; disabled?: boolean; label?: string; media?: boolean }) {
  // The attachment panel opens from the 添付 button (and when a saved audio draft is restored, or the page is opened for a voice memo).
  const [open, setOpen] = useState(() => media && new URL(window.location.href).searchParams.get("voiceMemo") === "1");
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
    {media && <div className={styles.attachPanel} hidden={!open}>
      <div className={styles.attachHead}><span>{clip}添付</span><button type="button" onClick={() => setOpen(false)}>閉じる ▲</button></div>
      <AudioUpload extraTiles={<PhotoTile disabled={disabled} onBusyChange={busy => { setUploading(busy); onMediaBusyChange?.(busy); }} onAdded={photoUrl => { const current = parts(last.current, media); return emit(current.text, [...current.attachments, `[image](${photoUrl})`]); }} />} draftKey={audioDraftKey} onRestored={() => setOpen(true)} disabled={disabled} onBusyChange={busy => { setUploading(busy); onMediaBusyChange?.(busy); }} onUploaded={(audioUrl, title) => {
        const current = parts(last.current, media);
        const text = [current.text, `音声：${title}`].filter(Boolean).join("\n");
        if (!emit(text, [...current.attachments, `[audio](${audioUrl})`])) return false;
        editor?.commands.setContent(deskDocument(text), { emitUpdate: false });
        return true;
      }} />
      <div className={styles.urlRow}>
        <div className={styles.kindSwitch} role="group" aria-label="メディアの種類">
          <button type="button" aria-pressed={kind === "image"} disabled={locked} onClick={() => setKind("image")}>画像URL</button>
          <button type="button" aria-pressed={kind === "video"} disabled={locked} onClick={() => setKind("video")}>YouTube</button>
        </div>
        <input type="url" aria-label="画像またはYouTubeのURL" value={url} disabled={locked} onChange={event => setUrl(event.target.value)} placeholder="https://" />
        <button type="button" className={styles.urlAdd} disabled={locked || !url} onClick={insertMedia}>追加</button>
      </div>
    </div>}
    {message && <p role="status">{message}</p>}
    {(media || actions) && <div className={styles.composerFoot}>
      {media && !open && <button type="button" className={styles.attachOpen} onClick={() => setOpen(true)}>{clip}添付</button>}
      <span className={styles.count}>{value.length.toLocaleString()} / 6,000</span>
      {actions}
    </div>}
  </div>;
}
const clip = <svg className={styles.clip} viewBox="0 0 24 24" aria-hidden="true"><path d="M20 11.500l-8 8a5 5 0 0 1-7-7l9-9a3.500 3.500 0 0 1 5 5l-9 9a2 2 0 0 1-3-3l8-8" /></svg>;

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
      <button type="button" className={styles.redTool} aria-label="赤文字" aria-pressed={active?.red ?? false} disabled={disabled} onMouseDown={e => e.preventDefault()} onClick={() => format("red")}><i aria-hidden="true" />赤</button>
      <button type="button" aria-label="黄色マーカー" aria-pressed={active?.highlight ?? false} disabled={disabled} onMouseDown={e => e.preventDefault()} onClick={() => format("highlight")}><span className={styles.markTool}>マーカー</span></button>
      <button type="button" aria-label="装飾を解除" disabled={disabled} onMouseDown={e => e.preventDefault()} onClick={() => format("clear")}>解除</button>
      <button type="button" aria-label="本文を全選択" disabled={disabled} onMouseDown={e => e.preventDefault()} onClick={selectText}>選択</button>
    </div>
  );
}
