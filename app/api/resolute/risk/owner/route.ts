import {riskProxy} from '@/lib/resolute/risk-proxy';
export const runtime='nodejs';export const dynamic='force-dynamic';
export const GET=(request:Request)=>riskProxy(request,true);
export const POST=(request:Request)=>riskProxy(request,true);
