import type { ResearchEvent } from './data';
import recovery from '../../scripts/research/mu_fq4_recovery.json' with { type: 'json' };

const copy = (ja: string, en: string) => ({ja, en});
const facts = recovery.facts;
// Manually verified recovery from the issuer's SEC Exhibit 99.1, not a live SLA.
export const muLatest: ResearchEvent = {
  id: 'mu-q4-2026', ticker: 'MU', company: 'Micron', category: 'memory', kind: 'earnings',
  publishedOn: recovery.publishedOn, reviewedOn: recovery.reviewedOn,
  title: copy('MU決算：売上拡大が続く。次四半期は600〜630億ドルを見込む', 'MU earnings: growth continues, with $60–63B revenue expected next quarter'),
  summary: copy(recovery.headlineJa, recovery.headlineEn),
  change: copy('前四半期から売上は30.8％増、調整後EPSは33.1％増。会社は次四半期も増収増益を見込む。', 'Revenue rose 30.8% and adjusted EPS rose 33.1% from the prior quarter. The company expects further growth next quarter.'),
  facts: [
    {text: copy('2026年度Q4の売上は542.29億ドル。前四半期は414.56億ドル。', 'FQ4 2026 revenue was $54.229B, versus $41.456B in the prior quarter.'), sourceIds: ['mu-q4-sec']},
    {text: copy('GAAP EPSは32.87ドル、調整後EPSは33.42ドル。調整後粗利益率は87.0％。', 'GAAP EPS was $32.87 and adjusted EPS was $33.42. Adjusted gross margin was 87.0%.'), sourceIds: ['mu-q4-sec']},
    {text: copy('次四半期の売上見通しは615億ドル±15億ドル、調整後EPSは38.15ドル±1ドル。', 'Next-quarter guidance is $61.5B ± $1.5B in revenue and $38.15 ± $1.00 in adjusted EPS.'), sourceIds: ['mu-q4-sec']},
  ],
  interpretation: copy('売上と利益は前四半期から伸びた。一方、次四半期の調整後粗利益率の見通しは86.25％で、今回の87.0％をやや下回る。増収見通しと利益率を分けて見る。', 'Revenue and earnings grew sequentially. Next-quarter adjusted gross margin guidance of 86.25% is slightly below the reported 87.0%, so revenue growth and margin direction should be assessed separately.'),
  unknown: copy('市場予想との比較は未確認。決算だけで、その後の株価の方向は確定しない。', 'Consensus comparisons have not been verified. These results alone do not determine the share price reaction.'),
  next: copy('売上見通しの達成と、粗利益率の推移を次の決算で確認する。', 'Track delivery against revenue guidance and the next quarter’s gross margin.'),
  sources: [{id:'mu-q4-sec', url:recovery.evidenceUrl, title:'Micron FQ4 2026 earnings release (SEC Exhibit 99.1)', publisher:'Micron / SEC', publishedOn:recovery.publishedOn, location:'Quarterly Financial Results / Business Outlook'}],
  metrics: [
    {name:'revenue',value:facts.revenueMillionUSD,unit:'million',currency:'USD',basis:'GAAP',scope:'Micron',period:'FQ4 2026',periodEnd:'2026-09-03',duration:'quarter',kind:'actual',sourceId:'mu-q4-sec'},
    {name:'adjusted-eps',value:facts.adjustedEPS,unit:'per-share',currency:'USD',basis:'non-GAAP',scope:'Micron',period:'FQ4 2026',periodEnd:'2026-09-03',duration:'quarter',kind:'actual',sourceId:'mu-q4-sec'},
  ],
  previous: [
    {name:'revenue',value:facts.previousQuarterRevenueMillionUSD,unit:'million',currency:'USD',basis:'GAAP',scope:'Micron',period:'FQ3 2026',periodEnd:'2026-05-28',duration:'quarter',kind:'actual',sourceId:'mu-q4-sec'},
    {name:'adjusted-eps',value:facts.previousQuarterAdjustedEPS,unit:'per-share',currency:'USD',basis:'non-GAAP',scope:'Micron',period:'FQ3 2026',periodEnd:'2026-05-28',duration:'quarter',kind:'actual',sourceId:'mu-q4-sec'},
  ],
};

export const muFlash = {
  id:'9000000000001', title:recovery.headlineEn, translationJa:recovery.headlineJa,
  url:recovery.evidenceUrl, publisher:'Micron 決算', tickers:['MU'],
  observedAt:'2026-09-30T20:18:32+00:00', researchId:muLatest.id,
};
