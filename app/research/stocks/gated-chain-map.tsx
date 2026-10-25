"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import type { ChainMapData } from "@/lib/research/chain-map-core";
import type { CompanyNetwork } from "@/lib/research/company-network";
import { FREE_SAMPLE_TICKER } from "@/lib/research/map-access";
import { useMemberDisplay, useOwnerAccount, useResearchOwner } from "../member-display-provider";
import { StockChainMap } from "./stock-chain-map";
import { ChainCompanyNetworkMap } from "./chain-map";
import styles from "./map-lock.module.css";

type Loaded = { chain: ChainMapData } | { graph: CompanyNetwork };
type State = { kind: "loading" } | { kind: "locked" } | { kind: "error" } | { kind: "ready"; data: Loaded };

/** Loads one company's relationship map from the server. Free visitors see a gold lock instead (NVDA is the free sample);
 * PRO members and the owner account see the map. */
export function GatedChainMap({ root, lang }: { root: string; lang: "ja" | "en" }) {
  const plan = useMemberDisplay();
  const ownerAccount = useOwnerAccount();
  const ownerRole = useResearchOwner();
  const [state, setState] = useState<State>({ kind: "loading" });
  const ja = lang === "ja";
  const full = plan === "pro" || ownerAccount || ownerRole;
  useEffect(() => {
    const controller = new AbortController();
    setState(current => current.kind === "ready" ? current : { kind: "loading" });
    (async () => {
      try {
        const response = await fetch(`/api/research/chain-map?ticker=${encodeURIComponent(root)}`, { cache: "no-store", signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15_000)]) });
        if (controller.signal.aborted) return;
        if (response.status === 401 || response.status === 403) { setState({ kind: "locked" }); return; }
        const body = await response.json();
        if (!response.ok || !body.ok) throw Error();
        setState({ kind: "ready", data: body.chain ? { chain: body.chain } : { graph: body.graph } });
      } catch { if (!controller.signal.aborted) setState({ kind: "error" }); }
    })();
    return () => controller.abort();
    // The answer depends on who is looking: ask again when the membership display settles or changes.
  }, [root, plan, ownerAccount, ownerRole]);

  if (state.kind === "loading") return <section className={styles.placeholder} role="status" aria-label={ja ? "連関マップを読み込み中" : "Loading relationship map"}><span /><span /><span /></section>;
  if (state.kind === "error") return <p className={styles.note} role="alert">{ja ? "会員情報を確認できなかったため、連関マップを表示できませんでした。しばらくしてから、もう一度お試しください。" : "The relationship map could not be shown because membership could not be checked. Please try again shortly."}</p>;
  if (state.kind === "locked") return <section className={styles.lock} aria-labelledby={`map-lock-${root}`}>
    <svg className={styles.gem} viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3l7 9-7 9-7-9z" /></svg>
    <h3 id={`map-lock-${root}`}>{ja ? "連関マップはPRO会員限定です" : "Relationship maps are exclusive to PRO"}</h3>
    <p>{ja ? "取引先・提携先・競合とのつながりを、公式資料の引用つきで確認できます。" : "See customers, suppliers, partners and competitors, each backed by a quote from official filings."}</p>
    <div className={styles.actions}>
      {root !== FREE_SAMPLE_TICKER && <Link className={styles.sample} href={`/research/stocks?q=${FREE_SAMPLE_TICKER}`}>{ja ? "NVDAの連関マップを無料で見る" : "Try the NVDA map for free"}</Link>}
      <Link className={styles.cta} href="/research#tech-phase-pro">{ja ? "Tech Phase PROを見る" : "See Tech Phase PRO"}</Link>
    </div>
  </section>;
  const data = state.data;
  return <>
    {"chain" in data ? <StockChainMap data={data.chain} lang={lang} /> : <ChainCompanyNetworkMap graph={data.graph} lang={lang} />}
    {/* Owner, Oct 25: the sample note sits right under the map it describes. */}
    {root === FREE_SAMPLE_TICKER && !full && <p className={styles.badge}><b>{ja ? "無料サンプル" : "FREE SAMPLE"}</b>{ja ? "他の企業の連関マップはPRO会員限定です。" : "Maps of other companies are exclusive to PRO members."} <Link href="/research#tech-phase-pro">{ja ? "PROを見る" : "See PRO"}</Link></p>}
  </>;
}
