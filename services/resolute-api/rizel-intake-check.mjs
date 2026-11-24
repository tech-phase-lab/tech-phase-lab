import {createReportReader,withReportReader,REPORT_CHECKS,reportMaxPages} from './rizel-report-source.mjs';
import {pathToFileURL} from 'node:url';
import {createNewsReader} from './rizel-news-source.mjs';
import {selectDailyCandidates,safeErrorCode} from './rizel-daily-review.mjs';
import {FEED_CHECKS,windowHours} from './risk-job.mjs';

/** GET-only diagnostic. Never claim a day, open a DB pool or call a model.
 * No article content, URLs, credentials or owner data appear in the report.
 */
export async function checkIntake({readFeed,now=new Date()}){
 const {selected,diagnostics}=selectDailyCandidates(await readFeed({since:now.getTime()-windowHours(now)*3600000}),now);
 return {event:'RIZEL_INTAKE_CHECK',state:selected.length?'candidates-available':'no-candidates',
  checkedAt:now.toISOString(),historicalReplay:false,candidateCount:selected.length,
  diagnostics,aiCalls:0,writes:0,publication:'withheld'};
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 try{
  if(process.argv.length!==3||process.argv[2]!=='--read-only')throw Error('READ_ONLY_REQUIRED');
  const readFeed=withReportReader(createNewsReader({origin:process.env.RESOLUTE_NEWS_ORIGIN,token:process.env.RESOLUTE_NEWS_READ_TOKEN}),createReportReader({enabled:process.env.RESOLUTE_REPORT_SOURCE_ENABLED==='true',token:process.env.RESOLUTE_REPORT_SOURCE_TOKEN,tickers:process.env.RESOLUTE_REPORT_SOURCE_TICKERS,marketWide:process.env.RESOLUTE_REPORT_MARKET_LANE!=='false',maxPages:reportMaxPages()}));
  console.log(JSON.stringify(await checkIntake({readFeed})));
 }catch(error){
  // Fixed codes only (never the message of a foreign error, which may hold a URL or body).
  console.error(JSON.stringify({event:'RIZEL_INTAKE_CHECK_FAILED',error:safeErrorCode(error),...([...FEED_CHECKS,...REPORT_CHECKS].includes(error?.check)?{check:error.check}:{}),aiCalls:0,writes:0}));
  process.exitCode=1;
 }
}
