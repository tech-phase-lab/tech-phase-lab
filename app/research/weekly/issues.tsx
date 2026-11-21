"use client";
import { useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import ResearchToolShell from "../research-tool-shell";
import { useResearchLanguage } from "../use-research-language";
import { useMemberSettled, useOwnerMode } from "../member-display-provider";
import { useIdentityRefresh } from "../identity-provider";
import WeeklyDraftWriter, { WeeklyDraftWriterSlot } from "./draft-writer";
import { arrangeDrafts, barHeights, cardBadge, formatNumber, groupNotes, moveWidths, scheduleDate, shortDate, signedPercent, type WeeklyCard } from "@/lib/research/weekly-format";
import { companyPhotos } from "@/lib/research/company-photos";
import styles from "./issues.module.css";

type Section = "summary" | "earnings" | "indicators" | "market" | "schedule";
type Part = (
  | { type: "text"; heading: string; body: string; items?: { text: string; kind: "earnings" | "indicators" | "market" }[]; tickers?: string[] }
  | { type: "numbers"; heading: string; cards: WeeklyCard[]; note: string; compare?: { label: string; unit: string; values: { name: string; value: number }[] }[] }
  | { type: "timeline"; heading: string; points: { when: string; event: string; comment: string; tone: "up" | "down" | "flat" }[] }
  | { type: "schedule"; heading: string; items: { date: string; name: string; comment: string }[] }
  | { type: "chart"; heading: string; title: string; unit: string; bars: { label: string; value: number }[]; note: string }
  | { type: "moves"; heading: string; unit: string; bars: { label: string; value: number; group: "index" | "asset" | "stock" }[]; note: string }
  | { type: "highlight"; text: string }) & { section?: Section };
// Group titles shown once, where a run of parts of that kind begins. The takeaways and the schedule carry their own headings.
const SECTION_TITLES: Partial<Record<Section, [string, string]>> = { earnings: ["決算", "Earnings"], indicators: ["経済指標", "Economic indicators"], market: ["市場全体の流れ", "The wider market"] };
export type Issue = { id: string; number: number | null; status: "draft" | "published"; date: string; headline: string; lead: string; parts: Part[]; sources: { title: string; url: string }[]; notes?: string[]; auto?: boolean; createdAt?: string; updatedAt?: string };
type Listed = { number: number; date: string; headline: string };
/** How a text is drawn. The page shows it as written; a sample (PRO feature tour) passes the desk markup (red, marker, bold). */
type Format = (text: string) => ReactNode;
const plain: Format = text => text;
type State = "loading" | "ready" | "signed-out" | "pro-required" | "error";
const two = (n: number) => String(n + 1).padStart(2, "0");

const KIND_LABEL = { earnings: ["決算", "Earnings"], indicators: ["経済指標", "Indicator"], market: ["市場", "Market"] } as const;
function KindIcon({ kind }: { kind: "earnings" | "indicators" | "market" }) {
  const common = { width: 22, height: 22, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": true } as const;
  if (kind === "earnings") return <svg {...common}><path d="M4 20V10M10 20V4M16 20v-7M22 20H2" /></svg>;
  if (kind === "indicators") return <svg {...common}><path d="M4 18a8 8 0 1 1 16 0M12 18l4-6" /><circle cx="12" cy="18" r="1.2" /></svg>;
  return <svg {...common}><path d="M3 17l6-6 4 4 8-8M15 7h6v6" /></svg>;
}
/** The takeaway cards: one short sentence each, with the icon of the material it rests on. Falls back to the plain lines when the owner has edited the text. */
function Takeaways({ part, ja, format }: { part: Extract<Part, { type: "text" }>; ja: boolean; format: Format }) {
  const lines = part.body.split("\n").map(line => line.replace(/^・/, "").trim()).filter(Boolean);
  const items = part.items && part.items.map(item => item.text).join("\n") === lines.join("\n") ? part.items : null;
  if (!items) return <p className={styles.text}>{format(part.body)}</p>;
  return <ol className={styles.takeaways}>{items.map((item, index) => <li key={index} className={styles[`kind_${item.kind}`]}>
    <span className={styles.icon}><KindIcon kind={item.kind} /></span><div><small>{KIND_LABEL[item.kind][ja ? 0 : 1]}</small><p>{format(item.text)}</p></div>
  </li>)}</ol>;
}
/** Result / forecast / previous as short horizontal bars, from zero, one scale per group (the group shares a unit by construction). */
function Compare({ rows, ja }: { rows: NonNullable<Extract<Part, { type: "numbers" }>["compare"]>; ja: boolean }) {
  return <div className={styles.compare} role="group" aria-label={ja ? "予想・前回との比較" : "Versus forecast and previous"}>{rows.map((row, index) => {
    const top = Math.max(...row.values.map(v => Math.abs(v.value)), Number.MIN_VALUE);
    return <figure key={index}><figcaption>{row.label}</figcaption>{row.values.map(v => <div key={v.name} className={`${styles.cmpRow} ${v.name === "結果" || v.name === "発表値" ? styles.cmpMain : ""}`}>
      <span>{ja ? v.name : ({ 結果: "Result", 発表値: "Result", 予想: "Forecast", 前回: "Previous" } as Record<string, string>)[v.name] ?? v.name}</span>
      <i style={{ width: `${Math.max((Math.abs(v.value) / top) * 100, 2)}%` }} /><b>{formatNumber(v.value)}{row.unit}</b>
    </div>)}</figure>;
  })}</div>;
}
function Numbers({ part, ja }: { part: Extract<Part, { type: "numbers" }>; ja: boolean }) {
  return <>
    <div className={styles.cards}>{part.cards.map((card, index) => {
      const badge = cardBadge(card, ja ? "ja" : "en");
      return <article key={index} className={styles.card}>
        <h4>{card.label}</h4>
        {card.value !== null && <p className={styles.big}><b>{formatNumber(card.value, card.digits)}</b>{card.unit && <small>{card.unit}</small>}</p>}
        {card.outlook !== null && <p className={styles.outlook}><span>{card.value !== null ? (ja ? "次四半期の見通し" : "Next-quarter outlook") : (ja ? "見通し" : "Outlook")}</span> <b className={badge ? styles[`val_${badge.tone}`] : undefined}>{formatNumber(card.outlook)}</b>{(card.outlookUnit || card.unit) && <small>{card.outlookUnit || card.unit}</small>}</p>}
        {card.previous !== null && <p className={styles.previous}><span>{ja ? "前回" : "Previous"}</span> {formatNumber(card.previous, card.digits)}{card.unit}</p>}
        {badge && <p className={`${styles.badge} ${styles[badge.tone]}`}><b>{badge.text}</b><span>{badge.caption}</span></p>}
        {card.range && <p className={styles.range}>{card.range}</p>}
      </article>;
    })}</div>
    {part.compare && part.compare.length > 0 && <Compare rows={part.compare} ja={ja} />}
    {part.note && <p className={styles.partNote}>{part.note}</p>}
  </>;
}
function Timeline({ part, format }: { part: Extract<Part, { type: "timeline" }>; format: Format }) {
  return <ol className={styles.timeline}>{part.points.map((point, index) => <li key={index} className={styles[`dot_${point.tone}`]}>
    <time>{point.when}</time><b>{point.event}</b>{point.comment && <p>{format(point.comment)}</p>}
  </li>)}</ol>;
}
function Schedule({ part, ja }: { part: Extract<Part, { type: "schedule" }>; ja: boolean }) {
  const days = part.items.reduce<{ date: string; count: number }[]>((all, item) => { const last = all[all.length - 1]; if (last?.date === item.date) last.count += 1; else all.push({ date: item.date, count: 1 }); return all; }, []);
  return <>
    <ol className={styles.strip} aria-label={ja ? "日付の流れ" : "Days at a glance"}>{days.map(day => { const label = scheduleDate(day.date, ja ? "ja" : "en"); return <li key={day.date}>
      <span className={styles.stripDay}>{label.weekday}</span><i aria-hidden="true">{day.count > 1 ? day.count : ""}</i><b>{label.month} {label.day}</b>
    </li>; })}</ol>
    <ScheduleCards part={part} ja={ja} />
  </>;
}
function ScheduleCards({ part, ja }: { part: Extract<Part, { type: "schedule" }>; ja: boolean }) {
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
/** The week's moves (owner, Nov 21: "文字ばかりで見づらい"): one row per index, market or stock, a bar left of zero for a fall and right
 * for a rise, drawn as inline SVG from the computed figures. The value is written beside each bar, so the picture never stands alone. */
function Moves({ part, ja }: { part: Extract<Part, { type: "moves" }>; ja: boolean }) {
  const widths = moveWidths(part.bars.map(bar => bar.value));
  const row = 30, label = 108, value = 64, half = 150, width = label + half * 2 + value, height = part.bars.length * row + 8, zero = label + half;
  const caption = part.bars.map(bar => `${bar.label} ${signedPercent(bar.value)}`).join("、");
  return <figure className={styles.moves}>
    <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={(ja ? "週間の騰落率: " : "Weekly change: ") + caption} preserveAspectRatio="xMinYMin meet">
      <line x1={zero} x2={zero} y1={0} y2={height} className={styles.movesZero} />
      {part.bars.map((bar, index) => {
        const y = index * row + 6, length = (widths[index] / 100) * half, down = bar.value < 0;
        const x = down ? zero - length : zero;
        return <g key={index} className={styles[`moves_${bar.group}`]}>
          {bar.group !== "stock" && index > 0 && part.bars[index - 1].group !== bar.group && <line x1={0} x2={width} y1={y - 4} y2={y - 4} className={styles.movesRule} />}
          <text x={label - 8} y={y + 14} textAnchor="end" className={styles.movesLabel}>{bar.label}</text>
          <rect x={x} y={y + 2} width={Math.max(length, 1)} height={row - 12} rx={3} className={down ? styles.movesDown : styles.movesUp} />
          <text x={width - 4} y={y + 14} textAnchor="end" className={`${styles.movesValue} ${down ? styles.movesValueDown : styles.movesValueUp}`}>{signedPercent(bar.value)}</text>
        </g>;
      })}
    </svg>
    {part.note && <p className={styles.partNote}>{part.note}</p>}
  </figure>;
}
/** The companies a text is about, side by side: free-license photos only, each credited with its author and license (owner, Nov 15). */
function Photos({ tickers, ja }: { tickers?: string[]; ja: boolean }) {
  const shown = (tickers ?? []).map(ticker => ({ ticker, photo: companyPhotos[ticker] })).filter(item => item.photo);
  if (!shown.length) return null;
  return <div className={styles.photos} data-count={shown.length}>{shown.map(({ ticker, photo }) => <figure key={ticker}>
    {/* eslint-disable-next-line @next/next/no-img-element -- small static files with fixed credits; no image optimisation needed */}
    <img src={photo.url} alt={ja ? photo.caption.ja : photo.caption.en} loading="lazy" decoding="async" />
    <figcaption><b>{ticker}</b><span>{ja ? photo.caption.ja : photo.caption.en}</span>
      <small>{ja ? "写真" : "Photo"}: <a href={photo.source} target="_blank" rel="noreferrer">{photo.credit}</a> / {photo.licenseUrl ? <a href={photo.licenseUrl} target="_blank" rel="noreferrer">{photo.license}</a> : photo.license}{photo.modified ? (ja ? "（一部を切り抜き）" : " (cropped)") : ""}</small></figcaption>
  </figure>)}</div>;
}
function Body({ part, ja, format }: { part: Part; ja: boolean; format: Format }) {
  if (part.type === "text") return part.section === "summary" && part.items ? <Takeaways part={part} ja={ja} format={format} /> : <><Photos tickers={part.tickers} ja={ja} /><p className={`${styles.text} ${styles.lines}`}>{format(part.body)}</p></>;
  if (part.type === "numbers") return <Numbers part={part} ja={ja} />;
  if (part.type === "timeline") return <Timeline part={part} format={format} />;
  if (part.type === "schedule") return <Schedule part={part} ja={ja} />;
  if (part.type === "chart") return <Chart part={part} ja={ja} />;
  if (part.type === "moves") return <Moves part={part} ja={ja} />;
  return null;
}

export function IssueView({ issue, lang = "ja", format = plain }: { issue: Issue; lang?: "ja" | "en"; format?: Format }) {
  const ja = lang === "ja";
  const numbered = issue.parts.reduce<{ part: Part; label: string | null }[]>((all, part) => [...all, { part, label: part.type === "highlight" ? null : two(all.filter(item => item.label).length) }], []);
  return <article className={styles.issue}>
    <section className={styles.hitokoto}>
      <small>{ja ? "今週のひとこと" : "This week's note"} · {shortDate(issue.date)}</small>
      <h2>{issue.headline}</h2>
      <p>{format(issue.lead)}</p>
    </section>
    {numbered.map(({ part, label }, index) => {
      const title = part.section && part.section !== numbered[index - 1]?.part.section ? SECTION_TITLES[part.section] : undefined;
      const group = title && part.type !== "highlight" ? <h2 className={styles.group}>{title[ja ? 0 : 1]}</h2> : null;
      return <div key={index} className={styles.slot}>{group}{part.type === "highlight"
        ? <blockquote className={styles.highlight}>{format(part.text)}</blockquote>
        : <section className={styles.part}><h3><span>{label}</span>{part.heading}</h3><Body part={part} ja={ja} format={format} /></section>}</div>;
    })}
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
function Draft({ draft, onDone, onPreview }: { draft: Issue; onDone: (message: string) => void; onPreview: (issue: Issue) => void }) {
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
  const memo = groupNotes(value.notes);
  const todo = memo.counts.attention + memo.counts.substituted;
  return <details className={styles.draft}>
    <summary><b>{value.headline}</b><small>下書き · {shortDate(value.date)}{todo > 0 ? ` · 要対応 ${todo}件` : ""}</small></summary>
    {/* Owner, Nov 21: 公開 at the top of the draft as well as at the bottom, so a long draft need not be scrolled through to publish. */}
    <div className={styles.actions}><button type="button" disabled={busy} className={styles.publish} onClick={() => void run("publish", "公開しました")}>公開</button></div>
    <p className={todo > 0 ? styles.memoLine : styles.memoLineOk} role="status">{memo.summary}{memo.total > 0 && <> — 詳しくは、いちばん下の「確認メモ」</>}</p>
    {(memo.substituted.headline || memo.substituted.lead) && <p className={styles.fixedMark}>定型文: {[memo.substituted.headline && "見出し", memo.substituted.lead && "導入文"].filter(Boolean).join("・")}はAIの文ではなく、定型文です。書き直してください。</p>}
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
    {memo.total > 0 && <details className={styles.memo}>
      <summary>確認メモ({memo.total}件・読者には見えません)</summary>
      {memo.groups.map(group => <section key={group.kind}><h4>{group.title}</h4><ul>{group.lines.map((line, index) => <li key={index}>{line.text}{line.code && <code>{line.code}</code>}</li>)}</ul></section>)}
    </details>}
    {error && <p role="alert" className={styles.error}>{error}</p>}
    <div className={styles.actions}>
      <button type="button" disabled={busy} onClick={() => void run("draft", "下書きを保存しました")}>保存</button>
      <button type="button" disabled={busy} className={styles.publish} onClick={() => void run("publish", "公開しました")}>公開</button>
      <button type="button" disabled={busy} onClick={() => onPreview(value)}>上で読者の見え方を確認</button>
      <button type="button" disabled={busy} className={styles.danger} onClick={() => void run("delete", "消しました")}>消す</button>
    </div>
  </details>;
}

export type OwnerState = { drafts: Issue[]; autoPublish: boolean; generateEnabled: boolean; generateHour: number; lastGenerated: string | null; generation: { running: boolean; configured: boolean; lastOk: boolean | null; lastError: string } };
/** The owner's view (drafts, settings, generation state) from the route's answer; null when the answer is not one. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- The monitor's answer, checked field by field.
export function ownerState(data: any): OwnerState | null {
  if (!data || !Array.isArray(data.drafts) || !data.settings) return null;
  return { drafts: data.drafts, autoPublish: data.settings.autoPublish === true, generateEnabled: data.settings.generateEnabled === true, generateHour: data.settings.generateHour ?? 8, lastGenerated: data.settings.lastGenerated ?? null, generation: data.generation ?? { running: false, configured: false, lastOk: null, lastError: "" } };
}

/** Save a draft as it stands, then publish it (the same two steps as the draft card's 公開). */
async function publishDraft(value: Issue) {
  const saved = await send("draft", { id: value.id, date: value.date, headline: value.headline, lead: value.lead, parts: value.parts, sources: value.sources, notes: value.notes ?? [] });
  return saved.ok ? send("publish", { id: value.id }) : saved;
}

/** Owner, Nov 21: 「下書きを作る」 sits at the top of the page. The settings (自動公開, the Saturday run) stay at the bottom. */
function GenerateNow({ generation, onWatch }: { generation: OwnerState["generation"]; onWatch: () => void }) {
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  // Owner, Nov 15 (cost): the Saturday run is the only automatic one; another draft costs one more AI request, so it is asked first.
  const makeNow = async () => {
    if (!window.confirm("AIに下書きをもう1つ作らせます。AIの利用料金(1回分)がかかります。よろしいですか?")) return;
    setBusy(true); setError("");
    const result = await send("generate", {});
    setBusy(false);
    if (!result.ok) { setError(result.data?.error === "weekly-not-configured" ? "AIの設定がまだ終わっていません(監視サービスの設定が必要です)" : result.data?.error === "weekly-already-running" ? "いま作っています。しばらくお待ちください。" : "始められませんでした。"); return; }
    onWatch();
  };
  return <div className={`${styles.owner} ${styles.ownerTop}`}>
    <button type="button" disabled={busy || generation.running || !generation.configured} onClick={() => void makeNow()}>{generation.running ? "作っています…(数分かかります)" : "今すぐ下書きを作る"}</button>
    {!generation.configured && <p className={styles.empty}>AIの設定がまだ終わっていません。終わるまで、自動でも手動でも作れません。</p>}
    {generation.lastOk === false && <p role="alert" className={styles.error}>前回は作れませんでした({generation.lastError || "原因不明"})</p>}
    {error && <p role="alert" className={styles.error}>{error}</p>}
  </div>;
}

/** One folded line per old draft (superseded by a newer draft of the same date, or dated on or before the latest published issue). */
function OldDraft({ draft, onChanged }: { draft: Issue; onChanged: (message: string) => void }) {
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const remove = async () => {
    if (!window.confirm(`${shortDate(draft.date)}の古い下書き「${draft.headline}」を消します。よろしいですか?`)) return;
    setBusy(true); setError("");
    const result = await send("delete", { id: draft.id });
    setBusy(false);
    if (!result.ok) setError("消せませんでした。"); else onChanged("古い下書きを消しました");
  };
  return <li><span><b>{draft.headline}</b><small>{shortDate(draft.date)}{draft.createdAt ? ` · ${draft.createdAt.slice(5, 16).replace("-", "/").replace("T", " ")}作成` : ""}</small></span>
    <button type="button" className={styles.danger} disabled={busy} onClick={() => void remove()}>削除</button>
    {error && <p role="alert" className={styles.error}>{error}</p>}</li>;
}

function OwnerPanel({ owner, onChanged, shown, latestPublished, onPreview }: { owner: OwnerState; onChanged: (message: string) => void; shown: Issue | null; latestPublished: string | null; onPreview: (issue: Issue) => void }) {
  const { drafts, autoPublish, generateEnabled, generateHour } = owner;
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const { current, older } = arrangeDrafts(drafts, latestPublished);
  const toggleGenerate = async () => { setBusy(true); const result = await send("settings", { generateEnabled: !generateEnabled }); setBusy(false); if (!result.ok) setError("切り替えられませんでした。"); else onChanged(!generateEnabled ? "毎週の自動作成をオンにしました" : "毎週の自動作成をオフにしました"); };
  const changeHour = async (hour: number) => { setBusy(true); const result = await send("settings", { generateHour: hour }); setBusy(false); if (!result.ok) setError("時刻を変えられませんでした。"); else onChanged("作る時刻を変えました"); };
  const toggle = async () => { setBusy(true); const result = await send("settings", { autoPublish: !autoPublish }); setBusy(false); if (!result.ok) setError("切り替えられませんでした。"); else onChanged(!autoPublish ? "確認なしで公開に切り替えました" : "公開前に確認する設定に戻しました"); };
  const remove = async () => {
    if (!shown || !window.confirm(`第${shown.number}号を消します。読者からも見えなくなります。よろしいですか?`)) return;
    setBusy(true); const result = await send("delete", { id: shown.id }); setBusy(false);
    if (!result.ok) setError("消せませんでした。"); else onChanged("消しました");
  };
  // Owner, Nov 15: the issue is read at the top; below it, the drafts to review (the newest per date only), the old ones folded, then the settings.
  return <section className={styles.owner} aria-label="運営者">
    <h2>運営者 · 下書きの管理</h2>
    <h3 className={styles.ownerHeading}>確認待ちの下書き</h3>
    {current.length === 0 ? <p className={styles.empty}>確認待ちの下書きはありません。</p> : current.map(draft => <Draft key={draft.id} draft={draft} onDone={onChanged} onPreview={onPreview} />)}
    {older.length > 0 && <details className={styles.oldDrafts}>
      <summary>過去の下書き（{older.length}件）</summary>
      <ul>{older.map(draft => <OldDraft key={draft.id} draft={draft} onChanged={onChanged} />)}</ul>
    </details>}
    <h3 className={styles.ownerHeading}>設定</h3>
    <label className={styles.switch}><input type="checkbox" role="switch" checked={autoPublish} disabled={busy} onChange={() => void toggle()} /><span>確認なしで自動公開</span><small>{autoPublish ? "オン: 作られた号はすぐ公開されます" : "オフ: 下書きを確認してから公開します"}</small></label>
    <div className={styles.generate}>
      <label className={styles.switch}><input type="checkbox" role="switch" checked={generateEnabled} disabled={busy} onChange={() => void toggleGenerate()} /><span>毎週土曜に下書きを自動で作る</span><small>{generateEnabled ? `オン: 毎週土曜の${generateHour}時(日本時間)に、下書きを1つ作ります` : "オフ: 自動では作りません"}</small></label>
      <label className={styles.hour}><span>作る時刻(土曜・日本時間)</span><select value={generateHour} disabled={busy} onChange={event => void changeHour(Number(event.target.value))}>{Array.from({ length: 24 }, (_, hour) => <option key={hour} value={hour}>{hour}時</option>)}</select></label>
    </div>
    {shown && <button type="button" className={styles.danger} disabled={busy} onClick={() => void remove()}>この号(第{shown.number}号)を消す</button>}
    {error && <p role="alert" className={styles.error}>{error}</p>}
  </section>;
}

/** The first page of issues as the member's own request returns it, read on the server so the page opens with the issue in place (owner,
 * Nov 21: RIZEL'S DESK opened in about three stages). Only a successful answer is passed; anything else is asked again by the browser. */
export type WeeklyInitial = { issue: Issue | null; latest: number | null; issues: Listed[]; hasMore: boolean };

export default function WeeklyIssues({ initial, initialOwner, standby = false }: { initial?: WeeklyInitial; initialOwner?: OwnerState; standby?: boolean } = {}) {
  const [lang, setLang] = useResearchLanguage();
  const ownerMode = useOwnerMode();
  const settled = useMemberSettled();
  const refreshIdentity = useIdentityRefresh();
  const [state, setState] = useState<State>(initial ? "ready" : "loading");
  const [issue, setIssue] = useState<Issue | null>(initial?.issue ?? null), [latest, setLatest] = useState<number | null>(initial?.latest ?? null);
  const [list, setList] = useState<Listed[]>(initial?.issues ?? []), [hasMore, setHasMore] = useState(initial?.hasMore ?? false), [pick, setPick] = useState(false), [more, setMore] = useState(false);
  // The server's first page is used as it is; the browser asks again only when the reader picks another issue or something changed.
  const seeded = useRef(initial !== undefined);
  const [owner, setOwner] = useState<OwnerState | null>(initialOwner ?? null), [message, setMessage] = useState(""), [revision, setRevision] = useState(0);
  const ownerSeeded = useRef(initialOwner !== undefined);
  // The server read the drafts only for the owner (owner mode, checked there), so until the membership display has started, that decides
  // the view; the page then opens on the owner's final view instead of the member's (owner, Nov 21).
  const ownerView = ownerMode || (!settled && initialOwner !== undefined);
  const [publishing, setPublishing] = useState(false), [publishError, setPublishError] = useState(""), [ownerAsked, setOwnerAsked] = useState(initialOwner !== undefined);
  const [number, setNumber] = useState<number | null>(null), [preview, setPreview] = useState<Issue | null>(null);

  useEffect(() => {
    // The route's loading screen draws this page in its waiting state only; the page itself asks.
    if (standby) return;
    if (seeded.current && number === null && revision === 0) return;
    seeded.current = false;
    let live = true;
    // The sign-in token is renewed first (as on the other desk pages), so a PRO member whose token lapsed in the background is not
    // shown the PRO lock. While the sign-in library is still starting, the page keeps waiting and asks again once it is ready.
    void refreshIdentity().then(() => fetch(`/api/research/weekly-issues?limit=6${number ? `&number=${number}` : ""}`, { cache: "no-store" })).then(async response => {
      if (!live) return;
      if (response.status === 401 || response.status === 403) { setState(response.status === 401 ? "signed-out" : "pro-required"); return; }
      const data = await response.json();
      if (!live) return;
      if (!response.ok || data.ok === false) { setState("error"); return; }
      setIssue(data.issue); setLatest(data.latest); setList(data.issues); setHasMore(data.hasMore); setState("ready");
    }).catch(error => { if (live && !(error instanceof Error && error.message === "identity-loading")) setState("error"); });
    return () => { live = false; };
  }, [number, revision, refreshIdentity, standby]);
  useEffect(() => {
    if (!ownerMode || standby) return;
    if (ownerSeeded.current && revision === 0) return;
    ownerSeeded.current = false;
    void fetch("/api/research/weekly-issues?view=owner", { cache: "no-store" }).then(response => (response.ok ? response.json() : null)).then(data => { const next = ownerState(data); if (next) setOwner(next); }).catch(() => undefined).finally(() => setOwnerAsked(true));
  }, [ownerMode, revision, standby]);
  const olderPage = async () => {
    const last = list[list.length - 1]; if (!last) return;
    const response = await fetch(`/api/research/weekly-issues?limit=6&before=${last.number}`, { cache: "no-store" });
    if (!response.ok) return;
    const data = await response.json(); setList(current => [...current, ...data.issues]); setHasMore(data.hasMore); setMore(true);
  };
  // After "make one now": look again every few seconds (the model takes a few minutes) until it has finished.
  const watch = () => {
    setMessage("下書きを作っています。できたら下の「確認待ち」に出ます(通知も届きます)");
    let rounds = 0;
    const timer = window.setInterval(() => { rounds += 1; setRevision(value => value + 1); if (rounds >= 60) window.clearInterval(timer); }, 6000);
    window.setTimeout(() => window.clearInterval(timer), 6 * 60 * 1000);
  };
  const changed = (text: string) => { setMessage(text); setNumber(null); setPreview(null); setRevision(value => value + 1); };
  const ja = lang === "ja";
  // The owner reads the issue at the top as readers will see it: the draft picked for review, else the published issue, else (nothing published
  // yet) the newest draft to review. Members never see a draft.
  const latestPublished = list.find(item => item.number === latest)?.date ?? (issue && issue.number === latest ? issue.date : null);
  const reviewing = ownerView && owner ? preview ?? (issue ? null : arrangeDrafts(owner.drafts, latestPublished).current[0] ?? null) : null;
  const showPreview = (draft: Issue) => { setPreview(draft); window.scrollTo({ top: 0, behavior: "smooth" }); };
  // Owner, Nov 21: 公開 above and below the draft shown at the top.
  const publishShown = async () => {
    if (!reviewing || publishing) return;
    setPublishing(true); setPublishError("");
    const result = await publishDraft(reviewing);
    setPublishing(false);
    if (!result.ok) { setPublishError("保存できませんでした。文字数や空欄を確認してください。"); return; }
    changed("公開しました");
  };
  const publishButton = reviewing && <button type="button" className={styles.publishShown} disabled={publishing} onClick={() => void publishShown()}>公開</button>;
  return <ResearchToolShell desk compactTitle lang={lang} setLang={setLang} title={ja ? "週刊 Tech Phase PRO" : "PRO Weekly"} description="">
    {ownerView ? <WeeklyDraftWriter onSaved={changed} /> : !settled && <WeeklyDraftWriterSlot />}
    {ownerView && owner && <GenerateNow generation={owner.generation} onWatch={watch} />}
    {(state === "signed-out" || state === "pro-required") && <section className={styles.notice}><h2>{ja ? "PRO会員限定です" : "Available with PRO"}</h2><p>{ja ? "PRO会員になると、週刊 Tech Phase PRO を読めます。" : "PRO members can read PRO Weekly."}</p><Link href="/research/account">{ja ? "ログイン・会員情報" : "Sign in or view plans"}</Link></section>}
    {state === "loading" && <p className={styles.empty}>{ja ? "読み込み中…" : "Loading…"}</p>}
    {state === "error" && <p role="alert" className={styles.error}>{ja ? "いま読み込めません。少し待ってからもう一度開いてください。" : "We couldn't load this right now. Please try again in a moment."}</p>}
    {state === "ready" && <>
      <div className={styles.bar}>
        {issue ? <button type="button" className={styles.picker} aria-expanded={pick} onClick={() => setPick(value => !value)}>{ja ? `第${issue.number}号` : `Issue ${issue.number}`} · {shortDate(issue.date)} <span aria-hidden="true">▼</span></button> : <span />}
      </div>
      {pick && <section className={styles.past} aria-label={ja ? "これまでの号" : "Past issues"}>
        <header><h2>{ja ? "これまでの号" : "Past issues"}</h2><button type="button" aria-label={ja ? "閉じる" : "Close"} onClick={() => setPick(false)}>✕</button></header>
        <ul>{list.map(item => <li key={item.number}><button type="button" aria-current={issue?.number === item.number ? "true" : undefined} onClick={() => { setNumber(item.number); setPreview(null); setPick(false); }}><b>{ja ? `第${item.number}号` : `Issue ${item.number}`}</b><span>{shortDate(item.date)}</span><em>{item.headline}</em>{item.number === latest && <i>{ja ? "最新" : "Latest"}</i>}</button></li>)}</ul>
        {hasMore && <button type="button" className={styles.older} onClick={() => void olderPage()}>{ja ? "さらに前の号を見る" : "See older issues"}</button>}
      </section>}
      {message && <p className={styles.ok} role="status">{message}</p>}
      {reviewing && <div className={styles.previewBar} role="status"><p><b>下書きの確認表示</b>{shortDate(reviewing.date)} · 読者にはまだ見えません</p>{publishButton}{preview && <button type="button" onClick={() => setPreview(null)}>{issue ? "公開中の号に戻す" : "閉じる"}</button>}</div>}
      {publishError && <p role="alert" className={styles.error}>{publishError}</p>}
      {/* The empty message only once the owner's drafts are known too: before, the owner saw it and then jumped to the draft (Nov 21). */}
      {reviewing ? <IssueView issue={reviewing} lang={lang} /> : issue ? <IssueView issue={issue} lang={lang} /> : !(ownerView && !owner && !ownerAsked) && <p className={styles.empty}>{ja ? "まだ公開された号はありません。" : "No issues have been published yet."}</p>}
      {reviewing && <div className={styles.previewBar}>{publishButton}</div>}
    </>}
    {ownerView && owner && <OwnerPanel owner={owner} shown={issue?.number ? issue : null} onChanged={changed} latestPublished={latestPublished} onPreview={showPreview} />}
  </ResearchToolShell>;
}
