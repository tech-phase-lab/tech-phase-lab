import {riskProxy} from '@/lib/resolute/risk-proxy';
export const runtime='nodejs';export const dynamic='force-dynamic';
export const GET=(r:Request)=>riskProxy(r,true,true);
export const POST=(r:Request)=>riskProxy(r,true,true);
