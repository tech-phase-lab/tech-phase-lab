"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { memberCsv } from "@/lib/membership/csv";
import OwnerGate from "../owner-gate";
import { formatDay, getJson, maskEmail } from "../account-data";
import styles from "../account.module.css";

type Contract = { status: "active" | "renewal-stopped" | "none" | null; verification: string; amount: string | null; currency: string | null; nextBillingAt: string | null; accessExpiresAt: string | null };
type Item = { id: string; displayName: string; email: string | null; plan: "free" | "pro" | "owner" | null; contract: Contract };
type Filter = "all" | "pro" | "free" | "stopped";
const MAX_EMPTY_PAGES = 12;

function Members({ ja }: { ja: boolean }) {
  const t = (a: string, b: string) => ja ? a : b;
  const [items, setItems] = useState<Item[]>([]);
  const [next, setNext] = useState<string | null>(null);
  const [state, setState] = useState<"loading" | "ok" | "error" | "denied">("loading");
  const [more, setMore] = useState(false);
  const [query, setQuery] = useState("");
  const [applied, setApplied] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const run = useRef(0);

  // One page is 10 people scanned. The contract filter runs after the lookups, so a page can be empty while more remain:
  // keep walking the cursor (bounded) until something shows or the list ends.
  const load = useCallback(async (cursor: string, reset: boolean, q: string, f: Filter) => {
    const mine = ++run.current;
    if (reset) { setState("loading"); setItems([]); setNext(null); } else setMore(true);
    let at: string | null = cursor, collected: Item[] = [];
    try {
      for (let step = 0; at !== null && step < MAX_EMPTY_PAGES; step++) {
        const params = new URLSearchParams({ plan: f === "stopped" ? "pro" : f, cursor: at });
        if (q) params.set("q", q);
        const page = await getJson(`/api/research/account/admin/members?${params}`);
        if (!Array.isArray(page.items)) throw new Error("shape");
        const rows = (page.items as Item[]).filter(row => f !== "stopped" || row.contract?.status === "renewal-stopped");
        at = typeof page.nextCursor === "string" ? page.nextCursor : null;
        collected = [...collected, ...rows];
        if (collected.length) break;
      }
      if (run.current !== mine) return;
      setItems(prev => reset ? collected : [...prev, ...collected]); setNext(at); setState("ok");
    } catch (e) {
      if (run.current !== mine) return;
      setState((e as { status?: number }).status === 403 ? "denied" : "error");
    } finally { if (run.current === mine) setMore(false); }
  }, []);
  useEffect(() => { void load("0", true, applied, filter); }, [load, applied, filter]);

  const sub = (r: Item) => {
    const c = r.contract;
    if (r.plan === null || !c) return t("契約の状態を確認できませんでした。", "Could not check the contract.");
    if (r.plan === "owner") return t("運営者（有料契約なし）", "Owner (no paid contract)");
    if (c.status === "active") return `${t("次回請求日", "Next billing")}　${formatDay(c.nextBillingAt, ja) ?? t("確認できません", "unavailable")}`;
    if (c.status === "renewal-stopped") return `${t("利用期限", "Access until")}　${formatDay(c.accessExpiresAt, ja) ?? t("確認できません", "unavailable")}`;
    if (c.status === "none") return t("有料契約はありません", "No paid contract");
    return t("契約の状態を確認できませんでした。", "Could not check the contract.");
  };
  const tag = (r: Item) => r.plan === "owner" ? <span className={`${styles.pt} ${styles.ptOwner}`}>OWNER</span>
    : r.plan === null ? <span className={`${styles.pt} ${styles.ptUnknown}`}>{t("確認できません", "Unavailable")}</span>
    : r.contract?.status === "renewal-stopped" ? <span className={`${styles.pt} ${styles.ptStop}`}>{t("自動更新停止済み", "Renewal stopped")}</span>
    : <span className={`${styles.pt} ${r.plan === "pro" ? styles.ptPro : styles.ptFree}`}>{r.plan === "pro" ? "PRO" : "FREE"}</span>;
  // "Download what is shown": the CSV is made from the rows on screen, with the same columns as the server's page export.
  function download() {
    const rows = [["会員ID", "表示名", "メール", "プラン", "契約状況", "金額", "通貨", "次回請求日", "利用期限", "確認状態"],
      ...items.map(r => [r.id, r.displayName, r.plan === "owner" && r.email ? maskEmail(r.email) : r.email, r.plan ?? "確認できません", r.contract?.status ?? "確認できません", r.contract?.amount, r.contract?.currency, r.contract?.nextBillingAt, r.contract?.accessExpiresAt, r.contract?.verification])];
    const url = URL.createObjectURL(new Blob([memberCsv(rows)], { type: "text/csv;charset=utf-8" }));
    const link = Object.assign(document.createElement("a"), { href: url, download: "tech-phase-members-shown.csv" });
    document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  const chips: [Filter, string][] = [["all", t("すべて", "All")], ["pro", "PRO"], ["free", "FREE"], ["stopped", t("自動更新停止済み", "Renewal stopped")]];
  return <>
    <form className={styles.search} onSubmit={event => { event.preventDefault(); setApplied(query.trim()); }}><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#8a7d5c" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="6" /><path d="M20 20l-4-4" /></svg>
      <input value={query} onChange={event => setQuery(event.target.value)} maxLength={120} placeholder={t("メールアドレスや表示名で検索", "Search by email or name")} aria-label={t("会員を検索", "Search members")} enterKeyHint="search" /></form>
    <div className={styles.chips} role="group" aria-label={t("絞り込み", "Filter")}>{chips.map(([id, label]) => <button key={id} type="button" className={styles.chip} aria-pressed={filter === id} onClick={() => setFilter(id)}>{label}</button>)}</div>
    {state === "denied" && <p className={styles.note} style={{ marginTop: 16 }}>{t("この画面は運営者だけが開けます。", "Only the owner can open this page.")}</p>}
    {state === "error" && <div className={styles.stat}><p className={styles.note}>{t("会員の一覧を確認できませんでした。", "Could not load the member list.")}</p>
      <button type="button" className={`${styles.btn} ${styles.gbtO} ${styles.btnS}`} style={{ marginTop: 12 }} onClick={() => void load("0", true, applied, filter)}>{t("再読み込み", "Reload")}</button></div>}
    {state === "loading" && <div className={styles.skel} style={{ marginTop: 16 }} aria-busy="true" />}
    {state === "ok" && <>
      <div className={styles.count}>{t(`${items.length}件を表示中`, `${items.length} shown`)}{next !== null && t("（続きがあります）", " (more available)")}</div>
      <div className={styles.list}>{items.map(r => <div className={styles.item} key={r.id}>
        <div className={styles.itemTop}><div style={{ flex: 1, minWidth: 0 }}><div className={styles.itemName}>{r.displayName || t("（表示名なし）", "(no name)")}</div><div className={styles.itemMail}>{r.plan === "owner" && r.email ? maskEmail(r.email) : r.email}</div></div>{tag(r)}</div>
        <div className={styles.itemSub}>{sub(r)}</div></div>)}
        {!items.length && <div className={styles.item}><div className={styles.itemSub}>{next !== null ? t("このページに該当する会員はいません。「もっと見る」で続きを探せます。", "No match on this page. Use Show more to keep looking.") : t("該当する会員はいません。", "No matching members.")}</div></div>}</div>
      {next !== null && <button type="button" className={`${styles.btn} ${styles.gbtO} ${styles.btnS}`} style={{ marginTop: 14 }} disabled={more} onClick={() => void load(next, false, applied, filter)}>{more ? t("読み込んでいます…", "Loading…") : t("もっと見る", "Show more")}</button>}
      <button type="button" className={`${styles.btn} ${styles.gbtO} ${styles.btnS}`} style={{ marginTop: 12 }} disabled={!items.length} onClick={download}>{t("表示中の一覧をダウンロード(CSV)", "Download shown list (CSV)")}</button>
    </>}
    <p className={styles.help}>{t("日付はサーバーの記録だけを表示します。取得できないときは「確認できません」と出ます。", "Dates come from server records only; unavailable ones read as unavailable.")}</p>
  </>;
}
export default function MembersScreen() {
  return <OwnerGate kicker="MEMBERS" title="会員・契約">{ja => <Members ja={ja} />}</OwnerGate>;
}
