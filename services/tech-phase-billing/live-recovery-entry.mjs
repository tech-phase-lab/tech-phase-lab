import {liveRuntime} from './live-runtime.mjs';
import {runLiveRecovery} from './live-recovery.mjs';
const runtime=liveRuntime(process.env),controller=new AbortController();
for(const name of ['SIGTERM','SIGINT'])process.once(name,()=>controller.abort());
try{
 const result=await runLiveRecovery({env:process.env,services:runtime.services,signal:controller.signal});
 console.log(JSON.stringify({event:'TECH_PHASE_LIVE_RECOVERY',...result}));
 if(result.outcome==='partial-failure')process.exitCode=1;
}catch{
 console.error(JSON.stringify({event:'TECH_PHASE_LIVE_RECOVERY_FAILED'}));process.exitCode=1;
}finally{await runtime.close();}
