import {MODEL_PRICES} from './ai-budget.mjs';
import {SUMMARY_INSTRUCTIONS_NO_CAUSE,OUTPUT_SCHEMA_NO_CAUSE} from './risk-job.mjs';
import {RANK_INSTRUCTIONS,RANK_SCHEMA,TITLE_INSTRUCTIONS,TITLE_SCHEMA,RIZEL_INSTRUCTIONS,RIZEL_SCHEMA,RIZEL_TRANSLATE,RIZEL_TRANSLATE_SCHEMA,
 SUMMARY_ATTEMPTS,SUMMARY_BACKSTOPS,SUMMARY_MODEL,SUMMARY_BACKSTOP,TRANSLATE_MODEL,INTAKE_MAX} from './shock-candidates.mjs';

/** The Shock Gauge's AI cost per day and per month (Nov 28), from token counts. Instructions and schemas are counted from the strings
 * the service sends (English: 4 characters a token, JSON schema: 3 bytes a token; o200k_base gives 4.6 and 3.1 for these texts, so the
 * estimate is high). Output and per-story sizes were measured with o200k_base on realistic stories (an export-control headline, a
 * 2–3 sentence Japanese and English summary with a dollar amount): a summary 283 tokens, a ranked story 240 tokens in (600-character
 * excerpt) and 71 out, a RIZEL line 222 in and 76 out, a Japanese headline 35 out. Prices: ai-budget.mjs MODEL_PRICES, cached input
 * not counted (every input token at the full price). */
export const TOKENS=Object.freeze({summaryOut:300,rankStoryIn:245,rankItemOut:75,rizelIn:230,rizelOut:80,titleIn:25,titleOut:35,noteIn:60,noteOut:40,storyMeta:70});
const en=t=>Math.ceil(t.length/4),js=o=>Math.ceil(JSON.stringify(o).length/3);
const usd=(model,input,output)=>(input*MODEL_PRICES[model].input+output*MODEL_PRICES[model].output)/1e6;
export const SCENARIOS=Object.freeze({
 /** A usual day: 40 stories ranked, 16 summarised (14 candidates and 2 replacements) from short provider texts, nano's summary fails
  * the checks for 3 of them (its retries, then the mini backstop for 2), 3 RIZEL lines with one rewrite, 4 headlines translated. */
 typical:{stories:40,summaries:16,bodyTokens:300,primaryRetries:0.2,backstops:2,backstopCalls:1.2,rankCalls:1,rizelCalls:4,ownerNotes:0,titles:4,days:30},
 /** A busy day every day: the intake's maximum (INTAKE_MAX per group) ranked, the maximum summaries (SUMMARY_ATTEMPTS) from long texts
  * (about 2,700 characters each), nano retried for 30% of them, every mini backstop used with its retries, one ranking retry in four,
  * 3 RIZEL lines each rewritten plus 3 written at 08:20 for the owner's other picks, 2 owner notes translated, 8 headlines, 31 days. */
 worst:{stories:INTAKE_MAX.market+INTAKE_MAX.company,summaries:SUMMARY_ATTEMPTS,bodyTokens:600,primaryRetries:0.3,backstops:SUMMARY_BACKSTOPS,backstopCalls:1.5,rankCalls:1.25,rizelCalls:9,ownerNotes:2,titles:8,days:31},
});
export function estimateShockAiCost(s){
 const summaryIn=en(SUMMARY_INSTRUCTIONS_NO_CAUSE)+js(OUTPUT_SCHEMA_NO_CAUSE)+s.bodyTokens+TOKENS.storyMeta;
 const parts={
  rank:s.rankCalls*usd('gpt-5.4-mini',en(RANK_INSTRUCTIONS)+js(RANK_SCHEMA)+s.stories*TOKENS.rankStoryIn,20*TOKENS.rankItemOut),
  summaries:s.summaries*(1+s.primaryRetries)*usd(SUMMARY_MODEL,summaryIn,TOKENS.summaryOut),
  backstops:s.backstops*s.backstopCalls*usd(SUMMARY_BACKSTOP,summaryIn,TOKENS.summaryOut),
  rizel:s.rizelCalls*usd('gpt-5.4-mini',en(RIZEL_INSTRUCTIONS)+js(RIZEL_SCHEMA)+TOKENS.rizelIn,TOKENS.rizelOut),
  translations:usd(TRANSLATE_MODEL,en(TITLE_INSTRUCTIONS)+js(TITLE_SCHEMA)+s.titles*TOKENS.titleIn,s.titles*TOKENS.titleOut)
   +s.ownerNotes*usd(TRANSLATE_MODEL,en(RIZEL_TRANSLATE)+js(RIZEL_TRANSLATE_SCHEMA)+TOKENS.noteIn,TOKENS.noteOut),
 };
 const day=Object.values(parts).reduce((a,b)=>a+b,0),r=x=>Math.round(x*10000)/10000;
 return {day:r(day),month:Math.round(day*s.days*100)/100,parts:Object.fromEntries(Object.entries(parts).map(([k,v])=>[k,r(v)]))};
}
