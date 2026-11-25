import {readingStars,SUMMARY_QUESTION,type RiskFeed,type RiskCopy,type RizelQuote} from './risk.ts';
/** Dated owner-only layout sample based on reporting, not the automatic live feed.
 * Stars follow the Shock Gauge rule from the TP index moves shown (sample numbers); the third story shows the waiting state. */
const ask=(copy:RiskCopy,locale:'ja'|'en'):RiskCopy=>({...copy,content:copy.content+'\n'+SUMMARY_QUESTION[locale]});
/** Sample numbers for the layout (both indices on one close). */
const SAMPLE_READING={from:'2026-10-13',nas100:{changePercent:-1.4,multiple:1.2,same:71,total:100},sox:{changePercent:-3.2,multiple:2.1,same:33,total:40},fearChange:6};
export const RISK_VISUAL_FIXTURE:RiskFeed={state:'ready',date:'2026-10-14',quotes:[],articles:[
 {id:'3'.repeat(64),url:'https://www.barrons.com/livecoverage/stock-market-news-today-101426/card/ai-s-attractiveness-is-fading-where-to-invest-instead--wxyUiEqH1RrCg7z11ZWR',publishedAt:'2026-10-14T00:00:00Z',market:{index:'sox',session:'2026-10-14',reading:SAMPLE_READING},stars:readingStars(SAMPLE_READING),quoteId:null,
 ja:ask({title:'AI株の投資妙味が低下しているとJefferiesが指摘',source:'米証券会社 Jefferies',content:'Jefferiesのストラテジストが、利益成長の鈍化、資金調達リスク、高い株価評価を理由に、AI株の相対的な魅力が薄れたとする分析を出しました。',date:'2026年10月14日の報道'},'ja'),
 en:ask({title:'Jefferies says AI stocks are losing some of their appeal',source:'US investment bank Jefferies',content:'A Jefferies strategist said slower earnings growth, funding risks and high valuations make AI stocks less attractive.',date:'Reported on October 14, 2026'},'en')},
 {id:'4'.repeat(64),url:'https://www.barrons.com/articles/hpe-stock-dell-downgrades-ai-b7cdc8bc',publishedAt:'2026-10-14T00:00:00Z',market:{index:'nas100',session:'2026-10-14',reading:SAMPLE_READING},stars:readingStars(SAMPLE_READING),quoteId:null,
 ja:ask({title:'BarclaysがDellとHPEなどの投資判断を引き下げ',source:'英銀行 Barclays',content:'Barclaysが、株価評価の高さとAIによる売上拡大の不透明さを理由に、Dell・HPE・NetAppの投資判断を引き下げました。',date:'2026年10月14日の報道'},'ja'),
 en:ask({title:'Barclays downgrades Dell, HPE and NetApp',source:'UK bank Barclays',content:'Barclays lowered its ratings on Dell, HPE and NetApp, citing high valuations and uncertainty about how much AI will add to revenue.',date:'Reported on October 14, 2026'},'en')},
 {id:'5'.repeat(64),url:'https://www.reuters.com/technology/asml-cfo-says-us-match-act-limiting-duv-sales-china-would-be-counterproductive-2026-10-14/',publishedAt:'2026-10-14T08:28:00Z',market:{index:'sox',session:null,reading:null},stars:null,quoteId:null,
 ja:ask({title:'ASMLのCFOが対中輸出を制限する米法案に反対',source:'ASMLの最高財務責任者',content:'ASMLのCFOが、中国向け装置販売を制限する米法案について、中国の競合技術の開発を早めると発言しました。法案は審議中です。',date:'2026年10月14日の報道'},'ja'),
 en:ask({title:'ASML’s CFO pushes back on a US bill to limit sales to China',source:'ASML’s chief financial officer',content:'ASML’s CFO said a US bill limiting equipment sales to China would help Chinese rivals develop their own technology faster. The bill has not passed.',date:'Reported on October 14, 2026'},'en')},
]};
/** Owner-only presentation metadata. Draft comments never enter the approved live quote bank.
 * General mindset lines only (lawyer review, Nov 2026): no impact evaluation, outlook or trading action. */
const comments:RizelQuote[]=[
 {id:'preview-ai',minStars:1,maxStars:5,approved:false,
 ja:{title:'見出しだけで動かず、本文と自分のルールを確かめましょう。',reasons:['誰が、何を、いつ発表したのかを本文で確かめます。','あなたのルールに書いた条件と照らし合わせます。']},
 en:{title:'Before you act, check the full story and your own rules.',reasons:['Check who said what, and when, in the full story.','Compare it with the conditions you wrote in your rules.']}},
 {id:'preview-rating',minStars:1,maxStars:5,approved:false,
 ja:{title:'誰かの評価と、自分のルールは分けて考えましょう。',reasons:['評価を出したのが誰かを確かめます。','自分が保有する理由を、ルールの一冊で読み返します。']},
 en:{title:'Keep someone else’s rating separate from your own rules.',reasons:['Check who issued the rating.','Reread why you hold the stock in your rulebook.']}},
 {id:'preview-bill',minStars:1,maxStars:5,approved:false,
 ja:{title:'提案と決定を分けて読みましょう。',reasons:['本文で、何が決まったのか、何がまだ提案なのかを確かめます。','そのうえで、自分のルールの条件を確かめます。']},
 en:{title:'Read a proposal and a decision separately.',reasons:['Check in the full story what has been decided and what is still a proposal.','Then check the conditions in your own rules.']}},
];
export const RISK_PREVIEW_DETAILS = {
 ['3'.repeat(64)]:{ja:'AI株の評価',en:'AI stocks',homeJa:'AI株の魅力が低下とJefferiesが指摘',homeEn:'Jefferies sees less appeal in AI stocks',comment:comments[0]},
 ['4'.repeat(64)]:{ja:'Dell・HPE',en:'Dell / HPE',homeJa:'Dell・HPEなどの投資判断を引き下げ',homeEn:'Barclays downgrades Dell, HPE and NetApp',comment:comments[1]},
 ['5'.repeat(64)]:{ja:'対中輸出',en:'China sales',homeJa:'ASMLが対中輸出を制限する米法案に反対',homeEn:'ASML opposes US bill limiting China sales',comment:comments[2]},
};
