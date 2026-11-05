"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import ResearchToolShell from "../research-tool-shell";
import { useResearchLanguage } from "../use-research-language";
import { useOwnerMode } from "../member-display-provider";
import { barHeights, cardBadge, formatNumber, scheduleDate, shortDate, type WeeklyCard } from "@/lib/research/weekly-format";
import styles from "./issues.module.css";

type Part =
  | { type: "text"; heading: string; body: string }
  | { type: "numbers"; heading: string; cards: WeeklyCard[]; note: string }
  | { type: "timeline"; heading: string; points: { when: string; event: string; comment: string; tone: "up" | "down" | "flat" }[] }
  | { type: "schedule"; heading: string; items: { date: string; name: string; comment: string }[] }
  | { type: "chart"; heading: string; title: string; unit: string; bars: { label: string; value: number }[]; note: string }
  | { type: "highlight"; text: string };
export type Issue = { id: string; number: number | null; status: "draft" | "published"; date: string; headline: string; lead: string; parts: Part[]; sources: { title: string; url: string }[]; notes?: string[]; auto?: boolean };
type Listed = { number: number; date: string; headline: string };
type State = "loading" | "ready" | "signed-out" | "pro-required" | "error";
const two = (n: number) => String(n + 1).padStart(2, "0");

function Numbers({ part, ja }: { part: Extract<Part, { type: "numbers" }>; ja: boolean }) {
  return <>
    <div className={styles.cards}>{part.cards.map((card, index) => {
      const badge = cardBadge(card, ja ? "ja" : "en");
      return <article key={index} className={styles.card}>
        <h4>{card.label}</h4>
        {card.value !== null && <p className={styles.big}><b>{formatNumber(card.value)}</b>{card.unit && <small>{card.unit}</small>}</p>}
        {card.outlook !== null && <p className={styles.outlook}><span>{card.value !== null ? (ja ? "次四半期の見通し" : "Next-quarter outlook") : (ja ? "見通し" : "Outlook")}</span> <b className={badge ? styles[`val_${badge.tone}`] : undefined}>{formatNumber(card.outlook)}</b>{(card.outlookUnit || card.unit) && <small>{card.outlookUnit || card.unit}</small>}</p>}
        {card.previous !== null && <p className={styles.previous}><span>{ja ? "前回" : "Previous"}</span> {formatNumber(card.previous)}{card.unit}</p>}
        {badge && <p className={`${styles.badge} ${styles[badge.tone]}`}><b>{badge.text}</b><span>{badge.caption}</span></p>}
        {card.range && <p className={styles.range}>{card.range}</p>}
      </article>;
    })}</div>
    {part.note && <p className={styles.partNote}>{part.note}</p>}
  </>;
}
function Timeline({ part }: { part: Extract<Part, { type: "timeline" }> }) {
  return <ol className={styles.timeline}>{part.points.map((point, index) => <li key={index} className={styles[`dot_${point.tone}`]}>
    <time>{point.when}</time><b>{point.event}</b>{point.comment && <p>{point.comment}</p>}
  </li>)}</ol>;
}
function Schedule({ part, ja }: { part: Extract<Part, { type: "schedule" }>; ja: boolean }) {
  return <div className={styles.schedule}>{part.items.map((item, index) => {
    const day = scheduleDate(item.date, ja ? "ja" : "en");
    return <article key={index}><div className={styles.date}><small>{day.month}</small><b>{day.day}</b><span>{day.weekday}</span></div><div><h4>{item.name}</h4>{item.comment && <p>{item.comment}</p>}</div></article>;
  })}</div>;
}
function Chart({ part, ja }: { part: Extract<Part, { type: "chart" }>; ja: boolean }) {
  const heights = barHeights(part.bars.map(bar => bar.value));
  return <figure className={styles.chart}>
    {part.title && <figcaption>{part.title}</figcaption>}
    <div className={styles.bars} style={{ gridTemplateColumns: `repeat(${Math.max(part.bars.length, 1)}, minmax(0, 1fr))` }}>{part.bars.map((bar, index) => <div key={index}>
      <span className={styles.barValue}>{formatNumber(bar.value)}</span><i style={{ height: `${heights[index]}%` }} /><em>{bar.label}</em>
    </div>)}</div>
    {part.unit && <p className={styles.unit}>{ja ? "単位" : "Unit"}: {part.unit}</p>}
    {part.note && <p className={styles.partNote}>{part.note}</p>}
  </figure>;
}
function Body({ part, ja }: { part: Part; ja: boolean }) {
  if (part.type === "text") return <p className={styles.text}>{part.body}</p>;
  if (part.type === "numbers") return <Numbers part={part} ja={ja} />;
  if (part.type === "timeline") return <Timeline part={part} />;
  if (part.type === "schedule") return <Schedule part={part} ja={ja} />;
  if (part.type === "chart") return <Chart part={part} ja={ja} />;
  return null;
}

