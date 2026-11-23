"use client";

import { useEffect, useState, type ReactNode } from "react";
import type { ResultFact } from "@/lib/research/market-results";
import { earningsTable, type TableRow } from "@/lib/research/earnings-table";
import type { EpsConsensus } from "@/lib/research/x-post-copy";
import { parseAmount } from "@/lib/research/x-post-copy";
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

const Row = ({ row, lang, versus }: { row: TableRow; lang: "ja" | "en"; versus: boolean }) => <tr>
  <th scope="row">{row.label[lang]}</th>
  <td>{row.actual[lang]}</td>
  <td data-tone={row.yoy && /^[+]|黒字|positive|縮小|narrowed/.test(row.yoy.en + row.yoy.ja) ? "up" : row.yoy && /^[−-]|赤字転換|拡大|widened|negative/.test(row.yoy.ja + row.yoy.en) ? "down" : undefined}>{row.yoy?.[lang] ?? "—"}</td>
  {versus && <td data-tone={row.tone ?? undefined}>{row.versus?.[lang] ?? "—"}</td>}
</tr>;

/** 項目 / 実績 / 前年比 / 市場予想との差, then the company's guidance (owner, Nov 23). `xPost` receives the matched consensus. */
export default function EarningsResultTable({ ticker, releasedAt, facts, lang, xPost }: { ticker: string; releasedAt: string; facts: ResultFact[]; lang: "ja" | "en"; xPost?: (consensus: EpsConsensus | null) => ReactNode }) {
  const ja = lang === "ja";
  const { consensus, key } = useConsensus(ticker, releasedAt, facts);
  const table = earningsTable(facts, consensus, key);
  const versus = table.results.some(row => row.versus);
  if (!table.results.length && !table.guidance.length) return null;
  return <>
    <table className={calendarStyles.resultTable}>
      <thead><tr><th scope="col">{ja ? "項目" : "Item"}</th><th scope="col">{ja ? "実績" : "Actual"}</th><th scope="col">{ja ? "前年比" : "YoY"}</th>{versus && <th scope="col">{ja ? "市場予想との差" : "vs. consensus"}</th>}</tr></thead>
      <tbody>{table.results.map(row => <Row key={row.key} row={row} lang={lang} versus={versus} />)}</tbody>
      {!!table.guidance.length && <tbody className={calendarStyles.guidance}>
        <tr><th scope="colgroup" colSpan={versus ? 4 : 3}>{ja ? "会社予想" : "Company guidance"}</th></tr>
        {table.guidance.map(row => <tr key={row.key}><th scope="row">{row.label[lang]}</th><td colSpan={versus ? 3 : 2}>{row.actual[lang]}</td></tr>)}
      </tbody>}
    </table>
    {xPost?.(consensus)}
  </>;
}
