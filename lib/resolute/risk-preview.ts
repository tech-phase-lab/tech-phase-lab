import {riskStars,type RiskFeed,type RiskFacts,type RizelQuote} from './risk.ts';
/** Dated owner-only layout sample based on reporting, not the automatic live feed. */
const facts:RiskFacts={source:'report',scope:'sector',duration:'years',impact:'opinion'};
export const RISK_VISUAL_FIXTURE:RiskFeed={state:'ready',date:'2026-10-14',quotes:[],articles:[
 {id:'3'.repeat(64),url:'https://www.barrons.com/livecoverage/stock-market-news-today-101426/card/ai-s-attractiveness-is-fading-where-to-invest-instead--wxyUiEqH1RrCg7z11ZWR',publishedAt:'2026-10-14T00:00:00Z',facts,stars:riskStars(facts),quoteId:null,
 ja:{title:'AI株の投資妙味が低下しているとJefferiesが指摘',source:'見解：Jefferies（米証券会社）\n報道：Barron’s（米金融メディア）',content:'利益成長の鈍化や資金調達リスク、高い株価評価を理由に、AI株の相対的な魅力が薄れているという分析です。AI関連の成長優位は認めており、事業の崩壊を確認したニュースではありません。',duration:'2028年までの利益成長を見据えた中期的な見方です。'},
 en:{title:'Jefferies sees a less compelling case for AI stocks',source:'Opinion: Jefferies, an investment bank\nReported by: Barron’s',content:'The strategist argues that slower earnings growth, funding risks and high valuations are reducing the relative appeal of AI stocks. The analysis still acknowledges their growth advantage. It does not establish that AI businesses are collapsing.',duration:'A medium-term assessment of earnings growth through 2028.'}},
 {id:'4'.repeat(64),url:'https://www.barrons.com/articles/hpe-stock-dell-downgrades-ai-b7cdc8bc',publishedAt:'2026-10-14T00:00:00Z',facts:{source:'report',scope:'sector',duration:'months',impact:'opinion'},stars:2,quoteId:null,
 ja:{title:'BarclaysがDellとHPEなどの投資判断を引き下げ',source:'判断：Barclays（英銀行）\n報道：Barron’s（米金融メディア）',content:'株価評価の高さとAIによる売上拡大の不透明さを理由に、投資判断を引き下げました。企業自身による業績の下方修正とは異なります。',duration:'今後の業績を評価する見方で、影響期間は確定していません。'},
 en:{title:'Barclays downgrades Dell, HPE and NetApp',source:'Rating: Barclays, a UK bank\nReported by: Barron’s',content:'Barclays cited valuations and an unclear AI revenue boost. An analyst downgrade is not a company cutting its own earnings guidance.',duration:'A forward-looking assessment; the impact period is not established.'}},
 {id:'5'.repeat(64),url:'https://www.reuters.com/technology/asml-cfo-says-us-match-act-limiting-duv-sales-china-would-be-counterproductive-2026-10-14/',publishedAt:'2026-10-14T08:28:00Z',facts:{source:'report',scope:'company',duration:'months',impact:'possible'},stars:2,quoteId:null,
 ja:{title:'ASMLのCFOが対中輸出を制限する米法案に反対',source:'発言：ASMLの最高財務責任者\n報道：Reuters（ロイター通信）',content:'中国向け装置販売を制限する法案に対し、中国の競合技術開発を早めると指摘しました。法案の成立や新規制の発効が決まったという報道ではありません。',duration:'法案の行方次第です。影響の開始時期や長さは未確定です。'},
 en:{title:'ASML’s CFO opposes a proposed US restriction on China sales',source:'Speaker: ASML’s chief financial officer\nReported by: Reuters',content:'The CFO warned that restricting equipment sales could accelerate rival technology in China. The report does not announce an enacted law or a new restriction taking effect.',duration:'Depends on the bill. The timing and duration remain uncertain.'}},
]};
/** Owner-only presentation metadata. Draft comments never enter the approved live quote bank. */
const comments:RizelQuote[]=[
 {id:'preview-ai',minStars:1,maxStars:3,approved:false,
 ja:{title:'私はこのニュースでは動きません。',reasons:['これは証券会社の見通しであり、企業が業績悪化を発表した話ではありません。','数年先の成長予測を、そのまま今日の売買理由にはしません。','私のルールが動くのは、価格がラインに届いたときだけです。']},
 en:{title:'This news won’t make me act.',reasons:['This is a bank’s outlook, not a company reporting deteriorating earnings.','A forecast for years ahead is not, by itself, a reason for me to trade today.','My price-based rules come into play when the price reaches my level.']}},
 {id:'preview-rating',minStars:1,maxStars:3,approved:false,
 ja:{title:'私は格下げだけでは動きません。',reasons:['証券会社の投資判断と、企業が発表する業績は分けて考えます。','株価が高いという評価なのか、事業そのものが悪くなったのかを確かめます。','自分が保有する理由に変化があるかを確認してから判断します。']},
 en:{title:'A downgrade alone won’t make me act.',reasons:['I distinguish an analyst’s rating from a company’s reported results.','I check whether the concern is valuation or a deterioration in the business.','I consider whether my reason for holding the investment has changed.']}},
 {id:'preview-bill',minStars:1,maxStars:3,approved:false,
 ja:{title:'私は法案と決定を分けて考えます。',reasons:['今回は規制の提案に対する発言で、成立が決まったという話ではありません。','実際に何が制限されるのか、いつから影響するのかは今後の確認が必要です。','決まっていない損失を想像で膨らませず、続報を確認します。']},
 en:{title:'I separate a proposal from a decision.',reasons:['The remarks concern a proposed restriction, not an enacted law.','The final scope and timing of any restrictions still need to be checked.','I follow further developments rather than imagine losses that have not been established.']}},
];
export const RISK_PREVIEW_DETAILS = {
 ['3'.repeat(64)]:{ja:'AI株の評価',en:'AI stocks',comment:comments[0]},
 ['4'.repeat(64)]:{ja:'Dell・HPE',en:'Dell / HPE',comment:comments[1]},
 ['5'.repeat(64)]:{ja:'対中輸出',en:'China sales',comment:comments[2]},
};
