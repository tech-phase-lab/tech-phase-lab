import {riskStars,type RiskFeed,type RiskFacts} from './risk.ts';
/** Dated owner-only layout sample based on reporting, not the automatic live feed. */
const facts:RiskFacts={source:'report',scope:'sector',duration:'years',impact:'opinion'};
export const RISK_VISUAL_FIXTURE:RiskFeed={state:'ready',date:'2026-10-14',quotes:[],articles:[
 {id:'3'.repeat(64),url:'https://www.barrons.com/livecoverage/stock-market-news-today-101426/card/ai-s-attractiveness-is-fading-where-to-invest-instead--wxyUiEqH1RrCg7z11ZWR',publishedAt:'2026-10-14T00:00:00Z',facts,stars:riskStars(facts),quoteId:null,
 ja:{title:'AI株の投資妙味が低下しているとJefferiesが指摘',source:'Jefferiesのストラテジストの見解を伝えたBarron’sの報道',content:'利益成長の鈍化や資金調達リスク、高い株価評価を理由に、AI株の相対的な魅力が薄れているという分析です。AI関連の成長優位は認めており、事業の崩壊を確認したニュースではありません。',duration:'2028年までの利益成長を見据えた中期的な見方です。'},
 en:{title:'Jefferies sees a less compelling case for AI stocks',source:'Barron’s reporting on a Jefferies strategist’s assessment',content:'The strategist argues that slower earnings growth, funding risks and high valuations are reducing the relative appeal of AI stocks. The analysis still acknowledges their growth advantage. It does not establish that AI businesses are collapsing.',duration:'A medium-term assessment of earnings growth through 2028.'}},
]};
