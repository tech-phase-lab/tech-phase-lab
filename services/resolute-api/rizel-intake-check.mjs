import {pathToFileURL} from 'node:url';
import {createNewsReader} from './rizel-news-source.mjs';
import {selectDailyCandidates} from './rizel-daily-review.mjs';

/** GET-only diagnostic. Never claim a day, open a DB pool or call a model.
 * No article content, URLs, credentials or owner data appear in the report.
 */
export async function checkIntake({readFeed,now=new Date()}){
 const {selected,diagnostics}=selectDailyCandidates(await readFeed(),now);
 return {event:'RIZEL_INTAKE_CHECK',state:selected.length?'candidates-available':'no-candidates',
  checkedAt:now.toISOString(),historicalReplay:false,candidateCount:selected.length,
  diagnostics,aiCalls:0,writes:0,publication:'withheld'};
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 try{
  if(process.argv.length!==3||process.argv[2]!=='--read-only')throw Error('READ_ONLY_REQUIRED');
  const readFeed=createNewsReader({origin:process.env.RESOLUTE_NEWS_ORIGIN,token:process.env.RESOLUTE_NEWS_READ_TOKEN});
  console.log(JSON.stringify(await checkIntake({readFeed})));
 }catch{
  console.error(JSON.stringify({event:'RIZEL_INTAKE_CHECK_FAILED',aiCalls:0,writes:0}));
  process.exitCode=1;
 }
}
