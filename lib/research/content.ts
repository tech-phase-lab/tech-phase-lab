import type { Metric, Source } from "./quality";
import type { Copy, ResearchEvent } from "./data";
import { muLatest } from './mu-latest.ts';

const copy = (ja: string, en: string): Copy => ({ ja, en });
const nebiusRelease: Source = {
  id: "nbis-q2", publisher: "Nebius IR", title: "Q2 2026 results",
  url: "https://assets.nebius.com/assets/72a8c258-bbb7-4df7-ab9d-8698f6cb88fc/PR.pdf?cache-buster=2026-08-12T11:54:07.336Z",
  publishedOn: "2026-08-12", location: "pp. 1–2, 7 · Results / Cash flow / Operations",
};
const nebiusLetter: Source = {
  id: "nbis-letter", publisher: "Nebius IR", title: "Q2 2026 shareholder letter",
  url: "https://assets.nebius.com/assets/a6ecfd85-a6cb-4967-8ef7-9a25bd261f9c/SHLQ226.pdf?cache-buster=2026-08-12T11:54:46.695Z",
  publishedOn: "2026-08-12", location: "pp. 2, 5, 9–11 · Capacity / Financial update",
};
const micronSource: Source = {
  id: "mu-q3", publisher: "Micron IR", title: "Fiscal Q3 2026 results",
  url: "https://investors.micron.com/news/press-release/2026/Micron-Technology-Inc--Reports-Record-Results-for-the-Third-Quarter-of-Fiscal-2026/default.aspx",
  publishedOn: "2026-06-24", location: "Quarterly results / Cash-flow reconciliation / Outlook",
};
function metric(name: string, value: number, opts: Partial<Metric> = {}): Metric {
  return { name, value, unit: "million", currency: "USD", basis: "GAAP", scope: "Nebius Group", period: "Q2 2026", periodEnd: "2026-06-30", duration: "quarter", kind: "actual", sourceId: "nbis-q2", ...opts };
}

