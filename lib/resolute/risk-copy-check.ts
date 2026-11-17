/** Machine checks for Shock Gauge summaries and RIZEL lines (lawyer review, Nov 2026).
 * Plain data and pure functions so the Railway worker, the API and the owner screens share one list.
 * Each pattern has a fixed code: logs carry codes only, never the article text.
 */
type Rule={code:string;pattern:RegExp};
/** Outlook, impact evaluation and trading calls. Summaries carrying any of these are rewritten once, then dropped. */
export const SUMMARY_BANNED:readonly Rule[]=[
 {code:'temporary',pattern:/一時的|\btemporar(?:y|ily)\b|\bshort-lived\b/i},
 {code:'impact-size',pattern:/影響(?:は|が|も)(?:小さ|大き|限定的|軽微|甚大)|(?:小さな|大きな|限定的な|軽微な)影響|\b(?:impact|effect)s? (?:is|are|was|were|will be|should be|looks|seems|appears|remains?) (?:\w+ )?(?:small|limited|minor|large|big|significant|huge|modest)\b|\b(?:small|limited|minor|large|big|significant|huge|modest) (?:impact|effect)s?\b/i},
 {code:'appearance',pattern:/[きしちにひみりぎじびぴえけせねへめれげぜでべ一-龥]そう(?:だ|です|な|に|。|、|$)|\b(?:looks|seems|appears) (?:likely|set|poised) to\b|\bis (?:set|poised) to\b/i},
 {code:'likely',pattern:/可能性(?:が|は)(?:高|大き|低)|見込みが(?:高|大き)|\blikely\b|\bprobabl[ey]\b|\bhigh (?:chance|probability|likelihood)\b/i},
 {code:'buy-sell-timing',pattern:/買い時|売り時|買い場|売り場|押し目|仕込み時|\b(?:buying|selling) opportunit(?:y|ies)\b|\b(?:good|right|best) time to (?:buy|sell)\b|\btime to (?:buy|sell)\b/i},
 {code:'caution',pattern:/警戒(?:が|は)?必要|警戒すべき|注意が必要|注意すべき|要警戒|要注意|\b(?:caution|vigilance) is (?:needed|warranted|required|advised)\b|\b(?:investors )?should (?:be cautious|stay cautious|be careful|watch out)\b/i},
 {code:'outlook',pattern:/今後の見通し|先行き|見通しは(?:明るい|暗い|厳しい)|\b(?:the )?outlook (?:is|remains|looks) (?:bright|bleak|weak|strong|positive|negative|uncertain)\b/i},
 {code:'advice',pattern:/買うべき|売るべき|買いましょう|売りましょう|様子見(?:が|を)|\byou should (?:buy|sell|hold|wait)\b|\binvestors should\b/i},
];
/** RIZEL lines: no importance/impact evaluation, outlook or trading actions. Flagged approved lines need the owner's re-approval. */
export const RIZEL_BANNED:readonly Rule[]=[
 ...SUMMARY_BANNED,
 {code:'importance',pattern:/中身は(?:大きく|小さく)|見出しほど|大した(?:こと|話|ニュース)|大きな話ではありません|心配(?:は)?(?:いりません|ない|ありません)|重要(?:では|じゃ)ない|\bnot a big deal\b|\bnothing to worry\b|\b(?:bigger|smaller) than the headline\b|\bdoesn[’']t matter\b/i},
 {code:'trading-action',pattern:/(?:この|今回の)?ニュースでは動きません|(?:この|今回の)?ニュースで(?:は)?売買しません|売買しません|動きません|買い増します|売ります|買います|手放します|\bI (?:won[’']t|will not|don[’']t|do not) (?:trade|sell|buy)\b|\bI(?:[’']ll| will) (?:buy|sell|hold|trade)\b|\bwon[’']t make me (?:trade|sell|buy)\b/i},
];
function scan(rules:readonly Rule[],text:string){return rules.filter(r=>r.pattern.test(text)).map(r=>r.code);}
/** Codes of banned expressions found in a summary (ja/en copy objects or plain text). */
export function summaryIssues(...texts:unknown[]){const flat=texts.flatMap(t=>typeof t==='string'?[t]:t&&typeof t==='object'?Object.values(t).filter(v=>typeof v==='string') as string[]:[]);return [...new Set(flat.flatMap(t=>scan(SUMMARY_BANNED,t)))];}
export function rizelCopyIssues(text:string){return typeof text==='string'?scan(RIZEL_BANNED,text):['invalid'];}
/** Owner-provided rewrites (lawyer review examples). Exact old text → general mindset line. */
export const RIZEL_REWRITES:Readonly<Record<string,string>>={
 '見出しほど、中身は大きくありません。':'見出しだけで動かず、本文と自分のルールを確かめましょう。',
 'I won’t trade on this news alone.':'Before you act, check the full story and your own rules.',
 "I won't trade on this news alone.":'Before you act, check the full story and your own rules.',
};
/** Fallback suggestion when a flagged line has no listed rewrite (the owner edits it before approving). */
export const RIZEL_GENERAL_LINE={ja:'動く前に、本文と自分のルールを確かめましょう。',en:'Before you act, check the full story and your own rules.'};
export function rizelRewrite(text:string,locale:'ja'|'en'){return RIZEL_REWRITES[text]??RIZEL_GENERAL_LINE[locale];}
/** A RIZEL quote (news owner screen) needs re-approval when any title or reason is flagged. */
export function quoteIssues(q:{ja:{title:string;reasons:string[]};en:{title:string;reasons:string[]}}){return [...new Set([q.ja.title,...q.ja.reasons,q.en.title,...q.en.reasons].flatMap(rizelCopyIssues))];}
