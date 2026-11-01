"use client";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

type Status = { enabled: boolean; pending: boolean; locked: boolean; verified: boolean };
type Setup = { secret: string; uri: string };
const box = { maxWidth: 520, margin: "0 auto", padding: "20px 16px 60px", lineHeight: 1.8 } as const;
const card = { border: "1px solid #2a3140", borderRadius: 16, padding: 16, margin: "16px 0", background: "#10141c" } as const;
const field = { width: "100%", fontSize: 24, letterSpacing: ".3em", textAlign: "center", padding: 12, borderRadius: 12, border: "1px solid #3a4356", background: "#0b0e14", color: "inherit" } as const;
const button = { width: "100%", marginTop: 12, padding: "14px 16px", borderRadius: 999, border: 0, fontSize: 16, fontWeight: 600, background: "#d9b56a", color: "#1a1405" } as const;

async function call(path: string, body?: unknown) {
  const response = await fetch(`/api/research/account/owner-2fa/${path}`, body === undefined
    ? { cache: "no-store", credentials: "same-origin" }
    : { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  let data: Record<string, unknown> = {};
  try { data = await response.json(); } catch { /* not JSON */ }
  return { ok: response.ok, status: response.status, data };
}

export default function OwnerTwoFactorScreen() {
  const [status, setStatus] = useState<Status | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [setup, setSetup] = useState<Setup | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<"setup" | "verified" | null>(null);

  const apply = useCallback((result: Awaited<ReturnType<typeof call>>) => {
    if (result.ok) { setStatus(result.data as unknown as Status); setProblem(null); }
    else setProblem(result.status === 503 ? "この機能の設定が、まだ完了していません。" : "状態を確認できませんでした。");
  }, []);
  const load = useCallback(async () => { apply(await call("status")); }, [apply]);
  useEffect(() => {
    let active = true;
    void call("status").then(result => { if (active) apply(result); });
    return () => { active = false; };
  }, [apply]);

  async function begin() {
    setBusy(true); setProblem(null);
    const result = await call("begin", {});
    setBusy(false);
    if (result.ok) setSetup(result.data as unknown as Setup);
    else setProblem(result.status === 409 ? "すでに設定済みです。" : "設定を始められませんでした。");
  }
  async function send(path: "confirm" | "verify") {
    setBusy(true); setProblem(null);
    const result = await call(path, { code });
    setBusy(false); setCode("");
    if (result.ok) { setDone(path === "confirm" ? "setup" : "verified"); setSetup(null); void load(); return; }
    const reason = result.data.reason;
    setProblem(reason === "locked" ? "間違いが続いたため、15分間、確認できません。" : reason === "missing" ? "先に設定を始めてください。" : result.status === 400 ? "6けたの数字を入力してください。" : "コードが違います。認証アプリの、新しいコードを入力してください。");
  }

  const groups = setup?.secret.match(/.{1,4}/g)?.join(" ") ?? "";
  return <main style={box}>
    <Link href="/research/account">マイアカウントに戻る</Link>
    <h1>運営者の2段階認証</h1>
    <p>運営者のアカウントを、パスワードに加えて、認証アプリのコードで守ります。</p>
    {problem && <p role="alert" style={{ color: "#f08a93" }}>{problem}</p>}
    {!status && !problem && <p aria-busy="true">確認しています…</p>}

    {done === "setup" && <div style={card}><b>設定しました。</b><p>これから、運営者としてログインしたあと、このページで、コードを入力して確認します(有効は8時間)。</p></div>}
    {done === "verified" && <div style={card}><b>確認しました。</b><p>8時間、運営者として使えます。</p></div>}

    {status && !status.enabled && !setup && <div style={card}>
      <b>まだ設定していません。</b>
      <p>認証アプリ(Google Authenticator、Microsoft Authenticatorなど)を、先にスマホに入れてください。</p>
      <button type="button" style={button} disabled={busy} onClick={() => void begin()}>設定を始める</button>
    </div>}

    {setup && <div style={card}>
      <b>1. 認証アプリに登録します</b>
      <p><a href={setup.uri}>認証アプリで開く</a>(自動で登録できます)</p>
      <p>開けない場合は、認証アプリで「セットアップキーを入力」を選び、次のキーを入力します。種類は「時間ベース」です。</p>
      <p style={{ fontFamily: "ui-monospace, monospace", fontSize: 18, wordBreak: "break-all", userSelect: "all" }}>{groups}</p>
      <p style={{ opacity: .75, fontSize: 13 }}>このキーは、この画面にだけ表示されます。他の人に見せたり、保存したりしないでください。</p>
      <b>2. アプリに出た6けたのコードを入力します</b>
      <input aria-label="6けたのコード" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={event => setCode(event.target.value.replace(/\D/g, ""))} style={field} />
      <button type="button" style={button} disabled={busy || code.length !== 6} onClick={() => void send("confirm")}>設定を完了する</button>
    </div>}

    {status?.enabled && done !== "verified" && <div style={card}>
      <b>{status.verified ? "今回のログインは、確認済みです。" : "コードを入力して、確認します。"}</b>
      {status.locked && <p style={{ color: "#f08a93" }}>間違いが続いたため、しばらく確認できません。</p>}
      <input aria-label="6けたのコード" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={event => setCode(event.target.value.replace(/\D/g, ""))} style={field} />
      <button type="button" style={button} disabled={busy || code.length !== 6 || status.locked} onClick={() => void send("verify")}>確認する</button>
    </div>}

    <p style={{ opacity: .7, fontSize: 13 }}>認証アプリを失くしたときは、画面からは再設定できません。連絡して、手作業でリセットします。</p>
  </main>;
}
