import {spawnSync} from 'node:child_process';

// Railway cron の1回の起動: ①通知候補を作る → ②受付済みでない分を送る(mail-worker)。
// どちらも各自の有効化フラグが true でなければ何もしない(終了コード1で「無効」と分かる)。
// ①が失敗しても②は実行する(前回までの候補を送り切るため)。値は出力しない。
const steps=['notification-queue.mjs','mail-worker.mjs'];
let failed=false;
for(const step of steps){
 const result=spawnSync(process.execPath,['--experimental-strip-types','services/resolute-api/'+step],{stdio:'inherit',env:process.env,timeout:240000});
 if(result.status!==0)failed=true;
}
process.exitCode=failed?1:0;
