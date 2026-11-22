import {Pool} from 'pg';
import {resoluteDatabaseConfig} from '../../lib/resolute/database-config.ts';
import {readThermometer} from '../../lib/resolute/thermometer-runtime.ts';
const json=(v,status=200)=>Response.json(v,{status,headers:{'Cache-Control':'private, no-store'}});
/** 相場の温度計 read path (GET /internal/v1/thermometer). The production Postgres has no public
 * TCP proxy, so the site reads the stored daily snapshot through this service.
 * Off unless RESOLUTE_THERMOMETER_READ_ENABLED=1; only the read-only reader role is accepted.
 * Never calls the market provider. Returns undefined when disabled (the handler answers 503). */
export function createThermometerRead(env=process.env,{poolFactory=config=>new Pool(config),clock=()=>new Date()}={}){
 if(env.RESOLUTE_THERMOMETER_READ_ENABLED!=='1'||!env.RESOLUTE_THERMOMETER_READ_DATABASE_URL)return undefined;
 const config=resoluteDatabaseConfig(env.RESOLUTE_THERMOMETER_READ_DATABASE_URL);
 if(new URL(config.connectionString).username!=='resolute_thermometer_reader')throw Error('Read-only thermometer role required');
 let pool;
 return async(request,userId,readEntitlements)=>{
  if(request.method!=='GET')return json({error:'METHOD_NOT_ALLOWED'},405);
  // Entitlement before storage: a member without tool access never causes a query.
  const rights=await readEntitlements(userId);
  if(!rights?.canUseTools)return json({error:'TOOLS_ENTITLEMENT_REQUIRED'},403);
  if(!pool){pool=poolFactory({...config,max:1,application_name:'resolute-thermometer-read'});pool.on?.('error',()=>{});}
  return json(await readThermometer(pool,clock()));
 };
}
