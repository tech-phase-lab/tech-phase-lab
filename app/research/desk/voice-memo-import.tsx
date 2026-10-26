"use client";
import { useEffect, useRef, useState } from "react";
import { voiceMemoFile } from "@/lib/research/desk-voice-memo";
export default function VoiceMemoImport({ disabled, onFile, onBusyChange }: { disabled: boolean; onFile: (file: File) => void; onBusyChange: (busy: boolean) => void }) {
  const [busy, setBusy] = useState(false), [message, setMessage] = useState("");
  const active = useRef(false), alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  async function read() {
    if (disabled || active.current) return;
    if (!navigator.clipboard?.readText) { setMessage("音声を読み込めません。Safariで開いてください。"); return; }
    active.current = true; setBusy(true); onBusyChange(true); setMessage("");
    try {
      // Safari requires a deliberate tap; never read clipboard on page load.
      const text = await navigator.clipboard.readText();
      if (alive.current) onFile(voiceMemoFile(text));
    } catch { if (alive.current) setMessage("読み込めませんでした。ボイスメモの共有から「Tech Phaseに音声を送る」を実行し、貼り付けを許可してください。50MBまで対応しています。"); }
    finally { active.current = false; if (alive.current) { setBusy(false); onBusyChange(false); } }
  }
  return <><button type="button" disabled={disabled || busy} onClick={() => void read()}>{busy ? "音声を読み込み中…" : "ボイスメモから読み込む"}</button>{message && <p role="status">{message}</p>}</>;
}
