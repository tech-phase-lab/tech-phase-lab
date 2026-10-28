import { mkdir, stat } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { createApiServer } from '../resolute-api/http-server.mjs';
import { authConfig } from '../resolute-api/auth.mjs';
import { createRecoveryHandler, filePermit } from './handler.mjs';
import { createRecoveryExecutor, assertIsolatedEnvironment } from './executor.mjs';
import { createAcceptanceObjects } from './storage.mjs';

export function recoveryServerConfig(env,now=Date.now()){
 if(env.RESOLUTE_RECOVERY_CHECK_ENABLED!=='true')return null;
 assertIsolatedEnvironment(env);
 const deadline=Date.parse(env.RESOLUTE_RECOVERY_CHECK_UNTIL??'');
 if(!Number.isFinite(deadline)||deadline<=now||deadline>now+3600000||env.RESOLUTE_RECOVERY_SINGLE_INSTANCE!=='true')throw Error('RECOVERY_SERVER_CONFIG');
 const port=Number(env.PORT??3000);if(!Number.isInteger(port)||port<1024||port>65535)throw Error('RECOVERY_SERVER_CONFIG');
 return {port,until:new Date(deadline).toISOString(),config:authConfig({
  RESOLUTE_API_SERVICE_TOKEN:env.RESOLUTE_RECOVERY_CHECK_SERVICE_TOKEN,
  RESOLUTE_CLERK_ISSUER:env.RESOLUTE_CLERK_ISSUER,
  RESOLUTE_CLERK_AUTHORIZED_PARTIES:env.RESOLUTE_CLERK_AUTHORIZED_PARTIES,
  RESOLUTE_CLERK_JWT_PUBLIC_KEY:env.RESOLUTE_CLERK_JWT_PUBLIC_KEY})};
}

async function main(){
 let objects;
 try{
  const options=recoveryServerConfig(process.env);
  if(!options){console.log(JSON.stringify({event:'RESOLUTE_RECOVERY_SERVER_DISABLED'}));return;}
  const directory='/tmp/resolute-recovery-permit';await mkdir(directory,{mode:0o700,recursive:true});
  const info=await stat(directory);if(!info.isDirectory()||(info.mode&0o777)!==0o700||info.uid!==process.getuid())throw Error('RECOVERY_PERMIT_CONFIG');
  objects=createAcceptanceObjects(process.env);
  const execute=createRecoveryExecutor({config:options.config,objects,onStage:stage=>console.log(JSON.stringify({event:'RESOLUTE_RECOVERY_STAGE',stage}))});
  const handler=createRecoveryHandler({...options,enabled:true,claim:filePermit(directory+'/consumed.json'),execute});
  const server=createApiServer(async request=>{
   const response=await handler(request);
   console.log(JSON.stringify({event:'RESOLUTE_RECOVERY_HTTP',status:response.status}));return response;
  });
  server.listen(options.port,'0.0.0.0');
  // Window cannot silently extend after startup; stale service exits by itself.
  const timer=setTimeout(()=>{server.close(()=>{objects.close();});server.closeAllConnections();},Date.parse(options.until)-Date.now()+5000);
  server.on('close',()=>clearTimeout(timer));
  server.on('error',()=>{clearTimeout(timer);objects.close();process.exitCode=1;});
 }catch{objects?.close();console.error(JSON.stringify({event:'RESOLUTE_RECOVERY_SERVER_FAILED'}));process.exitCode=1;}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)await main();