export function IssueView({ issue, lang = "ja" }: { issue: Issue; lang?: "ja" | "en" }) {
  const ja = lang === "ja";
  const numbered = issue.parts.reduce<{ part: Part; label: string | null }[]>((all, part) => [...all, { part, label: part.type === "highlight" ? null : two(all.filter(item => item.label).length) }], []);
  return <article className={styles.issue}>
    <section className={styles.hitokoto}>
      <small>{ja ? "今週のひとこと" : "This week's note"} · {shortDate(issue.date)}</small>
      <h2>{issue.headline}</h2>
      <p>{issue.lead}</p>
    </section>
    {numbered.map(({ part, label }, index) => part.type === "highlight"
      ? <blockquote key={index} className={styles.highlight}>{part.text}</blockquote>
      : <section key={index} className={styles.part}><h3><span>{label}</span>{part.heading}</h3><Body part={part} ja={ja} /></section>)}
    {issue.sources.length > 0 && <details className={styles.sources}><summary>{ja ? "出典" : "Sources"}</summary><ul>{issue.sources.map((source, index) => <li key={index}><a href={source.url} target="_blank" rel="noopener noreferrer">{source.title}</a></li>)}</ul></details>}
  </article>;
}

const send = async (action: string, payload: unknown) => {
  const response = await fetch("/api/research/weekly-issues", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, payload }) });
  const data = await response.json().catch(() => ({}));
  return { ok: response.ok && data.ok !== false, data };
};

