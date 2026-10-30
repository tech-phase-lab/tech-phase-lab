"use client";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import OwnerGate from "../owner-gate";
import styles from "../account.module.css";

type Row = { name: string; email: string; plan: "PRO" | "FREE"; until: string };
// The owner CSV export (existing API) is the source; quoted cells and doubled quotes are read back as written.
function parseCsv(text: string): string[][] {
  const rows: string[][] = []; let row: string[] = [], cell = "", quoted = false;
  const input = text.replace(/^﻿/, "");
  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    if (quoted) { if (ch === '"') { if (input[i + 1] === '"') { cell += '"'; i++; } else quoted = false; } else cell += ch; }
    else if (ch === '"') quoted = true;
    else if (ch === ",") { row.push(cell); cell = ""; }
    else if (ch === "\n" || ch === "\r") { if (ch === "\r" && input[i + 1] === "\n") i++; row.push(cell); rows.push(row); row = []; cell = ""; }
    else cell += ch;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows.filter(r => r.length > 1);
}
const day = (iso: string, ja: boolean) => { const ms = Date.parse(iso); return Number.isFinite(ms) ? new Intl.DateTimeFormat(ja ? "ja-JP" : "en-US", { timeZone: "Asia/Tokyo", year: "numeric", month: "long", day: "numeric" }).format(ms) : null; };

function Members({ ja }: { ja: boolean }) {
  const t = (a: string, b: string) => ja ? a : b;
  const [rows, setRows] = useState<Row[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<"all" | "PRO" | "FREE">("all");
  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/research/member/export", { cache: "no-store", credentials: "same-origin", signal: AbortSignal.any([controller.signal, AbortSignal.timeout(30_000)]) })
      .then(async response => {
        if (!response.ok) throw new Error("export");
        const table = parseCsv(await response.text());
        const head = table[0] ?? [];
        const at = (name: string) => head.indexOf(name);
        const [mail, nameAt, plan, until] = [at("メールアドレス"), at("表示名"), at("プラン"), at("PRO有効期限")];
        if (mail < 0 || plan < 0) throw new Error("shape");
        if (!controller.signal.aborted) setRows(table.slice(1).map(cells => ({ email: cells[mail] ?? "", name: cells[nameAt] ?? "", plan: cells[plan] === "PRO" ? "PRO" : "FREE", until: cells[until] ?? "" })));
      })
      .catch(() => { if (!controller.signal.aborted) setFailed(true); });
    return () => controller.abort();
  }, [attempt]);
  const shown = useMemo(() => (rows ?? []).filter(r => (filter === "all" || r.plan === filter) && (!query.trim() || `${r.email} ${r.name}`.toLowerCase().includes(query.trim().toLowerCase()))), [rows, filter, query]);
  if (failed) return <div className={styles.stat}><p className={styles.note}>{t("会員の一覧を確認できませんでした。", "Could not load the member list.")}</p>
    <button type="button" className={`${styles.btn} ${styles.gbtO} ${styles.btnS}`} style={{ marginTop: 12 }} onClick={() => { setFailed(false); setRows(null); setAttempt(v => v + 1); }}>{t("再読み込み", "Reload")}</button></div>;
  return <>
    <label className={styles.search}><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#8a7d5c" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="6" /><path d="M20 20l-4-4" /></svg>
      <input value={query} onChange={event => setQuery(event.target.value)} placeholder={t("メールアドレスや表示名で検索", "Search by email or name")} aria-label={t("会員を検索", "Search members")} /></label>
    <div className={styles.chips} role="group" aria-label={t("プランで絞り込み", "Filter by plan")}>{([["all", t("すべて", "All")], ["PRO", "PRO"], ["FREE", "FREE"]] as const).map(([id, label]) => <button key={id} type="button" className={styles.chip} aria-pressed={filter === id} onClick={() => setFilter(id)}>{label}</button>)}</div>
    {rows === null ? <div className={styles.skel} style={{ marginTop: 16 }} aria-busy="true" /> : <>
      <div className={styles.count}>{t(`${shown.length}件`, `${shown.length}`)}</div>
      <div className={styles.list}>{shown.map((r, i) => <div className={styles.item} key={`${r.email}${i}`}>
        <div className={styles.itemTop}><div style={{ flex: 1, minWidth: 0 }}><div className={styles.itemName}>{r.name || t("（表示名なし）", "(no name)")}</div><div className={styles.itemMail}>{r.email}</div></div>
          <span className={`${styles.pt} ${r.plan === "PRO" ? styles.ptPro : styles.ptFree}`}>{r.plan}</span></div>
        <div className={styles.itemSub}>{r.plan === "PRO" ? (r.until && day(r.until, ja) ? `${t("利用期限", "Access until")}　${day(r.until, ja)}` : t("利用期限　確認できません", "Access until  unavailable")) : t("有料契約はありません", "No paid contract")}</div>
      </div>)}{!shown.length && <div className={styles.item}><div className={styles.itemSub}>{t("該当する会員はいません。", "No matching members.")}</div></div>}</div>
    </>}
    <Link className={`${styles.btn} ${styles.gbtO} ${styles.btnS}`} style={{ marginTop: 18 }} href="/api/research/member/export" prefetch={false}>{t("一覧をダウンロード(CSV)", "Download list (CSV)")}</Link>
    <p className={styles.help}>{t("日付はサーバーの記録だけを表示します。取得できないときは「確認できません」と出ます。", "Dates come from server records only; unavailable ones read as unavailable.")}</p>
  </>;
}
export default function MembersScreen() {
  return <OwnerGate kicker="MEMBERS" title="会員・契約">{ja => <Members ja={ja} />}</OwnerGate>;
}
