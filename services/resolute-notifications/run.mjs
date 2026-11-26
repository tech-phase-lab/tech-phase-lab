import {spawnSync} from 'node:child_process';

// Railway cron の1回の起動: ①通知候補を作る → ②受付済みでない分を送る(mail-worker)。
// 「無効」(各ステップが {"enabled":false} だけを出して終わる)と「失敗」を区別する。
//  - 全ステップが無効、または成功: 終了コード0(Railway に Crashed と判定されない)
//  - 有効なのに失敗(設定不足・DBエラー・未確認の送信・時間切れ等): 従来どおり非0
// ①が失敗しても②は実行する(前回までの候補を送り切るため)。値は出力しない。
// Twelve Data (Nov 26): the day's closes are read once for everyone before ① (twelve-prefetch.mjs, a few batched requests), and the
// split histories are refreshed after ② with what is left of the run (each request leased and paced; the rest waits for the next run).
const RUN_MS=500000,started=Date.now();
const steps=[['twelve-prefetch.mjs','--closes',60000],['notification-queue.mjs',null,240000],['mail-worker.mjs',null,240000],['twelve-prefetch.mjs','--splits',120000]];
function isDisabledOutput(status,stdout){
 if(status!==1)return false;
 const lines=String(stdout??'').trim().split('\n').filter(Boolean);
 if(lines.length!==1)return false;
 try{const value=JSON.parse(lines[0]);return Object.keys(value).length===1&&value.enabled===false;}catch{return false;}
}
let failed=false;
for(const [step,arg,limit] of steps){
 const left=RUN_MS-(Date.now()-started),prefetch=step==='twelve-prefetch.mjs';
 // A prefetch step never takes the time ② and the mail need; with too little left it is skipped (the next run reads what is missing).
 if(prefetch&&left<30000)continue;
 const timeout=prefetch?Math.min(limit,left):limit;
 const result=spawnSync(process.execPath,['--experimental-strip-types','services/resolute-api/'+step,...(arg?[arg]:[])],{encoding:'utf8',
  env:prefetch?{...process.env,RESOLUTE_TWELVE_PREFETCH_DEADLINE_MS:String(timeout-15000)}:process.env,timeout,maxBuffer:1<<20});
 if(result.stdout)process.stdout.write(result.stdout);
 if(result.stderr)process.stderr.write(result.stderr);
 // A prefetch failure never fails the run: the alert step reads what it can and asks the provider for the rest.
 if(prefetch)continue;
 if(result.error||result.signal||(result.status!==0&&!isDisabledOutput(result.status,result.stdout)))failed=true;
}
process.exitCode=failed?1:0;
