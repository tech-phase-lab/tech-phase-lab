"use client";

import { useEffect, useState } from "react";
import type { ResultBrief } from "@/lib/research/market-results";
import { checkedBriefs } from "@/lib/research/earnings-results-history";
import { priorRelease } from "@/lib/research/earnings-guidance";

/** One request per month for the whole page (the stored results of a month are FREE and the same for every visitor). */
const months = new Map<string, Promise<ResultBrief[]>>();
function storedMonth(month: string) {
  let found = months.get(month);
  if (!found) {
    found = fetch(`/api/research/earnings-results?month=${encodeURIComponent(month)}`)
      .then(response => response.ok ? response.json() : null).then(body => checkedBriefs(body?.resultBriefs)).catch(() => []);
    months.set(month, found);
  }
  return found;
}
/** The two to four months before a release: where the previous quarter's release is filed. */
function monthsBefore(at: string) {
  const date = new Date(at);
  return [2, 3, 4].map(back => new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() - back, 1)).toISOString().slice(0, 7));
}

/** The company's previous quarterly release, from the results the page already holds, else from the stored results of the months
 * before (owner, Nov 28: 会社予想 is what the company guided one release earlier). Null while unknown or when not stored. */
export function usePriorRelease(brief: ResultBrief | null, loaded: ResultBrief[]) {
  const held = brief ? priorRelease(brief, loaded) : null;
  const [fetched, setFetched] = useState<{ id: string; prior: ResultBrief | null } | null>(null);
  const id = brief?.id ?? "";
  useEffect(() => {
    if (!brief || held) return;
    let live = true;
    Promise.all(monthsBefore(brief.publishedAt).map(storedMonth)).then(lists => { if (live) setFetched({ id: brief.id, prior: priorRelease(brief, lists.flat()) }); });
    return () => { live = false; };
  }, [brief, held]);
  return held ?? (fetched?.id === id ? fetched.prior : null);
}
