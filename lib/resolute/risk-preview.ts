import {riskStars,type RiskFeed,type RiskFacts,type RizelQuote} from './risk.ts';
/** Dated owner-only layout sample based on reporting, not the automatic live feed. */
const facts:RiskFacts={source:'report',scope:'sector',duration:'years',impact:'opinion'};
export const RISK_VISUAL_FIXTURE:RiskFeed={state:'ready',date:'2026-10-14',quotes:[],articles:[
 {id:'3'.repeat(64),url:'https://www.barrons.com/livecoverage/stock-market-news-today-101426/card/ai-s-attractiveness-is-fading-where-to-invest-instead--wxyUiEqH1RrCg7z11ZWR',publishedAt:'2026-10-14T00:00:00Z',facts,stars:riskStars(facts),quoteId:null,
 ja:{title:'AI株の投資妙味が低下しているとJefferiesが指摘',source:'米証券会社 Jefferies',content:'利益成長の鈍化や資金調達リスク、高い株価評価を理由に、AI株の相対的な魅力が薄れているという分析です。AI関連の成長優位は認めており、事業の崩壊を確認したニュースではありません。',duration:'2028年までの利益成長を見据えた中期的な見方です。'},
 en:{title:'Jefferies says AI stocks are losing some of their appeal',source:'US investment bank Jefferies',content:'The strategist says slower earnings growth, funding risks and high valuations make AI stocks less attractive. The report still recognizes their growth advantage. It isn’t evidence that AI businesses are falling apart.',duration:'A view of earnings growth through 2028.'}},
 {id:'4'.repeat(64),url:'https://www.barrons.com/articles/hpe-stock-dell-downgrades-ai-b7cdc8bc',publishedAt:'2026-10-14T00:00:00Z',facts:{source:'report',scope:'sector',duration:'months',impact:'opinion'},stars:2,quoteId:null,
 ja:{title:'BarclaysがDellとHPEなどの投資判断を引き下げ',source:'英銀行 Barclays',content:'株価評価の高さとAIによる売上拡大の不透明さを理由に、投資判断を引き下げました。企業自身による業績の下方修正とは異なります。',duration:'今後の業績を評価する見方で、影響期間は確定していません。'},
 en:{title:'Barclays downgrades Dell, HPE and NetApp',source:'UK bank Barclays',content:'Barclays lowered its ratings, citing high valuations and uncertainty about how much AI will boost revenue. These are analyst ratings, not cuts to the companies’ own earnings forecasts.',duration:'A view of future earnings. How long the impact might last is still unclear.'}},
 {id:'5'.repeat(64),url:'https://www.reuters.com/technology/asml-cfo-says-us-match-act-limiting-duv-sales-china-would-be-counterproductive-2026-10-14/',publishedAt:'2026-10-14T08:28:00Z',facts:{source:'report',scope:'company',duration:'months',impact:'possible'},stars:2,quoteId:null,
 ja:{title:'ASMLのCFOが対中輸出を制限する米法案に反対',source:'ASMLの最高財務責任者',content:'中国向け装置販売を制限する法案に対し、中国の競合技術開発を早めると指摘しました。法案の成立や新規制の発効が決まったという報道ではありません。',duration:'法案の行方次第です。影響の開始時期や長さは未確定です。'},
 en:{title:'ASML’s CFO pushes back on a US bill to limit sales to China',source:'ASML’s chief financial officer',content:'The CFO warned that limiting equipment sales could help Chinese rivals develop their own technology faster. The report doesn’t say the bill has passed or that new restrictions have taken effect.',duration:'It depends on what happens to the bill. When the impact might start, and how long it might last, is still unclear.'}},
]};
/** Owner-only presentation metadata. Draft comments never enter the approved live quote bank. */
const comments:RizelQuote[]=[
 {id:'preview-ai',minStars:1,maxStars:3,approved:false,
 ja:{title:'私はこのニュースでは動きません。',reasons:['これは証券会社の見通しであり、企業が業績悪化を発表した話ではありません。','私のルールが動くのは、価格がラインに届いたときだけです。']},
 en:{title:'I won’t trade on this news alone.',reasons:['This is a bank’s forecast, not a company announcing weaker earnings.','I follow my rules when the price reaches a level I’ve set.']}},
 {id:'preview-rating',minStars:1,maxStars:3,approved:false,
 ja:{title:'私は格下げだけでは動きません。',reasons:['株価が高いという評価なのか、事業そのものが悪くなったのかを確かめます。','自分が保有する理由に変化があるかを確認してから判断します。']},
 en:{title:'A downgrade alone won’t make me trade.',reasons:['I check whether the concern is a high share price or a weaker business.','Before deciding, I check whether my reason for owning the stock has changed.']}},
 {id:'preview-bill',minStars:1,maxStars:3,approved:false,
 ja:{title:'私は法案と決定を分けて考えます。',reasons:['今回は規制の提案に対する発言で、成立が決まったという話ではありません。','実際に何が制限されるのか、いつから影響するのかは今後の確認が必要です。']},
 en:{title:'I don’t treat a proposal as a done deal.',reasons:['These comments are about a proposed restriction. They don’t mean the bill has passed.','We still need to see what any restrictions would cover and when they would take effect.']}},
];
export const RISK_PREVIEW_DETAILS = {
 ['3'.repeat(64)]:{ja:'AI株の評価',en:'AI stocks',comment:comments[0]},
 ['4'.repeat(64)]:{ja:'Dell・HPE',en:'Dell / HPE',comment:comments[1]},
 ['5'.repeat(64)]:{ja:'対中輸出',en:'China sales',comment:comments[2]},
};
