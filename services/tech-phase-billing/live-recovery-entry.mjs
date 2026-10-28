import {liveRuntime} from './live-runtime.mjs';
import {runRecoveryJob} from './live-recovery-job.mjs';
const runtime=liveRuntime(process.env),controller=new AbortController();
for(const name of ['SIGTERM','SIGINT'])process.once(name,()=>controller.abort());
process.exitCode = await runRecoveryJob({env:process.env,runtime,signal:controller.signal});
