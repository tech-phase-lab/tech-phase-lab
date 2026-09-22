import type { Copy, ResearchEvent } from "./data";
import type { Metric, Source } from "./quality";

export type CompanyComparison = {
  id: string;
  label: Copy;
  previous: Metric;
  current: Metric;
  note: Copy;
  approximate?: boolean;
};
export type Checkpoint = {
  id: string;
  title: Copy;
  status: "change" | "risk" | "pending";
  observation: Copy;
  watch: Copy;
  sourceIds: string[];
};
export type TargetDisclosure = {
  announcedOn: string;
  value: Copy;
  sourceId: string;
};
export type CompanyProfile = {
  ticker: "MU" | "NBIS";
  name: string;
  sector: Copy;
  focus: Copy;
  reviewedOn: string;
  comparisons: CompanyComparison[];
  target: {
    title: Copy;
    period: Copy;
    disclosures: TargetDisclosure[];
    observation: Copy;
    note: Copy;
  };
  checkpoints: Checkpoint[];
  events: ResearchEvent[];
  sources: Source[];
};

const copy = (ja: string, en: string): Copy => ({ ja, en });

// Build company views from the same research records used by the main feed.
// New periods are added explicitly after source review, never inferred from dates.
export function buildCompanyProfiles(records: ResearchEvent[]): CompanyProfile[] {
  function record(id: string) {
    const found = records.find((item) => item.id === id);
    if (!found) throw new Error(`Missing research record: ${id}`);
    return found;
  }
  function metric(event: ResearchEvent, name: string, previous = false) {
    const found = (previous ? event.previous : event.metrics)?.find((item) => item.name === name);
    if (!found) throw new Error(`Missing metric: ${event.id}/${name}`);
    return found;
  }
  function history(ticker: string) {
    return records.filter((item) => item.ticker === ticker)
      .toSorted((a, b) => b.publishedOn.localeCompare(a.publishedOn) || a.id.localeCompare(b.id));
  }
  function sources(ticker: string) {
    return [...new Map(history(ticker).flatMap((event) => event.sources).map((source) => [source.id, source])).values()];
  }
  const q1 = record("nbis-q1-2026");
  const q2 = record("nbis-q2-2026");
  const mu = record("mu-q3-2026");
  const nbisCurrent = metric(q2, "revenue");
  const nbisPrevious = metric(q1, "revenue");
  const muCurrent = metric(mu, "revenue");
  const muPrevious = metric(mu, "revenue", true);
  return [
    {
      ticker: "NBIS", name: "Nebius", sector: copy("AIクラウド", "AI cloud"), reviewedOn: "2026-09-22",
      focus: copy("売上の拡大を、製品・料金・稼働・損益・資金調達まで追う。", "Follow growth through products, pricing, capacity, operations, and funding."),
      events: history("NBIS"), sources: sources("NBIS"),
      comparisons: [
        { id: "revenue", label: copy("グループ売上", "Group revenue"), previous: nbisPrevious, current: nbisCurrent,
          note: copy("対象はグループ全体。前年同期比とは別の、前四半期比較。", "Group scope; this is quarter-on-quarter, not year-on-year.") },
        { id: "arr", label: copy("AIクラウド ARR", "AI cloud ARR"), approximate: true,
          previous: { ...metric(q2, "arr"), value: 1920, period: "Q1 2026", periodEnd: "2026-03-31", sourceId: "nbis-q1-letter" },
          current: metric(q2, "arr"),
          note: copy("最終月売上×12の年換算指標。公表値からの概算で、年間売上実績ではない。", "Final-month revenue × 12; approximate change from published values, not realized annual revenue.") },
        { id: "operating-income", label: copy("グループ営業損益", "Group operating income / loss"),
          previous: { ...nbisPrevious, name: "operating-income", value: -128 },
          current: { ...nbisCurrent, name: "operating-income", value: -175.9 },
          note: copy("営業赤字が拡大。マイナスの比較元には増減率を使わず、金額差を表示。", "Operating losses widened. A negative baseline is compared by amount, not a growth percentage.") },
        { id: "capital-spending", label: copy("設備・無形資産への支出", "Property, equipment & intangible purchases"),
          previous: { ...nbisPrevious, name: "capital-spending", value: 2472.9 },
          current: { ...nbisCurrent, name: "capital-spending", value: 5657.4 },
          note: copy("資金の支出額を正数で表示。支出増を、そのまま利益の改善とは評価しない。", "Cash outlays shown as positive amounts. Higher spending is not itself an earnings improvement.") },
      ],
      target: {
        title: copy("契約電力の会社目標", "Contracted-power guidance"), period: copy("対象：2026年末", "Target: year-end 2026"),
        disclosures: [
          { announcedOn: "2026-05-13", value: copy("4 GW超", "More than 4 GW"), sourceId: "nbis-q1-letter" },
          { announcedOn: "2026-08-12", value: copy("5 GW", "5 GW"), sourceId: "nbis-letter" },
        ],
        observation: copy("年末実績は未収録", "Year-end outcome not included"),
        note: copy("同じ年末目標の変更履歴。「4GW超」は下限表現のため、増加率は計算しない。稼働済み容量とも別。", "Revisions to the same year-end target. The earlier figure is a lower bound, so no percentage is calculated. Neither figure denotes operating capacity."),
      },
      checkpoints: [
        { id: "operations", title: copy("成長は営業損益にもつながったか", "Did growth improve operating results?"), status: "risk",
          observation: copy("売上は増加したが、Q2の営業損失はQ1より拡大。", "Revenue rose, but Q2 operating loss widened from Q1."),
          watch: copy("次の決算で、売上と営業費用の増え方を別々に確認する。", "Compare revenue growth and operating-cost growth separately in the next report."), sourceIds: ["nbis-q1", "nbis-q2"] },
        { id: "funding", title: copy("資金調達と希薄化", "Funding and dilution"), status: "risk",
          observation: copy("Q2のATM売却は1,270万株。未使用枠の存在を売却済みと扱わない。", "Q2 ATM sales: 12.7 million shares. Unused authorization is not completed issuance."),
          watch: copy("追加の売却、発行済株式数、負債、設備投資の開示を照合する。", "Check subsequent equity sales, shares outstanding, debt, and capital expenditure."), sourceIds: ["nbis-letter"] },
        { id: "capacity", title: copy("契約電力から稼働への移行", "From contracted power to operations"), status: "pending",
          observation: copy("収録した5GWは契約電力の年末目標。達成済みの稼働量ではない。", "The 5 GW figure is year-end contracted-power guidance, not achieved operating capacity."),
          watch: copy("通電、GPU導入、顧客利用の開始をサイトごとに確認する。", "Look for site-level energization, GPU installation, and customer use."), sourceIds: ["nbis-letter"] },
        { id: "partnership", title: copy("Palantir提携の収益化", "Monetizing the Palantir partnership"), status: "pending",
          observation: copy("収録した提携発表では、売上寄与額を確認できない。", "The included partnership announcement does not quantify revenue contribution."),
          watch: copy("統合完了と顧客の利用開始、その後の売上開示を追う。", "Track integration, customer adoption, and later revenue disclosures."), sourceIds: ["nbis-palantir"] },
      ],
    },
    {
      ticker: "MU", name: "Micron", sector: copy("半導体・メモリ", "Semiconductors · Memory"), reviewedOn: "2026-09-19",
      focus: copy("利益率の改善と、設備投資後に残るキャッシュを追う。", "Track margins and cash remaining after capital investment."),
      events: history("MU"), sources: sources("MU"),
      comparisons: [
        { id: "revenue", label: copy("売上高", "Revenue"), previous: muPrevious, current: muCurrent,
          note: copy("会社の会計年度によるQ2・Q3の実績比較。", "Actuals for fiscal Q2 and Q3, using the company’s fiscal calendar.") },
        { id: "gross-margin", label: copy("GAAP粗利益率", "GAAP gross margin"), previous: metric(mu, "gross-margin", true), current: metric(mu, "gross-margin"),
          note: copy("差はパーセントポイント。調整後の粗利益率とは混ぜない。", "Change is in percentage points. Do not mix with adjusted gross margin.") },
        { id: "net-capex", label: copy("設備投資（純額）", "Capital expenditures, net"),
          previous: { ...muPrevious, name: "net-capex", value: 5004, basis: "non-GAAP" },
          current: { ...muCurrent, name: "net-capex", value: 7084, basis: "non-GAAP" },
          note: copy("会社定義の純額。補助金等を反映するため、設備取得総額とは異なる。", "Company-defined net measure reflecting incentives and other proceeds; not gross equipment purchases.") },
        { id: "adjusted-fcf", label: copy("調整後フリーキャッシュフロー", "Adjusted free cash flow"),
          previous: { ...muPrevious, name: "adjusted-fcf", value: 6899, basis: "non-GAAP" },
          current: { ...muCurrent, name: "adjusted-fcf", value: 18304, basis: "non-GAAP" },
          note: copy("営業キャッシュフローから純設備投資を差し引く会社定義の指標。", "Company-defined operating cash flow less net capital expenditures.") },
      ],
      target: {
        title: copy("次四半期の売上見通し", "Next-quarter revenue guidance"), period: copy("対象：FQ4 2026", "Target: FQ4 2026"),
        disclosures: [{ announcedOn: "2026-06-24", value: copy("$49–51B", "$49–51B"), sourceId: "mu-q3" }],
        observation: copy("Q4実績は未収録", "Q4 outcome not included"),
        note: copy("会社見通し$50B ± $1Bを範囲で表示。市場予想ではない。Q4実績を収録するまで達成・未達を判定しない。", "Company guidance of $50B ± $1B, shown as a range. Not market consensus; achievement remains unassessed until Q4 actuals are included."),
      },
      checkpoints: [
        { id: "guidance", title: copy("Q4売上は会社見通しに届いたか", "Did Q4 revenue meet guidance?"), status: "pending",
          observation: copy("収録資料はQ3発表まで。Q4の結果はまだ比較していない。", "Coverage ends with the Q3 release; Q4 results have not been compared."),
          watch: copy("Q4実績と$49–51Bの範囲を照合し、途中の見通し修正も確認する。", "Compare Q4 actuals with $49–51B and check for intervening revisions."), sourceIds: ["mu-q3"] },
        { id: "margin", title: copy("利益率の改善は続いたか", "Did margin improvement continue?"), status: "change",
          observation: copy("収録したQ3のGAAP粗利益率は、Q2より改善。", "Included Q3 GAAP gross margin improved from Q2."),
          watch: copy("次の四半期もGAAPで比較。販売価格・製品構成・コストの説明を確認する。", "Use GAAP again next quarter; examine pricing, product mix, and costs."), sourceIds: ["mu-q3"] },
        { id: "cash", title: copy("設備投資後のキャッシュ", "Cash after capital investment"), status: "change",
          observation: copy("純設備投資は増加。調整後FCFも同時に増加した。", "Net capital spending increased, alongside higher adjusted free cash flow."),
          watch: copy("設備投資だけを悪材料とせず、営業キャッシュフローとの関係で追う。", "Assess spending against operating cash generation, rather than labeling it negative in isolation."), sourceIds: ["mu-q3"] },
      ],
    },
  ];
}