export const events: ResearchEvent[] = [
  {
    id: "nbis-palantir-2026-09-08", ticker: "NBIS", company: "Nebius", category: "cloud", kind: "partnership",
    publishedOn: "2026-09-08", reviewedOn: "2026-09-19",
    title: copy("Palantirとの提携で、企業顧客への接点を拡大", "Palantir partnership opens a new enterprise channel"),
    summary: copy("Nebiusを優先インフラパートナーに指定。実際の収益化には統合と顧客の利用が必要。", "Nebius becomes a preferred infrastructure partner; integration and customer adoption remain ahead."),
    change: copy("Palantir顧客にNebiusの計算基盤を届ける、新たな提携を発表。", "A new partnership targets delivery of Nebius infrastructure to Palantir customers."),
    facts: [
      { text: copy("PalantirはNebiusを、ソブリンAIの優先インフラパートナーに指定。", "Palantir selected Nebius as its preferred sovereign AI infrastructure partner."), sourceIds: ["nbis-palantir"] },
      { text: copy("統合期間を経て、対象顧客がPalantirの環境内でNebiusを利用する計画。", "Eligible customers are expected to access Nebius within Palantir’s environment after integration."), sourceIds: ["nbis-palantir"] },
    ],
    interpretation: copy("企業向けの販路が広がる可能性。提携の発表だけで売上増加を確定させない。", "This could expand enterprise distribution. An announcement alone does not establish incremental revenue."),
    unknown: copy("この発表には契約金額・売上貢献額・利用開始日の具体的な開示がない。", "The announcement does not specify contract value, revenue contribution, or a launch date."),
    next: copy("統合完了、顧客の利用開始、収益への寄与が開示されるか。", "Watch for integration completion, customer adoption, and disclosed revenue contribution."),
    sources: [{ id: "nbis-palantir", publisher: "Nebius Newsroom", title: "Palantir–Nebius partnership", publishedOn: "2026-09-08", location: "Announcement · opening paragraphs", url: "https://nebius.com/newsroom/palantir-and-nebius-partner-to-deliver-a-complete-sovereign-ai-stack-to-palantir-customers" }],
    metrics: [],
  },
  {
    id: "nbis-q2-2026", ticker: "NBIS", company: "Nebius", category: "cloud", kind: "earnings",
    publishedOn: "2026-08-12", reviewedOn: "2026-09-19",
    title: copy("四半期売上とARRを分けて、成長を確認する", "Separate quarterly revenue from annualized run-rate"),
    summary: copy("グループ売上は$582.3M。AIクラウドのARR $3.0Bとは対象・期間・定義が異なる。", "Group revenue was $582.3M. AI cloud ARR of $3.0B has a different scope and definition."),
    change: copy("同じ四半期のグループ売上を前年と比較。ARRを四半期売上として扱わない。", "Compare group revenue with the same quarter a year earlier; do not treat ARR as quarterly revenue."),
    facts: [
      { text: copy("2026年Q2のグループ売上$582.3M、前年同期$105.1M。", "Q2 2026 group revenue was $582.3M versus $105.1M a year earlier."), sourceIds: ["nbis-q2"] },
      { text: copy("グループの継続事業純損失は$190.4M。", "Group net loss from continuing operations was $190.4M."), sourceIds: ["nbis-q2"] },
      { text: copy("AIクラウドARRは四半期最終月の売上を12倍した指標。", "AI cloud ARR annualizes the final month of the quarter by multiplying revenue by 12."), sourceIds: ["nbis-letter"] },
    ],
    interpretation: copy("売上拡大と損益は別々に追う。ARRは年間の売上実績ではない。", "Track growth and profitability separately. ARR is not realized annual revenue."),
    unknown: copy("この画面では市場予想と比較していないため、「予想超え」とは判定しない。", "No consensus comparison is included, so this is not labeled an earnings beat."),
    next: copy("売上拡大に伴い、継続事業の損失が縮小するか。", "Watch whether losses from continuing operations narrow as revenue grows."),
    sources: [nebiusRelease, nebiusLetter],
    metrics: [metric("revenue", 582.3), metric("arr", 3000, { scope: "Nebius AI cloud", basis: "operating", duration: "point-in-time", kind: "run-rate", sourceId: "nbis-letter" }), metric("net-income-continuing", -190.4)],
    previous: [metric("revenue", 105.1, { period: "Q2 2025", periodEnd: "2025-06-30" })],
  },
  {
    id: "nbis-capacity-2026", ticker: "NBIS", company: "Nebius", category: "cloud", kind: "capacity",
    publishedOn: "2026-08-12", reviewedOn: "2026-09-19",
    title: copy("契約電力の目標5GW。稼働済み容量とは区別", "5 GW contracted-power target is not operating capacity"),
    summary: copy("年末目標は契約電力。稼働開始と売上計上までを追う必要がある。", "The year-end target concerns contracted power; commissioning and revenue conversion still matter."),
    change: copy("2026年末の契約電力目標を5GWに引き上げ。", "The year-end 2026 contracted-power target increased to 5 GW."),
    facts: [
      { text: copy("会社は年末の契約電力目標を5GWとした。", "Management set a 5 GW contracted-power target for year-end."), sourceIds: ["nbis-letter"] },
    ],
    interpretation: copy("電力確保の進展は供給拡大の前提。5GWすべてが稼働しているとは読めない。", "Secured power supports expansion, but does not mean 5 GW is already operational."),
    unknown: copy("契約電力の数値だけでは稼働率や実際の売上を算定できない。", "Contracted power alone does not establish utilization or realized revenue."),
    next: copy("建設・通電・GPU導入・顧客利用の進捗を確認。", "Track construction, energization, GPU installation, and customer usage."),
    sources: [nebiusLetter],
    metrics: [metric("contracted-power", 5, { unit: "GW", currency: null, scope: "Nebius AI cloud", basis: "operating", period: "YE 2026", periodEnd: "2026-12-31", duration: "point-in-time", kind: "guidance", sourceId: "nbis-letter" })],
  },
  {
    id: "mu-q3-2026", ticker: "MU", company: "Micron", category: "memory", kind: "earnings",
    publishedOn: "2026-06-24", reviewedOn: "2026-09-27",
    analysisAsOf: "2026-09-27",
    valuation: { price: 1082.28, priceDate: "2026-09-25", eps: 159.12, fiscalYear: "FY2027", sourceId: "mu-estimates" },
    title: copy("MU決算結果｜売上は前四半期比73.7%増、粗利率84.6%。メモリ好況は続くか", "MU earnings: revenue up 73.7% QoQ, gross margin 84.6%. Can the memory boom last?"),
    summary: copy("低PERの理由を、HBM・汎用DRAM・NANDの需給と利益予想から分解。長期契約で変わる部分と、残る循環リスクを読む。", "Connect valuation to HBM, conventional DRAM and NAND supply dynamics. Separate contract protection from the cycle risk that remains."),
    change: copy("論点は好決算かどうかから、FY2027の利益をその後も維持できるかへ。9月25日の株価と予想利益では約6.8倍だが、割安の判断には利益の持続性が必要。", "The question moves from strong results to whether FY2027 earnings can endure. The September 25 price implies about 6.8× that year’s forecast EPS; cheapness depends on durability."),
    facts: [
      { text: copy("Q3実績：売上414.56億ドル、GAAP粗利益率84.6％。上の比較はQ2→Q3の過去実績。", "Q3 actuals: $41.456B revenue and 84.6% GAAP gross margin. The comparison above is historical Q2 → Q3."), sourceIds: ["mu-q3"] },
      { text: copy("9月25日終値1,082.28ドル。Stock Analysis掲載の調整後EPS予想はFY2026が73.57ドル、FY2027が159.12ドル。会社予想ではなく外部集計。", "September 25 close: $1,082.28. Stock Analysis adjusted EPS estimates: FY2026 $73.57; FY2027 $159.12. These are aggregated forecasts, not company guidance."), sourceIds: ["mu-estimates"] },
      { text: copy("TrendForceは2027年のDRAM供給不足継続を予想する一方、NANDは同年後半に供給が緩むと予想。メモリ全体を一括りにはできない。", "TrendForce projects continued DRAM tightness in 2027 but easing NAND supply in its second half. The two markets need separate treatment."), sourceIds: ["memory-cycle"] },
      { text: copy("HBMはウェハー投入量に対するビット供給量が小さい。TrendForceの2027年推計では、DRAM全体の投入量の30％に対してビット供給は13％。", "TrendForce estimates HBM will use 30% of DRAM wafer input but supply 13% of DRAM bits in 2027."), sourceIds: ["hbm-capacity"] },
    ],
    interpretation: copy("Tech Phaseの見立ては、足元のDRAM価格を支える力は強い一方、株価評価の勝負は「最高益」から「次の調整でも残る利益」へ移る、というものです。HBMの拡大は汎用DRAMの供給も圧迫するため、AI向けだけの成長として読むと影響を過小評価します。ただしNANDまで同じ強さが続くとは置かず、DRAM・NANDの採算を分けて考えます。", "Our thesis is that DRAM pricing support remains substantial, while valuation increasingly depends on earnings retained through the next correction. HBM expansion can also constrain conventional DRAM supply, extending the impact beyond AI-specific products. We would not assume NAND shares the same durability."),
    analysis: [
      { heading: copy("メモリサイクル｜増産の発表と、供給増の時期は違う", "The cycle | Announced capacity is not available supply"), body: copy("TrendForceは、新工場の本格的な供給寄与が2028年にずれ込むとみています［3］。ここから読むべきなのは、設備投資が増えたという事実だけで、直ちに価格下落へ結びつけないことです。一方、株価は供給が実際に余る前から反応し得ます。次の転換点は「工場完成」そのものより、顧客が在庫を積み増す必要を失い、追加発注を弱める時期。クラウド企業の投資計画、メモリ調達、メーカー在庫が同じ方向に弱まるかを確認します。", "TrendForce places meaningful new-fab output contributions in 2028 [3]. Higher capital spending therefore need not cause an immediate price reversal. Shares can nevertheless react before physical oversupply arrives. The turning point to watch is customers losing the need to build inventory and reducing incremental orders. Cloud spending plans, memory procurement and supplier inventories weakening together would be more informative than a factory-opening headline.") },
      { heading: copy("HBM｜AI向けが増えるほど、汎用品も不足し得る", "HBM | AI demand can tighten conventional supply too"), body: copy("HBMは同じ容量を作るのに多くの製造資源を使います。投入比率30％・供給比率13％という差は、その負担を示しますが、MU単独の製造効率ではありません［4］。HBMを優先すると汎用DRAMに回せる余力が減るため、「HBMは好調、汎用品は無関係」ではありません。ただし、HBMの売上構成比が上がれば必ず利益率が上がる、とも限りません。製品価格、良品率、後工程の負担を含め、ウェハー当たりの利益で比較する必要があります。", "HBM consumes disproportionate manufacturing resources. The input/output gap is an industry estimate, not Micron’s own yield [4]. Prioritizing HBM can constrain conventional DRAM, linking their pricing cycles. But a higher HBM revenue mix does not automatically raise margins. Relative selling prices, manufacturing yields and packaging costs determine profit per wafer.") },
      { heading: copy("NAND｜短期の値上がりと、中期の供給緩和は両立する", "NAND | Near-term strength can precede a softer cycle"), body: copy("9月21日のTrendForce公表では、企業向けSSD価格は2026年Q4も上昇方向です［5］。これは2027年後半の供給緩和予想と矛盾しません。時間軸が違うからです。MUの利益を予想する際は、足元の値上げを翌年までそのまま伸ばさず、DRAMが強くてもNANDの利益率が先に下がる組み合わせを置くべきです。全社利益率だけだと、この先行変化を見落とします。", "TrendForce’s September 21 update still points to rising enterprise SSD prices in Q4 2026 [5]. That can coexist with easing supply in late 2027. A Micron model should allow NAND margins to turn before DRAM, rather than extrapolate current price gains across both segments. Consolidated margins can conceal that early divergence.") },
      { heading: copy("予想PER｜6.8倍の分母は、すでに大幅増益を含む", "Forward P/E | The denominator already assumes major growth"), body: copy("同じ株価でも、FY2026予想EPSでは14.7倍、FY2027では6.8倍です［6］。差の中心は、利益予想が約2.16倍になること。年度を省いて「PERは一桁だから割安」とは読めません。メモリ企業では利益の山に近づくほどPERが低く見えることがあります。今回の長期契約がその山を高原に変えられるかが本題で、契約の下限価格だけではコスト上昇や契約外の市況下落まで消せません。下表では利益予想が20％・40％下がった場合を比較します。これは値下がり予想ではなく、評価がどれだけ利益に依存するかを見る試算です。", "The same share price implies 14.7× FY2026 EPS but 6.8× FY2027 EPS [6], because forecast earnings roughly double. Omitting the fiscal year hides that assumption. Cyclical earnings near a peak can create a deceptively low P/E. The key question is whether contracts turn a peak into a plateau; floors do not eliminate cost inflation or uncontracted price exposure. The table stresses EPS by 20% and 40%; these are sensitivity assumptions, not predictions.") },
      { heading: copy("アナリスト評価｜目標株価の差を、利益と倍率に分解する", "Analyst targets | Separate earnings assumptions from multiples"), body: copy("9月23日の掲載値はUBSが1,625ドル、Wells Fargoが1,400ドルで、後者は1,525ドルから引き下げています［6］。単純平均より、評価が割れる理由を追うべきです。共通のFY2027予想EPS159.12ドルで割ると約10.2倍と8.8倍。ただしこれはTech Phaseの比較計算で、各社が実際に使った利益予想や倍率ではありません。例えば株価1,500ドルには、PER10倍ならEPS150ドル、8倍なら187.50ドルが必要です。利益が達成されても評価倍率が低いままなら、目標価格に届かない構造が見えます。", "Published September 23 targets show UBS at $1,625 and Wells Fargo at $1,400, reduced from $1,525 [6]. Dividing by the same $159.12 EPS gives 10.2× and 8.8×. These are our comparison ratios, not the firms’ actual models. A $1,500 price requires $150 EPS at 10×, or $187.50 at 8×. Meeting an earnings forecast alone may not deliver a target price if the market retains a lower multiple.") },
    ],
    scenarios: [
      { heading: copy("基本線｜DRAM優位は続くが、低PERだけでは決めない", "Base | DRAM support persists; low P/E is insufficient"), body: copy("需給が締まり、利益予想が維持される間は収益の持続性を検証する段階。短期増収率より、2027年の価格交渉と製品別の採算を重視する。", "With tight supply and stable estimates, test durability through 2027 pricing negotiations and segment economics rather than headline growth.") },
      { heading: copy("上振れ｜利益の上方修正と、持続性の評価が重なる", "Upside | Better earnings and greater confidence in duration"), body: copy("契約条件・数量・良品率が改善し、翌期以降の利益予想も上がる場合。EPS上昇とPER上昇が同時に起きる余地がある。ただし両方の上昇を前提にはしない。", "Improving contracts, volume and yields lift later-year estimates. Both EPS and the multiple could rise, but the case must not depend on both doing so.") },
      { heading: copy("見直し｜価格より先に、利益予想の修正方向を見る", "Reassessment | Watch estimate revisions before reported results"), body: copy("NANDの採算悪化にDRAMの価格交渉の弱さが重なり、翌期EPSが継続的に下方修正される場合。過去最高益や低い表示PERを根拠に強気を据え置かない。", "NAND weakness spreads to DRAM negotiations and next-year EPS is repeatedly revised down. Record trailing earnings or a low displayed P/E would not justify an unchanged thesis.") },
    ],
    unknown: copy("アナリスト各社の有料レポート全文や内部モデルは未確認。目標株価の理由を推測で補わず、公開値と当方の計算を区別しています。予想EPS・株価は9月25日の固定値で、自動更新ではありません。", "Full analyst reports and proprietary models were not reviewed. Published targets and our calculations are separate. Prices and estimates are fixed September 25 observations, not a live feed."),
    next: copy("9月30日の決算：実績に加え、次期見通しがFY2027の利益予想を押し上げる内容か。\n価格と数量：DRAM・NANDそれぞれの単価、出荷、利益率。HBMの比率だけで判断しない。\n契約と供給：2027年の価格条件、製造効率、新工場の供給時期。価格上限と下限の対象範囲を確認。\n株価評価：同じ年度・同じ調整後EPSで予想PERを更新し、EPS修正と倍率変化を分けて記録。", "September 30 results: test whether the next outlook supports upward FY2027 estimate revisions.\nPrice and volume: separate DRAM and NAND pricing, shipments and margins; do not rely on HBM mix alone.\nContracts and supply: track 2027 pricing terms, yields and capacity timing, including ceiling/floor coverage.\nValuation: retain the same fiscal year and adjusted-EPS basis; record earnings revisions separately from multiple changes."),
    sources: [micronSource, {"id": "mu-remarks", "publisher": "Micron IR", "title": "Fiscal Q3 2026 prepared remarks", "url": "https://s25.q4cdn.com/621799436/files/doc_financials/2026/q3/Q3-FY26-Prepared-Remarks.pdf", "publishedOn": "2026-06-24", "location": "Contracts / Pricing / Manufacturing costs"}, {"id": "memory-cycle", "publisher": "TrendForce", "title": "2027 DRAM and NAND supply outlook", "url": "https://www.trendforce.com/presscenter/news/20260730-13158.html", "publishedOn": "2026-07-30", "location": "Public industry forecast; not a Micron forecast"}, {"id": "hbm-capacity", "publisher": "TrendForce", "title": "HBM wafer allocation and pricing", "url": "https://www.trendforce.com/presscenter/news/20260602-13074.html", "publishedOn": "2026-06-02", "location": "Public industry estimates for wafer input and bit supply"}, {"id": "nand-update", "publisher": "TrendForce", "title": "Q4 2026 enterprise SSD pricing outlook", "url": "https://www.trendforce.com/presscenter/news/20260921-13246.html", "publishedOn": "2026-09-21", "location": "Public near-term pricing outlook"}, {"id": "mu-estimates", "publisher": "Stock Analysis · S&P Global / TipRanks data", "title": "MU forecasts and analyst targets — September 25 snapshot", "url": "https://stockanalysis.com/stocks/mu/forecast/", "publishedOn": "2026-09-25", "location": "Adjusted EPS forecasts / US close / September 23 targets; external aggregation"}],
    metrics: [
      metric("revenue", 41456, { scope: "Micron", period: "FQ3 2026", periodEnd: "2026-05-28", sourceId: "mu-q3" }),
      metric("gross-margin", 84.6, { unit: "percent", currency: null, scope: "Micron", period: "FQ3 2026", periodEnd: "2026-05-28", sourceId: "mu-q3" }),
    ],
    previous: [
      metric("revenue", 23860, { scope: "Micron", period: "FQ2 2026", periodEnd: "2026-02-26", sourceId: "mu-q3" }),
      metric("gross-margin", 74.4, { unit: "percent", currency: null, scope: "Micron", period: "FQ2 2026", periodEnd: "2026-02-26", sourceId: "mu-q3" }),
    ],
  },
  {
    id: "nbis-funding-q2-2026", ticker: "NBIS", company: "Nebius", category: "cloud", kind: "financing",
    publishedOn: "2026-08-12", reviewedOn: "2026-09-19",
    title: copy("資金調達を、売上成長と分けて追う", "Track equity funding alongside growth"),
    summary: copy("Q2にATMプログラムで1,270万株を売却。調達資金と1株当たりの持分への影響を確認する。", "12.7 million shares were sold through the ATM program in Q2. Track both funding and ownership dilution."),
    change: copy("四半期中の株式売却による資金調達を開示。", "The company disclosed equity funding during the quarter."),
    facts: [
      { text: copy("6月末までにATMで1,270万株を売却し、総額約$2.8Bを調達。", "Through June 30, ATM sales totaled 12.7 million shares and approximately $2.8B in gross proceeds."), sourceIds: ["nbis-letter"] },
      { text: copy("同プログラムで売却可能な残りの枠は1,230万株。", "The program had capacity for a further 12.3 million shares."), sourceIds: ["nbis-letter"] },
    ],
    interpretation: copy("設備拡張の資金確保と、既存株主の持分希薄化を同時に評価する。", "Assess expansion funding and dilution together."),
    unknown: copy("残りの枠が今後すべて使われるか、この資料では確定しない。", "The remaining authorization does not establish future sales."),
    next: copy("追加の株式売却、発行済株式数、設備投資額を次の開示で照合。", "Reconcile subsequent share sales, shares outstanding, and capital spending."),
    sources: [nebiusLetter], metrics: [],
  },
  {
    id: "nbis-q1-2026", ticker: "NBIS", company: "Nebius", category: "cloud", kind: "earnings",
    publishedOn: "2026-05-13", reviewedOn: "2026-09-19",
    title: copy("Q1を比較の起点にする", "Establish the Q1 comparison baseline"),
    summary: copy("売上$399.0M、営業損失$128.0M。投資評価益を含む純利益とは分けて確認。", "Revenue was $399.0M and operating loss $128.0M. Distinguish operations from investment revaluation gains."),
    change: copy("次の決算と照合するため、Q1の実績を記録。", "Record the Q1 actuals for comparison with the next release."),
    facts: [
      { text: copy("グループ売上$399.0M、営業損失$128.0M。", "Group revenue was $399.0M and operating loss was $128.0M."), sourceIds: ["nbis-q1"] },
      { text: copy("継続事業純利益$621.2Mには、投資有価証券の評価益$780.6Mが含まれる。", "Net income from continuing operations of $621.2M included $780.6M in investment revaluation gains."), sourceIds: ["nbis-q1"] },
    ],
    interpretation: copy("純利益の黒字だけで本業の黒字化と判断しない。", "Positive net income alone does not establish operating profitability."),
    unknown: copy("投資評価益が次の四半期も続くとは限らない。", "Investment gains may not recur in the next quarter."),
    next: copy("Q2の売上、営業損失、資金需要を同じ定義で確認。", "Compare Q2 revenue, operating loss, and funding needs on the same basis."),
    sources: [
      { id: "nbis-q1", publisher: "Nebius IR", title: "Q1 2026 results", publishedOn: "2026-05-13", location: "pp. 1–2, 7 · Results / Cash flow / Operations", url: "https://assets.nebius.com/assets/0de223a2-f519-408d-8c7e-04f2fef342a9/Financial%20results_Q1%202026.pdf?cache-buster=2026-05-13T10:36:29.509Z" },
      { id: "nbis-q1-letter", publisher: "Nebius IR", title: "Q1 2026 shareholder letter", publishedOn: "2026-05-13", location: "pp. 3, 6, 9 · Capacity / ARR", url: "https://assets.nebius.com/assets/aa1bc2e6-df83-40cd-a6a2-95e7cda3d16c/Nebius%20SHL_Q1%202026.pdf?cache-buster=2026-05-13T14:00:35.352Z" },
    ],
    metrics: [metric("revenue", 399, { period: "Q1 2026", periodEnd: "2026-03-31", sourceId: "nbis-q1" })],
  },
  {
    id: "nbis-spot-pricing-2026-09-22", ticker: "NBIS", company: "Nebius", category: "cloud", kind: "product",
    publishedOn: "2026-09-22", reviewedOn: "2026-09-22",
    title: copy("プリエンプティブルVMに、需要連動のスポット価格を導入", "Nebius introduces demand-based spot pricing for preemptible VMs"),
    summary: copy("10月8日からGPU種類・地域・空き容量・需要に応じて価格を動的計算。利用者は上限価格を設定するか、スポット価格へ追従できます。", "From October 8, prices will vary by GPU type, region, available capacity, and demand. Customers can set a maximum price or follow the spot price."),
    change: copy("固定割引ではなく、空き容量と需要を反映する価格方式へ変更。", "Pricing moves from a fixed discount to a model tied to available capacity and demand."),
    facts: [
      { text: copy("NebiusはプリエンプティブルVMへスポット価格を導入すると公式発表。", "Nebius officially announced spot pricing for preemptible VMs."), sourceIds: ["nbis-spot-x"] },
      { text: copy("価格はGPU種類とリージョンごとに、利用可能な容量と需要をもとに動的に計算。", "Prices will be calculated dynamically by GPU type and region using available capacity and demand."), sourceIds: ["nbis-spot-x"] },
      { text: copy("利用者は価格上限を設定するか、その時点のスポット価格へ追従できる。", "Customers can set a maximum spot price or follow the current spot price."), sourceIds: ["nbis-spot-docs"] },
    ],
    interpretation: copy("余剰GPU容量の稼働率を上げ、価格に敏感な学習・推論需要を取り込む施策です。一方、低価格利用の増加が売上と利益率へどう効くかは、稼働率と平均単価を分けて確認する必要があります。", "The model can improve utilization of spare GPU capacity and attract price-sensitive training and inference workloads. Revenue and margin effects still depend on utilization and realized pricing."),
    unknown: copy("開始時点のGPU別スポット価格、通常価格からの平均割引率、対象容量、売上・利益率への影響は今回の発表だけでは確定しません。", "The announcement does not establish launch prices by GPU, average discounts versus on-demand rates, available capacity, or the revenue and margin impact."),
    next: copy("10月8日の実価格、対象リージョンとGPU、稼働率やAIクラウド売上への寄与を確認。", "Check October 8 launch prices, eligible regions and GPUs, and any later disclosure on utilization or AI cloud revenue."),
    sources: [
      { id: "nbis-spot-x", publisher: "Nebius official X", title: "Spot pricing announcement", publishedOn: "2026-09-22", location: "Official post · full announcement", url: "https://x.com/nebiusai/status/2102398298833190969" },
      { id: "nbis-spot-docs", publisher: "Nebius AI Cloud Docs", title: "Preemptible virtual machines", publishedOn: "2026-09-22", location: "Pricing policy / Follow spot price", url: "https://docs.nebius.com/compute/virtual-machines/preemptible" },
    ],
    metrics: [],
  },
  {
    id: "nbis-clustermax-platinum-2026-09-23", ticker: "NBIS", company: "Nebius", category: "cloud", kind: "external-research",
    publishedOn: "2026-09-23", reviewedOn: "2026-09-23",
    title: copy("SemiAnalysisがNebiusをClusterMAXのPlatinum tierに選定", "SemiAnalysis moves Nebius into ClusterMAX's Platinum tier"),
    summary: copy("GPUクラウドの外部評価で、NebiusはGoldからPlatinumへ。これは企業発表ではなく、SemiAnalysisによる有料業界調査の評価です。", "An external GPU-cloud assessment moves Nebius from Gold to Platinum. This is SemiAnalysis's paid industry research, not a company announcement."),
    change: copy("SemiAnalysisのClusterMAX 3.0で、Nebiusが前回のGoldからPlatinumへ昇格。", "In SemiAnalysis's ClusterMAX 3.0, Nebius moves up from Gold to Platinum."),
    facts: [
      { text: copy("調査は管理型GPUクラスター77社を対象とし、200社超の利用者への聞き取りを含むと説明。", "SemiAnalysis says ClusterMAX 3.0 reviews 77 managed GPU-cluster providers and draws on interviews with more than 200 end users."), sourceIds: ["nbis-clustermax-2026"] },
      { text: copy("公開された要約で、NebiusをCoreWeaveと並ぶPlatinum tierに分類。価格プレミアムを得られる事業者との評価を示した。", "The public summary places Nebius in the Platinum tier alongside CoreWeave and says it can command a pricing premium."), sourceIds: ["nbis-clustermax-2026"] },
    ],
    interpretation: copy("第三者によるGPUクラウドの技術・事業評価が上向いた材料です。ただし評価はSemiAnalysis独自の調査で、顧客契約や売上増加を直接証明するものではありません。", "This is a favorable third-party assessment of Nebius's GPU-cloud offering. The rating is SemiAnalysis's own research and does not directly prove customer contracts or revenue growth."),
    unknown: copy("評価の詳細な採点根拠は有料記事です。今回確認できた公開要約だけでは、Platinum判定の個別スコア、売上への寄与、調査方法の全容は分かりません。", "The detailed scoring is in a paid article. The public summary does not establish Nebius's individual scores, revenue impact, or the full methodology."),
    next: copy("Nebiusの稼働容量、顧客利用、価格・売上の会社開示と、今後の調査更新を別々に確認。", "Track company disclosures on deployed capacity, customer usage, pricing, and revenue separately from future rating updates."),
    sources: [{ id: "nbis-clustermax-2026", publisher: "SemiAnalysis · paid industry research", title: "ClusterMAX 3.0: The Industry Standard GPU Cloud Rating System Returns", publishedOn: "2026-09-23", location: "Public executive summary; Nebius rating and research scope", url: "https://newsletter.semianalysis.com/p/clustermax-30-the-industry-standard" }],
    metrics: [],
  },
  muLatest,
];
