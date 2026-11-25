import {Pool} from 'pg';
import {isOwnerAccount} from '../../lib/membership/entitlements.ts';
import {resoluteDatabaseConfig} from '../../lib/resolute/database-config.ts';
import {thermometerSession} from '../../lib/resolute/thermometer-runtime.ts';
import {parseTodayPlan} from '../../lib/resolute/today-plan-validate.ts';
const json=(v,status=200)=>Response.json(v,{status,headers:{'Cache-Control':'private, no-store'}});
/** 「今日やること」 read path (GET /internal/v1/today-plan): the signed-in member's own stored TodayPlan for the latest confirmed
 * U.S. close, or {plan:null} (the site then shows fixedTodayPlan). Off unless RESOLUTE_TODAY_PLAN_ENABLED=true; only the read-only
 * resolute_today_plan_reader role is accepted. Same right as the other member tools (use active); the owner accounts always
 * (the production owner reaches here only with the MFA-verified session the handler requires). */
export function createTodayPlanRead(env=process.env,{poolFactory=config=>new Pool(config),clock=()=>new Date()}={}){
 if(env.RESOLUTE_TODAY_PLAN_ENABLED!=='true'||!env.RESOLUTE_TODAY_PLAN_READ_DATABASE_URL)return undefined;
 const config=resoluteDatabaseConfig(env.RESOLUTE_TODAY_PLAN_READ_DATABASE_URL);
 if(new URL(config.connectionString).username!=='resolute_today_plan_reader')throw Error('Read-only today-plan role required');
 let pool;
 return async(request,userId,readEntitlements)=>{
  if(request.method!=='GET')return json({error:'METHOD_NOT_ALLOWED'},405);
  // Entitlement before storage: a member without tool access never causes a query.
  if(!isOwnerAccount(userId)){const rights=await readEntitlements(userId);if(!rights?.canUseTools)return json({error:'TOOLS_ENTITLEMENT_REQUIRED'},403);}
  const session=thermometerSession(clock());
  if(!session)return json({plan:null});
  if(!pool){pool=poolFactory({...config,max:1,application_name:'resolute-today-plan-read'});pool.on?.('error',()=>{});}
  const row=(await pool.query('SELECT plan FROM resolute.today_plans WHERE clerk_user_id=$1 AND market_date=$2',[userId,session])).rows[0];
  if(!row)return json({plan:null});
  let plan=null;try{plan=parseTodayPlan(row.plan);}catch{plan=null;}
  return json({plan:plan&&plan.date===session?plan:null});
 };
}
