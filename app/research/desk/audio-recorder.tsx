"use client";
import { useEffect, useRef, useState } from "react";
import { maxDeskAudioBytes } from "@/lib/research/desk-audio";
import styles from "./format.module.css";

type RecordingSession = { recorder: MediaRecorder | null; stream: MediaStream | null; cancelled: boolean; elapsed: number; runningSince: number; timer?: ReturnType<typeof setInterval> };
// A recording is only a local File. This component cannot upload or publish.
export default function AudioRecorder({ disabled, onFile, onBusyChange, onMessage }: { disabled: boolean; onFile: (file: File) => void; onBusyChange: (busy: boolean) => void; onMessage?: (message: string) => void }) {
  const [state, setState] = useState<"idle" | "requesting" | "recording" | "paused">("idle"), [seconds, setSeconds] = useState(0), [error, setError] = useState("");
  function report(message: string) { setError(message); onMessage?.(message); }
  const session = useRef<RecordingSession | null>(null);
  const callbacks = useRef({ onFile, onBusyChange });
  useEffect(() => { callbacks.current = { onFile, onBusyChange }; }, [onFile, onBusyChange]);
  useEffect(() => {
    const stop = () => { const current = session.current; if (current?.recorder && current.recorder.state !== "inactive") current.recorder.stop(); };
    const hide = () => { if (document.visibilityState === "hidden") stop(); };
    document.addEventListener("visibilitychange", hide);
    return () => {
      document.removeEventListener("visibilitychange", hide);
      const current = session.current; session.current = null;
      if (current) { current.cancelled = true; clearInterval(current.timer); if (current.recorder && current.recorder.state !== "inactive") current.recorder.stop(); current.stream?.getTracks().forEach(track => track.stop()); }
    };
  }, []);
  function cancel() {
    const current = session.current;
    if (!current) return;
    current.cancelled = true; clearInterval(current.timer);
    if (current.recorder && current.recorder.state !== "inactive") current.recorder.stop();
    current.stream?.getTracks().forEach(track => track.stop());
    session.current = null; setState("idle"); callbacks.current.onBusyChange(false);
  }
  function togglePause() {
    const current = session.current, recorder = current?.recorder;
    if (!current || !recorder) return;
    try {
      if (recorder.state === "recording") {
        recorder.pause(); current.elapsed += performance.now() - current.runningSince; setState("paused");
      } else if (recorder.state === "paused") {
        recorder.resume(); current.runningSince = performance.now(); setState("recording");
      }
    } catch { report("一時停止・再開ができませんでした。停止して音声を確認してください。"); }
  }
  async function start() {
    if (disabled || session.current) return;
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") { report("このブラウザでは録音できません。Safariでお試しください。"); return; }
    const mime = ["audio/mp4;codecs=mp4a.40.2", "audio/mp4"].find(type => MediaRecorder.isTypeSupported(type));
    if (!mime) { report("M4A録音に非対応です。音声ファイルを選んでください。"); return; }
    const current: RecordingSession = { recorder: null, stream: null, cancelled: false, elapsed: 0, runningSince: 0 };
    session.current = current; setState("requesting"); report(""); setSeconds(0); callbacks.current.onBusyChange(true);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      if (current.cancelled || session.current !== current) { stream.getTracks().forEach(track => track.stop()); return; }
      if (document.visibilityState === "hidden") { stream.getTracks().forEach(track => track.stop()); session.current = null; setState("idle"); callbacks.current.onBusyChange(false); return; }
      current.stream = stream;
      const recorder = new MediaRecorder(stream, { mimeType: mime, audioBitsPerSecond: 128000 }); current.recorder = recorder;
      const chunks: Blob[] = []; let bytes = 0, failed = false;
      recorder.ondataavailable = event => { bytes += event.data.size; if (bytes > maxDeskAudioBytes) { failed = true; chunks.length = 0; } else if (!failed && event.data.size) chunks.push(event.data); };
      recorder.onerror = () => { failed = true; if (recorder.state !== "inactive") recorder.stop(); else finish(); };
      function finish() {
        clearInterval(current.timer); stream.getTracks().forEach(track => track.stop());
        if (session.current !== current) return;
        session.current = null;
        if (!current.cancelled) {
          if (failed || bytes < 512) report("録音を保存できませんでした。もう一度録音してください。");
          else callbacks.current.onFile(new File(chunks, `rizel-${new Date().toISOString().replace(/[:.]/g, "-")}.m4a`, { type: "audio/mp4" }));
        }
        setState("idle"); callbacks.current.onBusyChange(false);
      }
      recorder.onstop = finish;
      stream.getAudioTracks().forEach(track => track.addEventListener("ended", () => { if (recorder.state !== "inactive") recorder.stop(); }, { once: true }));
      recorder.start(); setState("recording");
      current.runningSince = performance.now();
      current.timer = setInterval(() => { setSeconds(Math.floor((current.elapsed + (recorder.state === "recording" ? performance.now() - current.runningSince : 0)) / 1000)); }, 250);
    } catch {
      clearInterval(current.timer); current.stream?.getTracks().forEach(track => track.stop());
      if (session.current === current) { session.current = null; setState("idle"); report("録音できません。マイクの許可をご確認ください。"); callbacks.current.onBusyChange(false); }
    }
  }
  return <div className={styles.recorder}>
    <button className={styles.audioRecordEntry} type="button" disabled={disabled || state !== "idle"} onClick={() => void start()}>ここで録音</button>
    {state !== "idle" && <div className={styles.recorderControls}>
      <span className={styles.recording} role="status">{state === "requesting" ? "マイクの許可を待っています…" : `${state === "paused" ? "一時停止中" : "● 録音中"} ${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`}</span>
      {(state === "recording" || state === "paused") && <><button type="button" onClick={togglePause}>{state === "paused" ? "録音を再開" : "一時停止"}</button><button type="button" onClick={() => { const recorder = session.current?.recorder; if (recorder && recorder.state !== "inactive") recorder.stop(); }}>停止して試聴</button></>}
      <button type="button" onClick={cancel}>録音を破棄</button>
    </div>}
    {error && !onMessage && <p role="status">{error}</p>}
  </div>;
}