function Field({ label, value, onChange, long = false }: { label: string; value: string; onChange: (value: string) => void; long?: boolean }) {
  return <label className={styles.field}><span>{label}</span>{long ? <textarea value={value} rows={4} onChange={event => onChange(event.target.value)} /> : <input value={value} onChange={event => onChange(event.target.value)} />}</label>;
}
function Draft({ draft, onDone }: { draft: Issue; onDone: (message: string) => void }) {
  const [value, setValue] = useState<Issue>(draft), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const setPart = (index: number, next: Partial<Part>) => setValue(current => ({ ...current, parts: current.parts.map((part, at) => (at === index ? { ...part, ...next } as Part : part)) }));
  const body = () => ({ id: value.id, date: value.date, headline: value.headline, lead: value.lead, parts: value.parts, sources: value.sources, notes: value.notes ?? [] });
  const run = async (action: "draft" | "publish" | "delete", message: string) => {
    if (action === "delete" && !window.confirm("この下書きを消します。よろしいですか?")) return;
    setBusy(true); setError("");
    const saved = action === "delete" ? { ok: true } : await send("draft", body());
    const result = saved.ok ? (action === "draft" ? saved : await send(action, { id: value.id })) : saved;
    setBusy(false);
    if (!result.ok) { setError("保存できませんでした。文字数や空欄を確認してください。"); return; }
    onDone(message);
  };
  return <details className={styles.draft}>
    <summary><b>{value.headline}</b><small>下書き · {shortDate(value.date)}</small></summary>
    {(value.notes ?? []).length > 0 && <ul className={styles.notes}>{value.notes!.map((note, index) => <li key={index}>{note}</li>)}</ul>}
    <Field label="見出し(今回のひとこと)" value={value.headline} onChange={headline => setValue({ ...value, headline })} />
    <Field label="リード" value={value.lead} long onChange={lead => setValue({ ...value, lead })} />
    {value.parts.map((part, index) => <fieldset key={index} className={styles.editPart}>
      <legend>{index + 1}. {part.type === "highlight" ? "大きな一文" : part.type === "numbers" ? "数字(数字は直せません)" : part.type}</legend>
      {part.type !== "highlight" && <Field label="見出し" value={part.heading} onChange={heading => setPart(index, { heading })} />}
      {part.type === "text" && <Field label="本文" value={part.body} long onChange={body => setPart(index, { body })} />}
      {part.type === "highlight" && <Field label="文" value={part.text} onChange={text => setPart(index, { text })} />}
      {part.type === "numbers" && <Field label="補足" value={part.note} onChange={note => setPart(index, { note })} />}
      {part.type === "chart" && <Field label="補足" value={part.note} onChange={note => setPart(index, { note })} />}
      {part.type === "timeline" && part.points.map((point, at) => <div key={at} className={styles.pair}>
        <Field label="いつ" value={point.when} onChange={when => setPart(index, { points: part.points.map((p, i) => (i === at ? { ...p, when } : p)) })} />
        <Field label="出来事" value={point.event} onChange={event => setPart(index, { points: part.points.map((p, i) => (i === at ? { ...p, event } : p)) })} />
        <Field label="ひとこと" value={point.comment} onChange={comment => setPart(index, { points: part.points.map((p, i) => (i === at ? { ...p, comment } : p)) })} />
      </div>)}
      {part.type === "schedule" && part.items.map((item, at) => <div key={at} className={styles.pair}>
        <Field label={`${item.date} の予定`} value={item.name} onChange={name => setPart(index, { items: part.items.map((p, i) => (i === at ? { ...p, name } : p)) })} />
        <Field label="ひとこと" value={item.comment} onChange={comment => setPart(index, { items: part.items.map((p, i) => (i === at ? { ...p, comment } : p)) })} />
      </div>)}
      <button type="button" className={styles.remove} onClick={() => setValue({ ...value, parts: value.parts.filter((_, at) => at !== index) })}>この部分を外す</button>
    </fieldset>)}
    <IssueView issue={value} />
    {error && <p role="alert" className={styles.error}>{error}</p>}
    <div className={styles.actions}>
      <button type="button" disabled={busy} onClick={() => void run("draft", "下書きを保存しました")}>保存</button>
      <button type="button" disabled={busy} className={styles.publish} onClick={() => void run("publish", "公開しました")}>公開</button>
      <button type="button" disabled={busy} className={styles.danger} onClick={() => void run("delete", "消しました")}>消す</button>
    </div>
  </details>;
}

type OwnerState = { drafts: Issue[]; autoPublish: boolean; generateEnabled: boolean; generateHour: number; lastGenerated: string | null; generation: { running: boolean; configured: boolean; lastOk: boolean | null; lastError: string } };

