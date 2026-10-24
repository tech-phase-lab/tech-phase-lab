import {createHash} from 'node:crypto';
import {readApprovedBank} from './rizel-review-store.mjs';
import {saveRizelSelection} from './rizel-selection-store.mjs';
import {createRizelRanker} from './rizel-ranker.mjs';
/** Trusted ingestion only. Never accept browser-supplied article text/evidence.
 * budgetPool must be independent from selectionPool's advisory-lock transaction.
 * No automatic schedule or customer publication is enabled here.
 */
export async function selectArticleForReview({article,evidence=[],selectionPool,budgetPool,apiKey,now=new Date()}){
 const bank=await readApprovedBank(selectionPool);
 if(bank.length!==90)throw Error('PRIVATE_BANK_INCOMPLETE');
 const revision=createHash('sha256').update(JSON.stringify({article,evidence,policy:'editorial-repetition-guard-v3'})).digest('hex');
 return saveRizelSelection(selectionPool,{bank,article:{id:article.id,revision,stars:article.stars,text:article.ja.title+'\n出どころ: '+article.ja.source+'\n'+article.ja.content+'\n'+article.ja.duration},
  evidence:evidence.map(e=>({...e,articleRevision:revision})),now,rank:createRizelRanker({apiKey,pool:budgetPool})});
}
