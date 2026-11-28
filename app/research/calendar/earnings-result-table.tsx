"use client";

import { useEffect, useState, type ReactNode } from "react";
import type { ResultBrief, ResultFact } from "@/lib/research/market-results";
import { earningsTable, type TableRow } from "@/lib/research/earnings-table";
import type { EpsConsensus } from "@/lib/research/x-post-copy";
import { parseAmount } from "@/lib/research/x-post-copy";
import { withPriorOutlook } from "@/lib/research/earnings-guidance";
import { usePriorRelease } from "./use-prior-release";
import calendarStyles from "./event-calendar.module.css";

/** The EPS consensus (Twelve Data) for this report, matched to the EPS basis it was reported on: the adjusted EPS first, then GAAP. */
function useConsensus(ticker: string, at: string, facts: ResultFact[]): { consensus: EpsConsensus | null; key: string | null } {
  const candidates = ["adjusted-eps", "eps"].map(key => ({ key, value: (() => { const f = facts.find(fact => fact.key === key); return f ? parseAmount(f.value) : null; })() }))
    .filter((c): c is { key: string; value: number } => c.value !== null);
  const signature = candidates.map(c => `${c.key}:${c.value}`).join("|");
  const [found, setFound] = useState<{ consensus: EpsConsensus | null; key: string | null; for: string }>({ consensus: null, key: null, for: "" });
  useEffect(() => {
    if (!signature) return;
    const controller = new AbortController();
    (async () => {
      for (const part of signature.split("|")) {
        const [key, value] = part.split(":");
        const query = new URLSearchParams({ ticker, at, eps: value });
        const body = await fetch(`/api/research/earnings-consensus?${query}`, { signal: controller.signal }).then(r => r.ok ? r.json() : null).catch(() => null);
        if (body?.consensus) { setFound({ consensus: body.consensus, key, for: signature }); return; }
      }
    })();
    return () => controller.abort();
  }, [ticker, at, signature]);
  return found.for === signature ? found : { consensus: null, key: null };
}

const yoyTone = (row: TableRow) => row.yoy && /^[+]|黒字|positive|縮小|narrowed/.test(row.yoy.en + row.yoy.ja) ? "up" : row.yoy && /^[−-]|赤字転換|拡大|widened|negative/.test(row.yoy.ja + row.yoy.en) ? "down" : undefined;

/**
 * 項目 / 実績 / 前年比, then 次の見通し (owner, Nov 28, mock 01). A forecast is written small under the actual, in parentheses, only on
 * the figure it belongs to: 「（会社予想 …）」 under revenue (the company's outlook for this quarter from its previous release) and
 * 「（市場予想 …）」 under the EPS whose basis the consensus matched; no verdict word. An outlook shows 「従来予想を上方修正」 (green) /
 * 「下方修正」 (red) / 「据え置き」 when the previous outlook for the same period is held. `xPost` receives what the copy needs.
 */
export default function EarningsResultTable({ ticker, releasedAt, facts, brief = null, loaded = [], lang, xPost, children }: {
  ticker: string; releasedAt: string; facts: ResultFact[]; brief?: ResultBrief | null; loaded?: ResultBrief[]; lang: "ja" | "en";
  xPost?: (copy: { consensus: EpsConsensus | null; consensusKey: string | null; facts: ResultFact[] }) => ReactNode;
  /** Shown between the table and the copy for X: the share price line. */
  children?: ReactNode;
}) {
  const ja = lang === "ja";
  const { consensus, key } = useConsensus(ticker, releasedAt, facts);
  const prior = usePriorRelease(brief, loaded);
  const outlook = withPriorOutlook({ period: brief?.period ?? "", facts }, prior);
  const table = earningsTable(outlook.facts, consensus, key, outlook.revenueGuidance);
  if (!table.results.length && !table.guidance.length) return null;
  return <>
    <table className={calendarStyles.resultTable}>
      <thead><tr><th scope="col">{ja ? "項目" : "Item"}</th><th scope="col">{ja ? "実績" : "Actual"}</th><th scope="col">{ja ? "前年比" : "YoY"}</th></tr></thead>
      <tbody>{table.results.map(row => <tr key={row.key}>
        <th scope="row">{row.label[lang]}</th>
        <td>{row.actual[lang]}{row.note && <small className={calendarStyles.resultNote}>{row.note[lang]}</small>}</td>
        <td data-tone={yoyTone(row)}>{row.yoy?.[lang] ?? "—"}</td>
      </tr>)}</tbody>
      {!!table.guidance.length && <tbody className={calendarStyles.guidance}>
        <tr><th scope="colgroup" colSpan={3}>{ja ? "次の見通し" : "Outlook"}</th></tr>
        {table.guidance.map(row => <tr key={row.key}><th scope="row">{row.label[lang]}</th><td colSpan={2}>{row.actual[lang]}
          {row.note && <small className={calendarStyles.revision} data-tone={row.tone ?? undefined}>{row.note[lang]}</small>}</td></tr>)}
      </tbody>}
    </table>
    {children}
    {xPost?.({ consensus, consensusKey: key, facts: outlook.facts })}
  </>;
}
