"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { cutAudioSpans, exportEditedAudio, frameCount, type AudioSpan } from "@/lib/research/desk-audio-edit";
import styles from "./audio-editor.module.css";

/** "0:21" (and "0:21.4" when the tenths matter). */
export function clock(seconds: number) {
  const safe = Math.max(0, seconds), tenths = Math.round(safe * 10), whole = Math.floor(tenths / 10), tenth = tenths % 10;
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}${tenth ? `.${tenth}` : ""}`;
}
const MIN = 0.1;

/** The "音声を整える" sheet: pick a range on the waveform with two gold handles, keep it or delete it, listen to the result, then add it.
 * Everything happens in the browser; nothing is uploaded here. */
export default function AudioEditor({ file, disabled, onApply, onBusyChange }: { file: File; disabled: boolean; onApply: (file: File) => void; onBusyChange: (busy: boolean) => void }) {
  const [opened, setOpened] = useState(false), [buffer, setBuffer] = useState<AudioBuffer | null>(null), [working, setWorking] = useState(false), [percent, setPercent] = useState(0), [error, setError] = useState("");
  const [from, setFrom] = useState(0), [to, setTo] = useState(0), [mode, setMode] = useState<"keep" | "delete">("keep"), [side, setSide] = useState<"from" | "to">("from");
  const [playing, setPlaying] = useState(false), [head, setHead] = useState<number | null>(null);
  const context = useRef<AudioContext | null>(null), nodes = useRef<AudioBufferSourceNode[]>([]), active = useRef<AbortController | null>(null), alive = useRef(true), frame = useRef(0), box = useRef<HTMLDivElement>(null);
  const duration = buffer ? buffer.length / buffer.sampleRate : 0;

  // The spans that would be kept, in original sample positions; null when the choice is empty or would remove everything.
  const spans = useMemo<AudioSpan[] | null>(() => {
    if (!buffer) return null;
    const a = Math.round(from * buffer.sampleRate), b = Math.min(buffer.length, Math.round(to * buffer.sampleRate));
    if (b - a < Math.ceil(buffer.sampleRate * MIN)) return null;
    try { return mode === "keep" ? [[a, b]] : cutAudioSpans([[0, buffer.length]], a, b); } catch { return null; }
  }, [buffer, from, to, mode]);
  const finished = buffer && spans ? frameCount(spans) / buffer.sampleRate : 0;
  const unchanged = !!buffer && !!spans && frameCount(spans) === buffer.length;
  const bars = useMemo(() => {
    if (!buffer) return [] as number[];
    const channel = buffer.getChannelData(0), count = 72, size = Math.max(1, Math.floor(channel.length / count)), result: number[] = [];
    for (let i = 0; i < count; i++) { let peak = 0; for (let j = i * size; j < Math.min(channel.length, (i + 1) * size); j += Math.max(1, Math.floor(size / 24))) peak = Math.max(peak, Math.abs(channel[j])); result.push(peak); }
    const top = Math.max(0.05, ...result);
    return result.map(value => Math.max(0.06, value / top));
  }, [buffer]);

  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; active.current?.abort(); cancelAnimationFrame(frame.current); nodes.current.forEach(node => { node.onended = null; try { node.stop(); } catch { /* already stopped */ } node.disconnect(); }); if (context.current?.state !== "closed") void context.current?.close(); };
  }, []);
  function stop() { cancelAnimationFrame(frame.current); nodes.current.forEach(node => { node.onended = null; try { node.stop(); } catch { /* already stopped */ } node.disconnect(); }); nodes.current = []; setPlaying(false); setHead(null); }
  async function open() {
    if (disabled || active.current) return;
    if (typeof AudioEncoder === "undefined" || typeof AudioData === "undefined") { setError("このブラウザではカットできません。"); return; }
    const controller = new AbortController(); active.current = controller; setOpened(true); setWorking(true); onBusyChange(true); setError("");
    try {
      const ctx = new AudioContext({ sampleRate: 44100 }); context.current = ctx;
      const decoded = await ctx.decodeAudioData(await file.arrayBuffer());
      controller.signal.throwIfAborted();
      if (!decoded.length || decoded.numberOfChannels > 2) throw Error();
      if (!(await AudioEncoder.isConfigSupported({ codec: "mp4a.40.2", sampleRate: decoded.sampleRate, numberOfChannels: decoded.numberOfChannels, bitrate: 128000 })).supported) throw Error();
      controller.signal.throwIfAborted();
      const length = decoded.length / decoded.sampleRate;
      // Start with the middle part chosen, so there is something to drag from.
      setBuffer(decoded); setFrom(Math.round(length * 0.25 * 10) / 10); setTo(Math.round(length * 0.75 * 10) / 10); setMode("keep"); setSide("from");
    } catch {
      if (alive.current && !controller.signal.aborted) { setError("音声を開けませんでした。"); close(); }
    } finally { if (active.current === controller) { active.current = null; if (alive.current) setWorking(false); } }
  }
  function close() { active.current?.abort(); active.current = null; stop(); if (context.current?.state !== "closed") void context.current?.close(); context.current = null; setOpened(false); setBuffer(null); setWorking(false); onBusyChange(false); }
  const round = (value: number) => Math.round(value * 10) / 10;
  function setSelection(next: { from?: number; to?: number }) {
    stop();
    const a = next.from ?? from, b = next.to ?? to;
    if (next.from !== undefined) setFrom(Math.max(0, Math.min(round(a), round(b - MIN))));
    if (next.to !== undefined) setTo(Math.min(round(duration), Math.max(round(b), round(a + MIN))));
  }
  function nudge(delta: number) { if (side === "from") setSelection({ from: from + delta }); else setSelection({ to: to + delta }); }
  function drag(which: "from" | "to") {
    return (event: React.PointerEvent<HTMLButtonElement>) => {
      event.preventDefault(); setSide(which);
      const target = event.currentTarget; target.setPointerCapture(event.pointerId);
      const move = (e: PointerEvent) => {
        const rect = box.current?.getBoundingClientRect(); if (!rect || !rect.width) return;
        const seconds = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width)) * duration;
        if (which === "from") setSelection({ from: seconds }); else setSelection({ to: seconds });
      };
      const up = () => { target.removeEventListener("pointermove", move); target.removeEventListener("pointerup", up); target.removeEventListener("pointercancel", up); };
      target.addEventListener("pointermove", move); target.addEventListener("pointerup", up); target.addEventListener("pointercancel", up);
    };
  }
  /** Where an edited-timeline position sits on the original waveform, for the white playhead. */
  function original(editedSeconds: number) {
    if (!buffer || !spans) return 0;
    let left = editedSeconds * buffer.sampleRate;
    for (const [a, b] of spans) { if (left <= b - a) return (a + left) / buffer.sampleRate; left -= b - a; }
    return spans.at(-1)![1] / buffer.sampleRate;
  }
  async function play() {
    if (playing) { stop(); return; }
    if (!context.current || !buffer || !spans) return;
    stop(); const ctx = context.current;
    try {
      await ctx.resume(); if (!alive.current || context.current !== ctx) return;
      let when = ctx.currentTime + 0.05; const startedAt = when;
      for (const [a, b] of spans) {
        const node = ctx.createBufferSource(); node.buffer = buffer; node.connect(ctx.destination);
        node.start(when, a / buffer.sampleRate, (b - a) / buffer.sampleRate); when += (b - a) / buffer.sampleRate; nodes.current.push(node);
      }
      const last = nodes.current.at(-1); if (!last) return;
      setPlaying(true);
      last.onended = () => { if (alive.current) stop(); };
      const tick = () => { if (!alive.current || !context.current) return; setHead(original(Math.max(0, ctx.currentTime - startedAt))); frame.current = requestAnimationFrame(tick); };
      frame.current = requestAnimationFrame(tick);
    } catch { setError("再生できませんでした。"); }
  }
  async function apply() {
    if (!buffer || !spans || active.current || unchanged) return;
    const controller = new AbortController(); active.current = controller; stop(); setWorking(true); setPercent(0); setError("");
    try { const edited = await exportEditedAudio(buffer, spans, controller.signal, value => { if (alive.current) setPercent(value); }); if (alive.current && !controller.signal.aborted) { close(); onApply(edited); } }
    catch { if (alive.current && !controller.signal.aborted) setError("編集を適用できませんでした。"); }
    finally { if (active.current === controller) { active.current = null; if (alive.current) setWorking(false); } }
  }
  const pct = (seconds: number) => duration ? `${seconds / duration * 100}%` : "0%";
  const ticks = duration ? [0, 0.25, 0.5, 0.75, 1].map(fraction => ({ at: fraction, label: clock(Math.round(fraction * duration)) })) : [];
  return <>
    <button type="button" className={styles.open} disabled={disabled || opened} onClick={() => void open()}>
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 7h9M18 7h1M5 17h2M11 17h8M14 4v6M8 14v6" /></svg>編集
    </button>
    {!opened && error && <small className={styles.inlineError} role="status">{error}</small>}
    {opened && <div className={styles.wrap} role="dialog" aria-modal="true" aria-label="音声を整える">
      <div className={styles.backdrop} />
      <div className={styles.sheet}>
        <i className={styles.grip} aria-hidden="true" />
        <h2>音声を整える<small>{buffer ? `全体 ${clock(duration)}` : ""}</small></h2>
        {!buffer ? <p className={styles.status} role="status">{error || "音声を開いています…"}</p> : <>
          <div className={styles.wave} ref={box} role="group" aria-label="音声の波形と選んだ範囲">
            <div className={styles.shade} style={{ left: pct(from), width: pct(to - from) }} />
            <div className={styles.bars} aria-hidden="true">{bars.map((height, index) => {
              const at = (index + 0.5) / bars.length * duration, inside = at >= from && at <= to;
              return <i key={index} style={{ height: `${Math.round(height * 100)}%`, opacity: inside ? 1 : 0.38 }} />;
            })}</div>
            {head !== null && <span className={styles.head} style={{ left: pct(head) }} aria-hidden="true" />}
            <button type="button" className={`${styles.handle} ${side === "from" ? styles.on : ""}`} style={{ left: pct(from) }} aria-label="開始位置" onPointerDown={drag("from")} />
            <button type="button" className={`${styles.handle} ${side === "to" ? styles.on : ""}`} style={{ left: pct(to) }} aria-label="終了位置" onPointerDown={drag("to")} />
            <div className={styles.ticks} aria-hidden="true">{ticks.map(tick => <span key={tick.at} style={{ left: `${tick.at * 100}%` }}>{tick.label}</span>)}</div>
          </div>
          <div className={styles.times}>
            <div><small>開始</small><b>{clock(from)}</b></div>
            <div><small>終了</small><b>{clock(to)}</b></div>
            <div><small>仕上がり</small><b>{clock(finished)}</b></div>
          </div>
          <div className={styles.nudge} role="group" aria-label={side === "from" ? "開始位置を動かす" : "終了位置を動かす"}>
            {[[-1, "-1秒"], [-0.1, "-0.1"], [0.1, "+0.1"], [1, "+1秒"]].map(([delta, label]) => <button type="button" key={label as string} disabled={working} onClick={() => nudge(delta as number)}>{label}</button>)}
          </div>
          <div className={styles.modes} role="group" aria-label="選んだ部分の扱い">
            <button type="button" aria-pressed={mode === "keep"} onClick={() => { stop(); setMode("keep"); }}>選んだ部分を残す</button>
            <button type="button" aria-pressed={mode === "delete"} onClick={() => { stop(); setMode("delete"); }}>選んだ部分を削除</button>
          </div>
          <div className={styles.listen}>
            <button type="button" className={styles.play} aria-label={playing ? "再生を止める" : "仕上がりを再生"} disabled={working || !spans} onClick={() => void play()}>
              {playing ? <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14M16 5v14" /></svg> : <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5l11 7-11 7z" /></svg>}
            </button>
            <p>選んだ部分だけを再生して、仕上がりを確かめられます。</p>
          </div>
          {!spans && <p className={styles.status} role="status">0.1秒以上の範囲を選んでください。</p>}
          {working && <p className={styles.status} role="status">音声を作成中 {percent}%</p>}
          {error && <p className={styles.status} role="status">{error}</p>}
          <div className={styles.actions}>
            <button type="button" className={styles.cancel} onClick={close}>やめる</button>
            <button type="button" className={styles.add} disabled={working || !spans || unchanged} onClick={() => void apply()}>この内容で追加</button>
          </div>
        </>}
      </div>
    </div>}
  </>;
}
