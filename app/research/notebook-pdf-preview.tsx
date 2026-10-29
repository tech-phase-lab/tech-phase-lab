"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { PDFDocumentProxy, RenderTask } from "pdfjs-dist";
import type { Annotation } from "@/lib/research/annotations";
import { saveNotebookPdf } from "@/lib/research/save-notebook-pdf";
import styles from "./notebook-pdf-preview.module.css";

export type PdfSnapshot = { content: HTMLElement; marks: Annotation[]; title: string; lang: "ja" | "en" };

function PdfPage({ pdf, number, lang, selecting, selected, onToggle, onReady, onError }: { pdf: PDFDocumentProxy; number: number; lang: string; selecting: boolean; selected: boolean; onToggle: () => void; onReady: () => void; onError: () => void }) {
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
  return <figure className={`${styles.page} ${selecting && selected ? styles.selectedPage : ""}`}>
    <figcaption>{selecting && selected && <span aria-hidden="true">✓ </span>}{lang === "ja" ? `${number}ページ` : `Page ${number}`}</figcaption>
    <div ref={frame} className={styles.paper}>
      <canvas ref={canvas} role="img" aria-label={label} />
      {selecting && <button className={styles.pageTap} aria-label={lang === "ja" ? `${number}ページを選択` : `Select page ${number}`} aria-pressed={selected} onClick={onToggle} />}
    </div>
  </figure>;
}

export default function NotebookPdfPreview({ snapshot, onClose }: { snapshot: PdfSnapshot; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState<{ attempt: number; pdf: PDFDocumentProxy; file: File; url: string } | null>(null);
  const [selecting, setSelecting] = useState(false);
  const [pageNumbers, setPageNumbers] = useState<number[] | null>(null);
  const [selection, setSelection] = useState<{ source: File; pages: string; file: File; url: string } | null>(null);
  const [selectionError, setSelectionError] = useState(false);
  const [failed, setFailed] = useState(false);
  const [ready, setReady] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [saveError, setSaveError] = useState(false);
  const current = result?.attempt === attempt ? result : null;
  const pageKey = pageNumbers?.join(",") ?? "all";
  const exportFile = pageNumbers === null ? current : selection?.source === current?.file && selection?.pages === pageKey ? selection : null;
  const visiblePages = pageNumbers ?? Array.from({ length: current?.pdf.numPages ?? 0 }, (_, index) => index + 1);
  function changePages(numbers: number[] | null) {
    setSelection(null); setPageNumbers(numbers); setSelectionError(false); setSaveError(false);
  }
  const t = (ja: string, en: string) => snapshot.lang === "ja" ? ja : en;
  const onReady = useCallback(() => setReady(true), []);
  const onError = useCallback(() => setFailed(true), []);

  useEffect(() => {
    const element = dialog.current!;
    const previousFocus = document.activeElement as HTMLElement | null;
    const top = window.scrollY;
    const overflow = document.documentElement.style.overflow;
    element.showModal(); element.focus({ preventScroll: true }); document.documentElement.style.overflow = "hidden";
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

  useEffect(() => {
    if (!current || !pageNumbers?.length) return;
    let cancelled = false, url: string | undefined;
    void (async () => {
      try {
        const { extractNotebookPdfPages } = await import("@/lib/research/notebook-pdf-page");
        const bytes = await extractNotebookPdfPages(await current.file.arrayBuffer(), pageNumbers);
        if (cancelled) return;
        const file = new File([bytes], current.file.name.replace(/\.pdf$/, `-p${pageNumbers.join("-")}.pdf`), { type: "application/pdf" });
        url = URL.createObjectURL(file);
        setSelection({ source: current.file, pages: pageKey, file, url });
      } catch { if (!cancelled) setSelectionError(true); }
    })();
    return () => { cancelled = true; if (url) URL.revokeObjectURL(url); };
  }, [current, pageNumbers, pageKey]);

  return <dialog ref={dialog} tabIndex={-1} className={styles.preview} aria-label={t("PDFプレビュー", "PDF preview")} onCancel={event => { event.preventDefault(); onClose(); }}>
    <header className={styles.header}>
      <button onClick={onClose} aria-label={t("プレビューを閉じる", "Close preview")}><span aria-hidden="true">×</span>{t("閉じる", "Close")}</button>
      <button className={styles.selectPages} aria-pressed={selecting} disabled={!current || sharing} onClick={() => {
        setSelecting(!selecting); changePages(selecting ? null : []);
      }}>{selecting ? t("全ページに戻す", "Use all pages") : t("ページを選択", "Select pages")}</button>
      <button className={styles.save} disabled={!exportFile || !ready || failed || selectionError || sharing} onClick={async () => {
        if (!exportFile) return;
        setSharing(true); setSaveError(false);
        try { await saveNotebookPdf(exportFile.file, exportFile.url, snapshot.title); }
        catch (error) { if (!(error instanceof DOMException && error.name === "AbortError")) setSaveError(true); }
        finally { setSharing(false); }
      }}>{t("保存", "Save")}</button>
    </header>
    {selecting && <div className={styles.selectedNumbers} aria-live="polite">
      {pageNumbers?.length ? pageNumbers.map(number => <span key={number}>{t(`${number}ページ`, `Page ${number}`)}</span>) : <span className={styles.selectionHint}>{t("保存するページをタップ", "Tap the pages to save")}</span>}
    </div>}
    <div className={styles.pages}>
      {(saveError || selectionError) && <p role="alert">{t("保存できませんでした。もう一度お試しください。", "Could not save. Please try again.")}</p>}
      {failed ? <div className={styles.status} role="alert"><p>{t("プレビューを表示できませんでした。", "Could not load the preview.")}</p><button onClick={() => { setFailed(false); setReady(false); setAttempt(value => value + 1); }}>{t("再試行", "Retry")}</button></div>
        : !current ? <p className={styles.status} role="status">{t("プレビューを作成中…", "Preparing preview…")}</p>
        : Array.from({ length: current.pdf.numPages }, (_, index) => index + 1).map(number => <PdfPage key={`${attempt}:${number}`} pdf={current.pdf} number={number} lang={snapshot.lang} selecting={selecting} selected={visiblePages.includes(number)} onToggle={() => {
          if (sharing) return;
          changePages(visiblePages.includes(number) ? visiblePages.filter(page => page !== number) : [...visiblePages, number].sort((a, b) => a - b));
        }} onReady={onReady} onError={onError} />)}
    </div>
  </dialog>;
}