function OwnerPanel({ owner, onChanged, shown, onWatch }: { owner: OwnerState; onChanged: (message: string) => void; shown: Issue | null; onWatch: () => void }) {
  const { drafts, autoPublish, generateEnabled, generateHour, generation } = owner;
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const toggleGenerate = async () => { setBusy(true); const result = await send("settings", { generateEnabled: !generateEnabled }); setBusy(false); if (!result.ok) setError("切り替えられませんでした。"); else onChanged(!generateEnabled ? "毎週の自動作成をオンにしました" : "毎週の自動作成をオフにしました"); };
  const changeHour = async (hour: number) => { setBusy(true); const result = await send("settings", { generateHour: hour }); setBusy(false); if (!result.ok) setError("時刻を変えられませんでした。"); else onChanged("作る時刻を変えました"); };
  const makeNow = async () => {
    setBusy(true); setError("");
    const result = await send("generate", {});
    setBusy(false);
    if (!result.ok) { setError(result.data?.error === "weekly-not-configured" ? "AIの設定がまだ終わっていません(監視サービスの設定が必要です)。" : result.data?.error === "weekly-already-running" ? "いま作っています。しばらくお待ちください。" : "始められませんでした。"); return; }
    onWatch();
  };
  const toggle = async () => { setBusy(true); const result = await send("settings", { autoPublish: !autoPublish }); setBusy(false); if (!result.ok) setError("切り替えられませんでした。"); else onChanged(!autoPublish ? "確認なしで公開に切り替えました" : "公開前に確認する設定に戻しました"); };
  const remove = async () => {
    if (!shown || !window.confirm(`第${shown.number}号を消します。読者からも見えなくなります。よろしいですか?`)) return;
    setBusy(true); const result = await send("delete", { id: shown.id }); setBusy(false);
    if (!result.ok) setError("消せませんでした。"); else onChanged("消しました");
  };
  return <section className={styles.owner} aria-label="運営者">
    <h2>運営者</h2>
    <label className={styles.switch}><input type="checkbox" role="switch" checked={autoPublish} disabled={busy} onChange={() => void toggle()} /><span>確認なしで自動公開</span><small>{autoPublish ? "オン: 作られた号はすぐ公開されます" : "オフ: 下書きを確認してから公開します"}</small></label>
    <div className={styles.generate}>
      <label className={styles.switch}><input type="checkbox" role="switch" checked={generateEnabled} disabled={busy} onChange={() => void toggleGenerate()} /><span>毎週土曜に下書きを自動で作る</span><small>{generateEnabled ? `オン: 毎週土曜の${generateHour}時(日本時間)に、下書きを1つ作ります` : "オフ: 自動では作りません"}</small></label>
      <label className={styles.hour}><span>作る時刻(土曜・日本時間)</span><select value={generateHour} disabled={busy} onChange={event => void changeHour(Number(event.target.value))}>{Array.from({ length: 24 }, (_, hour) => <option key={hour} value={hour}>{hour}時</option>)}</select></label>
      <button type="button" disabled={busy || generation.running || !generation.configured} onClick={() => void makeNow()}>{generation.running ? "作っています…(数分かかります)" : "今すぐ下書きを作る"}</button>
      {!generation.configured && <p className={styles.empty}>AIの設定がまだ終わっていません。終わるまで、自動でも手動でも作れません。</p>}
      {generation.lastOk === false && <p role="alert" className={styles.error}>前回は作れませんでした({generation.lastError || "原因不明"})。</p>}
    </div>
    {drafts.length === 0 ? <p className={styles.empty}>確認待ちの下書きはありません。</p> : drafts.map(draft => <Draft key={draft.id} draft={draft} onDone={onChanged} />)}
    {shown && <button type="button" className={styles.danger} disabled={busy} onClick={() => void remove()}>この号(第{shown.number}号)を消す</button>}
    {error && <p role="alert" className={styles.error}>{error}</p>}
  </section>;
}

