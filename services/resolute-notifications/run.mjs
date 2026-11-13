import {spawnSync} from 'node:child_process';

// Railway cron の1回の起動: ①通知候補を作る → ②受付済みでない分を送る(mail-worker)。
// 「無効」(各ステップが {"enabled":false} だけを出して終わる)と「失敗」を区別する。
//  - 全ステップが無効、または成功: 終了コード0(Railway に Crashed と判定されない)
//  - 有効なのに失敗(設定不足・DBエラー・未確認の送信・時間切れ等): 従来どおり非0
// ①が失敗しても②は実行する(前回までの候補を送り切るため)。値は出力しない。
const steps=['notification-queue.mjs','mail-worker.mjs'];
function isDisabledOutput(status,stdout){
 if(status!==1)return false;
 const lines=String(stdout??'').trim().split('\n').filter(Boolean);
 if(lines.length!==1)return false;
 try{const value=JSON.parse(lines[0]);return Object.keys(value).length===1&&value.enabled===false;}catch{return false;}
}
let failed=false;
for(const step of steps){
 const result=spawnSync(process.execPath,['--experimental-strip-types','services/resolute-api/'+step],{encoding:'utf8',env:process.env,timeout:240000,maxBuffer:1<<20});
 if(result.stdout)process.stdout.write(result.stdout);
 if(result.stderr)process.stderr.write(result.stderr);
 if(result.error||result.signal||(result.status!==0&&!isDisabledOutput(result.status,result.stdout)))failed=true;
}
process.exitCode=failed?1:0;
