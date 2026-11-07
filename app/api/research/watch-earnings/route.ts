import { getMembership } from '@/lib/membership/server';
import { watchEarningsPayload } from '@/lib/research/watch-earnings';
import { barsBefore, loadRevenueHistory } from '@/lib/research/earnings-history';
export const runtime='nodejs';
export const dynamic='force-dynamic';
const headers={'Cache-Control':'private, no-store','Vary':'Cookie','X-Content-Type-Options':'nosniff'};
export async function GET(){
 try {
  const base=process.env.RESEARCH_MONITOR_URL,token=process.env.RESEARCH_MONITOR_TOKEN;
  if(!base||!token)throw Error('Not configured');
  const url=new URL(base);
  if(url.username||url.password||(url.protocol!=='https:'&&!(process.env.NODE_ENV!=='production'&&['localhost','127.0.0.1'].includes(url.hostname))))throw Error('Invalid monitor');
  url.pathname=`${url.pathname.replace(/\/$/,'')}/watch-earnings`;url.search='';url.hash='';
  const [response,member]=await Promise.all([fetch(url,{headers:{Authorization:`Bearer ${token}`},cache:'no-store',signal:AbortSignal.timeout(8000)}),getMembership().catch(()=>({status:'unavailable',plan:'free'}))]);
  if(!response.ok)throw Error('Unavailable');
  const body=await response.text();if(new TextEncoder().encode(body).length>100_000)throw Error('Oversized payload');
  const payload=watchEarningsPayload(JSON.parse(body),member);
  // The chart's earlier bars come from the SEC (PRO only); a failure just leaves the chart out.
  const period=/^FQ([1-4]) (20\d{2})$/.exec(payload.snapshot?.period??'');
  if(payload.accessExpiresAt>0&&payload.snapshot?.dive?.numbers&&period){
   const history=barsBefore(await loadRevenueHistory(payload.snapshot.ticker),Number(period[2]),Number(period[1])).map(q=>({label:q.label,end:q.end,value:q.value}));
   if(history.length>=3)return Response.json({...payload,history},{headers});
  }
  return Response.json(payload,{headers});
 }catch{return Response.json({ok:false},{status:503,headers});}
}
