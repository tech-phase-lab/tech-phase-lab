import 'server-only';
import {clerkClient} from '@clerk/nextjs/server';
import {isOwnerAccount} from '@/lib/membership/entitlements';
import {readContract} from './server';
/** Cursor scans identity matches, not filtered matches. Empty pages may have a next cursor. */
export async function memberPage(params:URLSearchParams){
 const query=(params.get('q')??'').trim(),filter=params.get('plan')??'all',cursor=params.get('cursor')??'0';
 if(query.length>120||!['all','free','pro','owner'].includes(filter)||!/^\d{1,7}$/.test(cursor))throw Error('invalid-input');
 const offset=Number(cursor),limit=10;
 const {data,totalCount}=await(await clerkClient()).users.getUserList({query:query||undefined,limit,offset,orderBy:'+created_at'});
 const rows=[];
 // Bound provider concurrency; do not enumerate the full identity directory per request.
 for(let i=0;i<data.length;i+=5){
  const batch=await Promise.all(data.slice(i,i+5).map(async user=>{
   const contract=await readContract(user.id),owner=isOwnerAccount(user.id);
   const plan=owner?'owner':contract.accessPlan??(contract.status==='none'?'free':null);
   return {id:user.id,displayName:[user.firstName,user.lastName].filter(Boolean).join(' '),email:user.emailAddresses.find(e=>e.id===user.primaryEmailAddressId)?.emailAddress??null,plan,contract};
  }));rows.push(...batch);
 }
 return {items:rows.filter(row=>filter==='all'||row.plan===filter),nextCursor:offset+data.length<totalCount?String(offset+data.length):null,
  scanned:data.length,unverified:rows.filter(row=>row.plan===null).length,filterScope:'scanned-page'};
}
