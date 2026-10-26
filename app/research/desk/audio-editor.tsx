"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { cutAudioSpans, exportEditedAudio, frameCount, type AudioSpan } from "@/lib/research/desk-audio-edit";
import styles from "./format.module.css";
export default function AudioEditor({ file, disabled, onApply, onBusyChange }: { file: File; disabled: boolean; onApply: (file: File) => void; onBusyChange: (busy: boolean) => void }) {
  const [buffer, setBuffer] = useState<AudioBuffer | null>(null), [history, setHistory] = useState<AudioSpan[][]>([]);
  const [from, setFrom] = useState(0), [to, setTo] = useState(0), [working, setWorking] = useState(false), [opened, setOpened] = useState(false), [playing, setPlaying] = useState(false), [percent, setPercent] = useState(0), [error, setError] = useState("");
  const context = useRef<AudioContext | null>(null), nodes = useRef<AudioBufferSourceNode[]>([]), active = useRef<AbortController | null>(null), alive = useRef(true);
  const spans = history.at(-1), total = spans ? frameCount(spans) : 0, duration = buffer ? total / buffer.sampleRate : 0;
  const bars = useMemo(() => {
    if (!buffer || !spans) return [];
    const channel = buffer.getChannelData(0), size = frameCount(spans), result: number[] = [];
    let spanIndex = 0, offset = 0;
    for (let i = 0; i < 160; i++) {
      const frame = Math.floor(i / 160 * size);
      while (spanIndex < spans.length - 1 && frame >= offset + spans[spanIndex][1] - spans[spanIndex][0]) { offset += spans[spanIndex][1] - spans[spanIndex][0]; spanIndex++; }
      const [a, b] = spans[spanIndex]; let peak = 0;
      for (let j = a + frame - offset; j < Math.min(b, a + frame - offset + Math.ceil(size / 160)); j += 32) peak = Math.max(peak, Math.abs(channel[j]));
      result.push(Math.max(1, peak * 36));
    }
    return result;
  }, [buffer, spans]);
  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; active.current?.abort(); nodes.current.forEach(node => { node.onended = null; try { node.stop(); } catch {} node.disconnect(); }); if (context.current?.state !== "closed") void context.current?.close(); };
  }, []);
  function stop() { nodes.current.forEach(node => { node.onended = null; try { node.stop(); } catch {} node.disconnect(); }); nodes.current = []; setPlaying(false); }
  async function open() {
    if (disabled || active.current) return;
    if (typeof AudioEncoder === "undefined" || typeof AudioData === "undefined") { setError("このブラウザでは区間カットに対応していません。対応する新しいSafariで開いてください。一時停止・録音・添付は引き続き使えます。"); return; }
    const controller = new AbortController(); active.current = controller; setOpened(true); setWorking(true); onBusyChange(true); setError("");
    try {
      const ctx = new AudioContext({ sampleRate: 44100 }); context.current = ctx;
      const decoded = await ctx.decodeAudioData(await file.arrayBuffer());
      controller.signal.throwIfAborted();
      if (!decoded.length || decoded.numberOfChannels > 2) throw Error();
      if (!(await AudioEncoder.isConfigSupported({ codec: "mp4a.40.2", sampleRate: decoded.sampleRate, numberOfChannels: decoded.numberOfChannels, bitrate: 128000 })).supported) throw Error();
      controller.signal.throwIfAborted();
      setBuffer(decoded); setHistory([[[0, decoded.length]]]); setFrom(0); setTo(Math.min(1, decoded.duration));
    } catch {
      if (alive.current && !controller.signal.aborted) { setError("音声を編集用に開けませんでした。元の音声は残っています。この端末での音声編集に対応していない場合があります。"); close(); }
    } finally { if (active.current === controller) { active.current = null; if (alive.current) setWorking(false); } }
  }
  function close() { active.current?.abort(); active.current = null; stop(); if (context.current?.state !== "closed") void context.current?.close(); context.current = null; setOpened(false); setBuffer(null); setHistory([]); setWorking(false); onBusyChange(false); }
  function cut() {
    if (!buffer || !spans) return;
    try {
      const a = Math.round(from * buffer.sampleRate), b = Math.round(to * buffer.sampleRate);
      if (total - (b - a) < Math.ceil(buffer.sampleRate * 0.1)) throw Error();
      const next = cutAudioSpans(spans, a, b); stop(); setHistory([...history, next]); setFrom(0); setTo(Math.min(1, frameCount(next) / buffer.sampleRate)); setError("");
    } catch { setError("削除する区間を選んでください。音声全体は削除できません。"); }
  }
  async function play(selection: boolean) {
    if (!context.current || !buffer || !spans) return;
    stop(); const ctx = context.current;
    try {
      await ctx.resume(); if (!alive.current || context.current !== ctx) return;
      const start = selection ? from * buffer.sampleRate : 0, end = selection ? to * buffer.sampleRate : total;
      let at = 0, when = ctx.currentTime;
      for (const [a, b] of spans) {
        const lo = Math.max(0, start - at), hi = Math.min(b - a, end - at);
        if (hi > lo) { const node = ctx.createBufferSource(); node.buffer = buffer; node.connect(ctx.destination); node.start(when, (a + lo) / buffer.sampleRate, (hi - lo) / buffer.sampleRate); when += (hi - lo) / buffer.sampleRate; nodes.current.push(node); }
        at += b - a;
      }
      const last = nodes.current.at(-1); if (last) { setPlaying(true); last.onended = () => { if (alive.current) stop(); }; }
    } catch { setError("再生できませんでした。もう一度試聴を押してください。"); }
  }
  async function apply() {
    if (!buffer || !spans || active.current || history.length < 2) return;
    const controller = new AbortController(); active.current = controller; stop(); setWorking(true); setPercent(0); setError("");
    try { const edited = await exportEditedAudio(buffer, spans, controller.signal, value => { if (alive.current) setPercent(value); }); if (alive.current && !controller.signal.aborted) { close(); onApply(edited); } }
    catch { if (alive.current && !controller.signal.aborted) setError("編集した音声を作成できませんでした。元の音声は残っています。"); }
    finally { if (active.current === controller) { active.current = null; if (alive.current) setWorking(false); } }
  }
  return <div className={styles.audioCut}>
    {!opened ? <button type="button" disabled={disabled} onClick={() => void open()}>区間をカット</button> : <>
      <strong>不要な区間を選んで削除</strong>
      {buffer && <><svg viewBox="0 0 320 80" role="img" aria-label="音声の波形と選択区間"><rect x={duration ? from / duration * 320 : 0} y="0" width={duration ? (to - from) / duration * 320 : 0} height="80" fill="#dba978" opacity=".25" />{bars.map((height, i) => <line key={i} x1={i * 2 + 1} x2={i * 2 + 1} y1={40 - height} y2={40 + height} stroke="#acd2bd" />)}</svg>
      <small>音声の長さ：{duration.toFixed(1)}秒／選択区間：{Math.max(0, to - from).toFixed(1)}秒</small>
      <label>開始（秒）<input type="number" min="0" max={to} step="0.1" value={from} disabled={working} onChange={e => { stop(); setFrom(Math.max(0, Math.min(to, Number(e.target.value)))); }} /><input aria-label="カット開始位置" type="range" min="0" max={duration} step="0.1" value={from} disabled={working} onChange={e => { stop(); setFrom(Math.min(to, Number(e.target.value))); }} /></label>
      <label>終了（秒）<input type="number" min={from} max={duration} step="0.1" value={to} disabled={working} onChange={e => { stop(); setTo(Math.max(from, Math.min(duration, Number(e.target.value)))); }} /><input aria-label="カット終了位置" type="range" min="0" max={duration} step="0.1" value={to} disabled={working} onChange={e => { stop(); setTo(Math.max(from, Number(e.target.value))); }} /></label>
      <div><button type="button" disabled={working || to <= from} onClick={() => void play(true)}>選択区間を試聴</button><button type="button" disabled={working} onClick={() => void play(false)}>編集後を試聴</button>{playing && <button type="button" onClick={stop}>再生を停止</button>}</div>
      <div><button type="button" disabled={working || to <= from || history.length >= 51} onClick={cut}>選択区間を削除</button><button type="button" disabled={working || history.length < 2} onClick={() => { stop(); const next = history.slice(0, -1); setHistory(next); setFrom(0); setTo(Math.min(1, frameCount(next.at(-1)!) / buffer.sampleRate)); setError(""); }}>1つ戻す</button></div></>}
      {working && <span role="status">{buffer ? `音声を作成中 ${percent}%` : "音声を開いています…"}</span>}
      <div><button type="button" disabled={working || history.length < 2} onClick={() => void apply()}>編集を適用して試聴へ</button><button type="button" onClick={close}>編集を取り消す</button></div>
      <small>編集を適用しても、アップロード・公開はされません。</small>
    </>}
    {error && <p role="status">{error}</p>}
  </div>;
}
