"use client";
import { useEffect, useRef, useState } from "react";
import { Slice } from "@tiptap/pm/model";
import { EditorContent, useEditor, useEditorState } from "@tiptap/react";
import DeskBody, { mediaSource } from "./body";
import { deskDocument, deskText } from "./document";
import { deskExtensions } from "./editor-extensions";
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
  const last = useRef(value), reserved = useRef(0);
  const [url, setUrl] = useState(""), [kind, setKind] = useState("image"), [message, setMessage] = useState("");
  const { attachments } = parts(value, media);
  const attachmentLength = attachments.length ? attachments.join("\n").length + 1 : 0;
  function emit(text: string, files = attachments) {
    const next = [text, ...files].filter(Boolean).join("\n");
    if (next.length > 6000) { setMessage("6,000文字以内で入力してください。"); return false; }
    last.current = next; onChange(next); setMessage(""); return true;
  }
  const editor = useEditor({
    immediatelyRender: false,
    // eslint-disable-next-line react-hooks/refs -- Read only when ProseMirror filters an editing transaction, never during render.
    extensions: deskExtensions(() => 6000 - reserved.current),
    content: deskDocument(parts(value, media).text),
    editable: !disabled,
    enableInputRules: false, enablePasteRules: false,
    editorProps: {
      attributes: { class: styles.editable, role: "textbox", "aria-label": label, "aria-multiline": "true", spellcheck: "true" },
      handlePaste(view, event) {
        const text = event.clipboardData?.getData("text/plain");
        if (text === undefined) return false;
        event.preventDefault();
        const slice = Slice.maxOpen(view.state.schema.nodeFromJSON(deskDocument(text)).content);
        view.dispatch(view.state.tr.replaceSelection(slice)); return true;
      },
      handleDrop: () => true,
    },
    onUpdate: ({ editor: current }) => { emit(deskText(current.getJSON())); },
  });
  const active = useEditorState({ editor, selector: ({ editor: current }) => ({ bold: current?.isActive("bold") ?? false, red: current?.isActive("textStyle", { color: "#ff8888" }) ?? false, highlight: current?.isActive("highlight") ?? false }) });
  useEffect(() => { reserved.current = attachmentLength; }, [attachmentLength]);
  useEffect(() => {
    if (editor && last.current !== value) { editor.commands.setContent(deskDocument(parts(value, media).text), { emitUpdate: false }); last.current = value; }
  }, [editor, value, media]);
  useEffect(() => { editor?.setEditable(!disabled); }, [editor, disabled]);
  function format(command: "bold" | "red" | "highlight" | "clear") {
    if (!editor || disabled) return;
    const chain = editor.chain().focus();
    if (command === "bold") chain.toggleBold().run();
    if (command === "red") { if (editor.isActive("textStyle", { color: "#ff8888" })) chain.unsetColor().run(); else chain.setColor("#ff8888").run(); }
    if (command === "highlight") chain.toggleHighlight().run();
    if (command === "clear") chain.unsetBold().unsetColor().unsetHighlight().run();
  }
  function selectText() { editor?.chain().focus().selectAll().run(); }
  function insertMedia() {
    if (!mediaSource(url, kind)) { setMessage("HTTPSの画像・音声・動画ファイル、またはYouTubeのURLを入力してください。"); return; }
    if (emit(editor ? deskText(editor.getJSON()) : parts(value, media).text, [...attachments, `[${kind}](${url})`])) setUrl("");
  }
  return <div className={styles.editor}>
    <div className={styles.toolbar} role="group" aria-label={`${label}の文字装飾`}>
      <button type="button" aria-label="太字" aria-pressed={active?.bold ?? false} disabled={disabled} onMouseDown={e => e.preventDefault()} onClick={() => format("bold")} title="太字"><strong>B</strong></button>
      <button type="button" className={styles.red} aria-label="赤文字" aria-pressed={active?.red ?? false} disabled={disabled} onMouseDown={e => e.preventDefault()} onClick={() => format("red")}>赤</button>
      <button type="button" aria-label="黄色マーカー" aria-pressed={active?.highlight ?? false} disabled={disabled} onMouseDown={e => e.preventDefault()} onClick={() => format("highlight")}>マーカー</button>
      <button type="button" aria-label="装飾を解除" disabled={disabled} onMouseDown={e => e.preventDefault()} onClick={() => format("clear")}>解除</button>
      <button type="button" aria-label="本文を全選択" disabled={disabled} onMouseDown={e => e.preventDefault()} onClick={selectText}>選択</button>
    </div>
    <EditorContent editor={editor} />
    {attachments.map((attachment, index) => <div className={styles.attachment} key={`${index}-${attachment}`}><DeskBody text={attachment} media /><button type="button" aria-label="添付を削除" disabled={disabled} onClick={() => emit(editor ? deskText(editor.getJSON()) : parts(value, media).text, attachments.filter((_, i) => i !== index))}>×</button></div>)}
    {media && <details><summary>添付</summary><div className={styles.mediaInput}><select aria-label="メディアの種類" value={kind} disabled={disabled} onChange={event => setKind(event.target.value)}><option value="image">画像</option><option value="audio">音声</option><option value="video">動画</option></select><input type="url" aria-label="画像・音声・動画のURL" value={url} disabled={disabled} onChange={event => setUrl(event.target.value)} placeholder="https://" /><button type="button" disabled={disabled || !url} onClick={insertMedia}>追加</button></div><p className={styles.hint}>文章なしでも投稿できます。画像・音声・動画はURLで追加します。</p></details>}
    {message && <p role="status">{message}</p>}
  </div>;
}
