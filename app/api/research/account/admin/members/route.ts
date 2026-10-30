import {ownerIdentity,reply,accountError,accountHeaders} from '@/lib/account/server';
import {memberPage} from '@/lib/account/members';
import {memberCsv} from '@/lib/membership/csv';
export const dynamic='force-dynamic';
export const maxDuration=60;
export async function GET(request:Request){try{
 await ownerIdentity();
 const params=new URL(request.url).searchParams;
 const page=await memberPage(params);
 if(params.get('format')==='csv')return new Response(memberCsv([
  ['会員ID','表示名','メール','プラン','契約状況','金額','通貨','次回請求日','利用期限','確認状態'],
  ...page.items.map(row=>[row.id,row.displayName,row.email,row.plan??'確認できません',row.contract.status??'確認できません',row.contract.amount,row.contract.currency,row.contract.nextBillingAt,row.contract.accessExpiresAt,row.contract.verification])
 ]),{headers:{...accountHeaders,'Content-Type':'text/csv; charset=utf-8','Content-Disposition':'attachment; filename="tech-phase-members-page.csv"','X-Next-Cursor':page.nextCursor??''}});
 return reply(page);
}catch(e){return accountError(e);}}
