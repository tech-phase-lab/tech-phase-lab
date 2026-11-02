"use client";
import { useEffect, useRef, useState } from "react";
import { maxDeskImageBytes, validImageUpload } from "@/lib/research/desk-audio";
import styles from "./format.module.css";

/** A phone photo is redrawn as a JPEG no wider than 1800 px (the camera's own format, size and location data stay behind), then sent straight to the private bucket. */
async function toJpeg(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 1800 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bitmap.width * scale)); canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  for (const quality of [0.86, 0.72, 0.58]) {
    const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, "image/jpeg", quality));
    if (blob && blob.size <= maxDeskImageBytes) return blob;
  }
  throw Error("too-large");
}

export default function PhotoTile({ disabled, onAdded, onBusyChange }: { disabled: boolean; onAdded: (url: string) => boolean | void; onBusyChange: (busy: boolean) => void }) {
  const input = useRef<HTMLInputElement>(null), active = useRef<AbortController | null>(null), mounted = useRef(true);
  const [progress, setProgress] = useState<number | null>(null), [error, setError] = useState("");
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; active.current?.abort(); }; }, []);
  async function choose(file?: File) {
    if (!file || active.current || disabled) return;
    if (!file.type.startsWith("image/")) { setError("写真を選んでください。"); return; }
    const controller = new AbortController(); active.current = controller;
    setError(""); setProgress(0); onBusyChange(true);
    async function call(body: object) {
      const response = await fetch("/api/research/desk-media", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.any([controller.signal, AbortSignal.timeout(30000)]) });
      const data = await response.json(); if (!response.ok || !data.ok) throw Error(data.error || "failed"); return data;
    }
    try {
      const jpeg = await toJpeg(file);
      if (!validImageUpload(jpeg.size)) throw Error("too-large");
      const start = await call({ action: "start-image", size: jpeg.size });
      await new Promise<void>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        const abort = () => xhr.abort(); controller.signal.addEventListener("abort", abort, { once: true });
        xhr.open("PUT", start.uploadUrl); xhr.setRequestHeader("Content-Type", start.contentType); xhr.timeout = 300000;
        xhr.upload.onprogress = event => { if (mounted.current && event.lengthComputable) setProgress(Math.min(99, Math.round(event.loaded / event.total * 100))); };
        xhr.onload = () => { if (xhr.status >= 200 && xhr.status < 300) resolve(); else reject(Error("upload-failed")); };
        xhr.onerror = xhr.ontimeout = xhr.onabort = () => reject(Error("upload-failed"));
        xhr.onloadend = () => controller.signal.removeEventListener("abort", abort);
        if (controller.signal.aborted) { reject(Error("cancelled")); return; }
        xhr.send(jpeg);
      });
      const result = await call({ action: "finish-image", file: start.file });
      if (mounted.current && !controller.signal.aborted && onAdded(result.url) === false) setError("本文が長すぎます。");
    } catch (reason) {
      if (mounted.current) setError(reason instanceof Error && reason.message === "setup-required" ? "保存先に接続できません。" : reason instanceof Error && reason.message === "too-large" ? "写真が大きすぎます。" : "写真を送れませんでした。");
    } finally {
      active.current = null;
      if (mounted.current) { setProgress(null); if (input.current) input.current.value = ""; onBusyChange(false); }
    }
  }
  return <>
    <input ref={input} type="file" accept="image/*" aria-label="写真を選択" hidden onChange={event => void choose(event.target.files?.[0])} />
    <button className={`${styles.attachTile} ${styles.photoEntry}`} type="button" aria-label="写真を選ぶ" disabled={disabled || progress !== null} onClick={() => { setError(""); input.current?.click(); }}>
      <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3.500" y="4.500" width="17" height="15" rx="3" /><circle cx="9" cy="10" r="1.600" /><path d="M5 17l4.500-4.500 3 3 2.500-2.500L19 17" /></svg>
      <span>{progress === null ? "写真" : `送信中 ${progress}%`}</span>
    </button>
    {error && <p role="status">{error}</p>}
  </>;
}