export function companyProfileIssues(profile: CompanyProfile): string[] {
  const issues: string[] = [];
  const sourceMap = new Map(profile.sources.map((source) => [source.id, source]));
  const checkSources = (ids: string[]) => {
    if (!ids.length || ids.some((id) => !sourceMap.has(id))) issues.push("unsupported-company-evidence");
  };
  for (const checkpoint of profile.checkpoints) checkSources(checkpoint.sourceIds);
  for (const row of profile.comparisons) {
    for (const metric of [row.current, row.previous]) {
      checkSources([metric.sourceId]);
      if (!Number.isFinite(metric.value)) issues.push("invalid-company-number");
      if (metric.kind === "actual" && metric.periodEnd > (sourceMap.get(metric.sourceId)?.publishedOn ?? "")) issues.push("actual-before-period-end");
    }
  }
  const disclosures = profile.target.disclosures;
  for (let i = 0; i < disclosures.length; i++) {
    const item = disclosures[i];
    checkSources([item.sourceId]);
    if (item.announcedOn !== sourceMap.get(item.sourceId)?.publishedOn) issues.push("target-publication-mismatch");
    if (i > 0 && item.announcedOn <= disclosures[i - 1].announcedOn) issues.push("unordered-target-history");
  }
  if (profile.sources.some((source) => source.publishedOn > profile.reviewedOn)) issues.push("unreviewed-source");
  if (profile.events.some((event) => event.ticker !== profile.ticker)) issues.push("wrong-company-event");
  return [...new Set(issues)];
}