export default function WeeklyIssues() {
  const [lang, setLang] = useResearchLanguage();
  const ownerMode = useOwnerMode();
  const [state, setState] = useState<State>("loading");
  const [issue, setIssue] = useState<Issue | null>(null), [latest, setLatest] = useState<number | null>(null);
  const [list, setList] = useState<Listed[]>([]), [hasMore, setHasMore] = useState(false), [pick, setPick] = useState(false), [more, setMore] = useState(false);
  const [owner, setOwner] = useState<OwnerState | null>(null), [message, setMessage] = useState(""), [revision, setRevision] = useState(0);
  const [number, setNumber] = useState<number | null>(null);

  useEffect(() => {
    let live = true;
    void fetch(`/api/research/weekly-issues?limit=6${number ? `&number=${number}` : ""}`, { cache: "no-store" }).then(async response => {
      if (!live) return;
      if (response.status === 401 || response.status === 403) { setState(response.status === 401 ? "signed-out" : "pro-required"); return; }
      const data = await response.json();
      if (!live) return;
      if (!response.ok || data.ok === false) { setState("error"); return; }
      setIssue(data.issue); setLatest(data.latest); setList(data.issues); setHasMore(data.hasMore); setState("ready");
    }).catch(() => { if (live) setState("error"); });
    return () => { live = false; };
  }, [number, revision]);
  useEffect(() => {
    if (!ownerMode) return;
    void fetch("/api/research/weekly-issues?view=owner", { cache: "no-store" }).then(response => (response.ok ? response.json() : null)).then(data => data && setOwner({ drafts: data.drafts, autoPublish: data.settings.autoPublish, generateEnabled: data.settings.generateEnabled === true, generateHour: data.settings.generateHour ?? 8, lastGenerated: data.settings.lastGenerated ?? null, generation: data.generation ?? { running: false, configured: false, lastOk: null, lastError: "" } })).catch(() => undefined);
  }, [ownerMode, revision]);
  const olderPage = async () => {
    const last = list[list.length - 1]; if (!last) return;
    const response = await fetch(`/api/research/weekly-issues?limit=6&before=${last.number}`, { cache: "no-store" });
    if (!response.ok) return;
    const data = await response.json(); setList(current => [...current, ...data.issues]); setHasMore(data.hasMore); setMore(true);
  };
  // After "make one now": look again every few seconds (the model takes a few minutes) until it has finished.
  const watch = () => {
    setMessage("下書きを作っています。できたら下の「確認待ち」に出ます(通知も届きます)。");
    let rounds = 0;
    const timer = window.setInterval(() => { rounds += 1; setRevision(value => value + 1); if (rounds >= 60) window.clearInterval(timer); }, 6000);
    window.setTimeout(() => window.clearInterval(timer), 6 * 60 * 1000);
  };
  const changed = (text: string) => { setMessage(text); setNumber(null); setRevision(value => value + 1); };
  const ja = lang === "ja";
  return <ResearchToolShell desk compactTitle lang={lang} setLang={setLang} title={ja ? "週刊 Tech Phase PRO" : "PRO Weekly"} description="">
    {(state === "signed-out" || state === "pro-required") && <section className={styles.notice}><h2>{ja ? "PRO会員限定です" : "Available with PRO"}</h2><p>{ja ? "PRO会員になると、週刊 Tech Phase PRO を読めます。" : "PRO members can read PRO Weekly."}</p><Link href="/research/account">{ja ? "ログイン・会員情報" : "Sign in or view plans"}</Link></section>}
    {state === "loading" && <p className={styles.empty}>{ja ? "読み込み中…" : "Loading…"}</p>}
    {state === "error" && <p role="alert" className={styles.error}>{ja ? "いま読み込めません。少し待ってからもう一度開いてください。" : "We couldn't load this right now. Please try again in a moment."}</p>}
    {state === "ready" && <>
      <div className={styles.bar}>
        {issue ? <button type="button" className={styles.picker} aria-expanded={pick} onClick={() => setPick(value => !value)}>{ja ? `第${issue.number}号` : `Issue ${issue.number}`} · {shortDate(issue.date)} <span aria-hidden="true">▼</span></button> : <span />}
      </div>
      {pick && <section className={styles.past} aria-label={ja ? "これまでの号" : "Past issues"}>
        <header><h2>{ja ? "これまでの号" : "Past issues"}</h2><button type="button" aria-label={ja ? "閉じる" : "Close"} onClick={() => setPick(false)}>✕</button></header>
        <ul>{list.map(item => <li key={item.number}><button type="button" aria-current={issue?.number === item.number ? "true" : undefined} onClick={() => { setNumber(item.number); setPick(false); }}><b>{ja ? `第${item.number}号` : `Issue ${item.number}`}</b><span>{shortDate(item.date)}</span><em>{item.headline}</em>{item.number === latest && <i>{ja ? "最新" : "Latest"}</i>}</button></li>)}</ul>
        {hasMore && <button type="button" className={styles.older} onClick={() => void olderPage()}>{ja ? "さらに前の号を見る" : "See older issues"}</button>}
      </section>}
      {message && <p className={styles.ok} role="status">{message}</p>}
      {issue ? <IssueView issue={issue} lang={lang} /> : <p className={styles.empty}>{ja ? "まだ公開された号はありません。" : "No issues have been published yet."}</p>}
    </>}
    {ownerMode && owner && <OwnerPanel owner={owner} shown={issue?.number ? issue : null} onChanged={changed} onWatch={watch} />}
  </ResearchToolShell>;
}
