"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { PDFDocumentProxy, RenderTask } from "pdfjs-dist";
import type { Annotation } from "@/lib/research/annotations";
import { saveNotebookPdf } from "@/lib/research/save-notebook-pdf";
import styles from "./notebook-pdf-preview.module.css";

export type PdfSnapshot = { content: HTMLElement; marks: Annotation[]; title: string; lang: "ja" | "en" };

function PdfPage({ pdf, number, lang, onReady, onError }: { pdf: PDFDocumentProxy; number: number; lang: string; onReady: () => void; onError: () => void }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const frame = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const element = canvas.current!, container = frame.current!;
    let active = false, disposed = false, generation = 0;
    let render: RenderTask | undefined;
    async function draw() {
      const current = ++generation;
      render?.cancel();
      try {
        const page = await pdf.getPage(number);
        if (disposed || !active || current !== generation) return;
        const base = page.getViewport({ scale: 1 });
        const viewport = page.getViewport({ scale: container.clientWidth / base.width * Math.min(window.devicePixelRatio || 1, 2) });
        element.width = Math.ceil(viewport.width); element.height = Math.ceil(viewport.height);
        render = page.render({ canvas: element, viewport });
        await render.promise;
        if (!disposed && current === generation) onReady();
      } catch (error) {
        if (!disposed && current === generation && !(error instanceof Error && error.name === "RenderingCancelledException")) onError();
      }
    }
    // Only retain canvases near the viewport, keeping long PDFs usable on phones.
    const observer = new IntersectionObserver(([entry]) => {
      active = entry.isIntersecting;
      if (active) void draw();
      else { generation++; render?.cancel(); element.width = 0; element.height = 0; }
    }, { rootMargin: "300px" });
    const resize = new ResizeObserver(() => { if (active) void draw(); });
    observer.observe(container); resize.observe(container);
    return () => { disposed = true; generation++; render?.cancel(); observer.disconnect(); resize.disconnect(); element.width = 0; element.height = 0; };
  }, [pdf, number, onReady, onError]);
  const label = lang === "ja" ? `${number} / ${pdf.numPages} ページ` : `Page ${number} of ${pdf.numPages}`;
  return <figure className={styles.page}>
    <div ref={frame} className={styles.paper}><canvas ref={canvas} role="img" aria-label={label} /></div>
    <figcaption>{label}</figcaption>
  </figure>;
}

export default function NotebookPdfPreview({ snapshot, onClose }: { snapshot: PdfSnapshot; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState<{ attempt: number; pdf: PDFDocumentProxy; file: File; url: string } | null>(null);
  const [failed, setFailed] = useState(false);
  const [ready, setReady] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [saveError, setSaveError] = useState(false);
  const current = result?.attempt === attempt ? result : null;
  const t = (ja: string, en: string) => snapshot.lang === "ja" ? ja : en;
  const onReady = useCallback(() => setReady(true), []);
  const onError = useCallback(() => setFailed(true), []);

  useEffect(() => {
    const element = dialog.current!;
    const previousFocus = document.activeElement as HTMLElement | null;
    const top = window.scrollY;
    const overflow = document.documentElement.style.overflow;
    element.showModal(); document.documentElement.style.overflow = "hidden";
    return () => {
      element.close(); document.documentElement.style.overflow = overflow;
      previousFocus?.focus({ preventScroll: true });
      window.scrollTo({ top, behavior: "instant" });
    };
  }, []);

  useEffect(() => {
    let cancelled = false, url: string | undefined;
    let task: { destroy: () => Promise<void> } | undefined;
    void (async () => {
      try {
        const [{ generateNotebookPdf }, viewer] = await Promise.all([
          import("@/lib/research/notebook-pdf-browser"), import("pdfjs-dist/legacy/build/pdf.mjs"),
        ]);
        if (cancelled) return;
        const blob = await generateNotebookPdf(snapshot.content, snapshot.marks, snapshot.title, snapshot.lang);
        if (cancelled) return;
        viewer.GlobalWorkerOptions.workerSrc = `/research-pdf-viewer/pdf.worker-${viewer.version}.min.mjs`;
        const loading = viewer.getDocument({ data: new Uint8Array(await blob.arrayBuffer()), useWasm: false });
        task = loading;
        if (cancelled) { await loading.destroy(); return; }
        const pdf = await loading.promise;
        if (cancelled) return;
        const file = new File([blob], `Tech-Phase-${snapshot.title.replace(/[\\/:*?"<>|]/g, "").slice(0, 80)}.pdf`, { type: "application/pdf" });
        url = URL.createObjectURL(file);
        setResult({ attempt, pdf, file, url });
      } catch { if (!cancelled) setFailed(true); }
    })();
    return () => { cancelled = true; void task?.destroy().catch(() => {}); if (url) URL.revokeObjectURL(url); };
  }, [snapshot, attempt]);

  return <dialog ref={dialog} className={styles.preview} aria-label={t("PDFプレビュー", "PDF preview")} onCancel={event => { event.preventDefault(); onClose(); }}>
    <header className={styles.header}>
      <button onClick={onClose} aria-label={t("プレビューを閉じる", "Close preview")}><span aria-hidden="true">×</span>{t("閉じる", "Close")}</button>
      <strong>{t("PDFプレビュー", "PDF preview")}</strong>
      <button className={styles.save} disabled={!current || !ready || failed || sharing} onClick={async () => {
        if (!current) return;
        setSharing(true); setSaveError(false);
        try { await saveNotebookPdf(current.file, current.url, snapshot.title); }
        catch (error) { if (!(error instanceof DOMException && error.name === "AbortError")) setSaveError(true); }
        finally { setSharing(false); }
      }}>{t("保存", "Save")}</button>
    </header>
    <div className={styles.pages}>
      {saveError && <p role="alert">{t("保存できませんでした。もう一度お試しください。", "Could not save. Please try again.")}</p>}
      {failed ? <div className={styles.status} role="alert"><p>{t("プレビューを表示できませんでした。", "Could not load the preview.")}</p><button onClick={() => { setFailed(false); setReady(false); setAttempt(value => value + 1); }}>{t("再試行", "Retry")}</button></div>
        : !current ? <p className={styles.status} role="status">{t("プレビューを作成中…", "Preparing preview…")}</p>
        : Array.from({ length: current.pdf.numPages }, (_, index) => <PdfPage key={`${attempt}:${index}`} pdf={current.pdf} number={index + 1} lang={snapshot.lang} onReady={onReady} onError={onError} />)}
    </div>
  </dialog>;
}
