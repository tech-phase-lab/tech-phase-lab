import type {RiskFeed} from './risk.ts';
/** Owner-only visual fixture, explicitly selected and labeled. Never returned by the API. */
export const RISK_VISUAL_FIXTURE:RiskFeed={state:'ready',date:'2027-01-15',quotes:[],articles:[
 {id:'1'.repeat(64),url:'https://example.com',publishedAt:'2027-01-15T00:00:00Z',facts:{source:'sns',scope:'sector',duration:'months',impact:'opinion'},stars:2,quoteId:null,
 ja:{title:'「ブラックロックが、米国株の比率を下げるよう勧告した」と報じられました',source:'SNSの投稿',content:'大手運用会社が、AIの値動きの大きさを理由に、米国株の比率を下げる考えを示したという内容です。',duration:'運用会社の比率の見直しは、数か月から数年かけて行うものです。'},en:{title:'A report says BlackRock recommended reducing exposure to US stocks',source:'A social media post',content:'The post says a major asset manager proposed reducing its allocation to US stocks because of volatility in AI-related shares.',duration:'An asset manager’s allocation changes may play out over months or years.'}},
 {id:'2'.repeat(64),url:'https://example.com',publishedAt:'2027-01-15T00:00:00Z',facts:{source:'official',scope:'sector',duration:'months',impact:'confirmed'},stars:4,quoteId:null,
 ja:{title:'半導体の供給停止が数か月続き、業績に影響する例',source:'架空の公式発表',content:'業績への直接影響が確認されている場合の表示例です。実際のニュースではありません。',duration:'数か月という想定'},en:{title:'Example: a chip supply halt affects earnings for several months',source:'A fictional company announcement',content:'This example shows a confirmed earnings impact. It is not a real news story.',duration:'Several months, for this example only.'}},
]};
