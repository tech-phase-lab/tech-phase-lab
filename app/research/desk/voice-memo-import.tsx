"use client";
import { useEffect, useRef, useState } from "react";
import styles from "./format.module.css";
import { voiceMemoFile } from "@/lib/research/desk-voice-memo";
export default function VoiceMemoImport({ disabled, onFile, onBusyChange, onMessage }: { disabled: boolean; onFile: (file: File) => void; onBusyChange: (busy: boolean) => void; onMessage?: (message: string) => void }) {
  const [busy, setBusy] = useState(false), [message, setMessage] = useState("");
  function report(message: string) { setMessage(message); onMessage?.(message); }
  const active = useRef(false), alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  async function read() {
    if (disabled || active.current) return;
    if (!navigator.clipboard?.readText) { report("読み込めませんでした。"); return; }
    active.current = true; setBusy(true); onBusyChange(true); report("");
    try {
      // Safari requires a deliberate tap; never read clipboard on page load.
      const text = await navigator.clipboard.readText();
      if (alive.current) onFile(voiceMemoFile(text));
    } catch { if (alive.current) report("読み込めませんでした。"); }
    finally { active.current = false; if (alive.current) { setBusy(false); onBusyChange(false); } }
  }
  return <><button className={styles.audioMemoEntry} type="button" aria-label="ボイスメモから読み込む" aria-busy={busy} disabled={disabled || busy} onClick={() => void read()}>ボイスメモ</button>{message && !onMessage && <p role="status">{message}</p>}</>;
}
