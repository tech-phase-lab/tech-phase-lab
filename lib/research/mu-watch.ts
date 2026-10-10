import type { Copy } from './data';
const c = (ja: string, en: string): Copy => ({ ja, en });
export const muWatchSource = 'https://investors.micron.com/news/press-release/2026/Micron-Technology-Inc--Reports-Record-Fiscal-Fourth-Quarter-and-Full-Year-2026-Results/default.aspx';
export const muWatchFacts = {
  releasedOn: '2026-09-30', periodEnd: '2026-09-03', reviewedOn: '2026-10-04',
  revenue: { previous: 41456, current: 54229 },
  adjustedGrossMargin: { previous: 84.9, current: 87.0 },
  coreDataCenterRevenue: { previous: 11524, current: 18002 },
  cloudOperatingMargin: { previous: 78, current: 76 },
  guidance: { revenueLow: 60000, revenueHigh: 63000, adjustedGrossMargin: 86.25 },
};
export const muWatchTitles = [c('成長の中身', 'Growth drivers'), c('前回からの変化', 'What changed'), c('注意点', 'Risks to watch'), c('次に見るポイント', 'Next checkpoints')];
export type MuWatchCard = { title: Copy; headline: Copy; points: Copy[]; detail: Copy; sourceSection: string };
const cards: MuWatchCard[] = [
  {title:muWatchTitles[0], headline:c('増収額の約半分がコア・データセンター部門', 'Core Data Center supplied about half the revenue increase'),
   points:[c('部門売上 $11.524B → $18.002B', 'Segment revenue $11.524B → $18.002B'),c('SOCAMM売上は前四半期の2倍超', 'SOCAMM revenue more than doubled sequentially')],
   detail:c('部門増収額を全社増収額で割ると50.7％。数量・価格・製品構成の寄与率は、この発表では分けられません。', 'Segment growth represents 50.7% of the company-wide increase. This release does not isolate volume, pricing and mix contributions.'),sourceSection:'Quarterly Business Unit Financial Results / Product Highlights'},
  {title:muWatchTitles[1],headline:c('増収と粗利益率の改善が続く', 'Revenue and gross margin increased'),
   points:[c('売上は前四半期比 +30.8％', 'Revenue rose 30.8% quarter-on-quarter'),c('調整後粗利益率 84.9％ → 87.0％', 'Adjusted gross margin 84.9% → 87.0%')],
   detail:c('FQ3とFQ4の実績比較。粗利益率は+2.1ポイントで、2.1％増とは異なります。', 'FQ3-to-FQ4 actuals. The margin gain is 2.1 percentage points, not 2.1%.'),sourceSection:'Quarterly Financial Results'},
  {title:muWatchTitles[2],headline:c('全社改善の陰で、クラウド部門の利益率は低下', 'Cloud margins declined despite company-wide improvement'),
   points:[c('クラウド営業利益率 78％ → 76％', 'Cloud operating margin 78% → 76%'),c('次期の調整後粗利益率見通し 約86.25％', 'Next-quarter adjusted gross margin guidance: approximately 86.25%')],
   detail:c('次期見通しは今回の87.0％を0.75ポイント下回ります。実績ではなく会社予想です。低下要因はこの資料から断定しません。', 'Guidance is 0.75 percentage points below the reported 87.0%. It is a company forecast, not an actual result; the cause is not established here.'),sourceSection:'Quarterly Business Unit Financial Results / Business Outlook'},
  {title:muWatchTitles[3],headline:c('次期売上と利益率をセットで確認', 'Track next-quarter revenue alongside margins'),
   points:[c('FQ1 2027売上見通し $60–63B', 'FQ1 2027 revenue guidance: $60–63B'),c('512GB DDR5はサンプル提供段階', '512GB DDR5 modules are at the sampling stage')],
   detail:c('売上見通しの達成と粗利益率を照合。新製品は顧客認定・量産・売上寄与を区別して追います。サンプル提供を量産済みとは扱いません。', 'Check delivery against guidance and margin performance. Distinguish qualification, production and revenue contribution; sampling does not establish volume production.'),sourceSection:'Business Outlook / Product Highlights'},
];
// Called on the server only. Never serialize paid analysis for a free/expired viewer.
export function muWatchForMember(member: {status:string;plan:string;accessExpiresAt?:number}, now=Date.now()): MuWatchCard[] | null {
  return member.status==='signed-in' && member.plan==='pro' && Number.isFinite(member.accessExpiresAt) && member.accessExpiresAt!>now ? cards : null;
}
