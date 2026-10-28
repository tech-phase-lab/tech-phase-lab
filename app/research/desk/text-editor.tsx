"use client";
import dynamic from "next/dynamic";
// Readers do not download the editing engine; only mounted author/edit forms do.
const DeskTextEditor = dynamic(() => import("./rich-editor"), { ssr: false, loading: () => <div role="status" style={{ minHeight: 122, fontSize: 12, color: "#a6b0a9" }}>編集欄を準備中…</div> });
export default DeskTextEditor;
