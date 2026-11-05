import 'server-only';
import {auth,clerkClient} from '@clerk/nextjs/server';
import {getMembership} from '@/lib/membership/server';
import {isOwnerAccount} from '@/lib/membership/entitlements';
import {liveTransportConfig} from '@/services/tech-phase-billing/live-transport.mjs';
import {bounded} from '@/services/tech-phase-billing/transport.mjs';
import {unknownContract} from '@/services/tech-phase-billing/account-view.mjs';
import {selectedIcon} from './profile';
export const accountHeaders={'Cache-Control':'private, no-store',Vary:'Cookie','X-Content-Type-Options':'nosniff'};
export const reply=(value:unknown,status=200)=>Response.json(value,{status,headers:accountHeaders});
export async function accountIdentity(){const {userId}=await auth();if(!userId)throw Error('sign-in');return userId;}
export async function ownerIdentity(){const member=await getMembership();if(member.status!=='signed-in'||!member.isAdmin||!isOwnerAccount(member.userId))throw Error('owner-required');return member.userId;}
export async function readContract(userId:string){
 try{
  const config=liveTransportConfig(process.env);
  const response=await fetch(`${config.url}/live/account`,{headers:{Authorization:`Bearer ${config.token}`,'X-Tech-Phase-User':userId,Origin:config.origin},cache:'no-store',redirect:'error',signal:AbortSignal.timeout(25000)});
  if(!response.ok||!response.headers.get('content-type')?.startsWith('application/json')){await response.body?.cancel();return unknownContract();}
  const data=JSON.parse((await bounded(response.body,16384,'UPSTREAM_BODY_LIMIT'))?.toString('utf8')||'null');
  if(!data||!['verified','pending','unavailable'].includes(data.verification)||![null,'active','renewal-stopped','none'].includes(data.status))return unknownContract();
  return data;
 }catch{return unknownContract();}
}
export async function readProfile(userId:string){
 const user=await(await clerkClient()).users.getUser(userId);
 const member=await getMembership();
 if(member.status!=='signed-in'||member.userId!==userId)throw Error('account-unavailable');
 const owner=isOwnerAccount(user.id);
 return {displayName:[user.firstName,user.lastName].filter(Boolean).join(' '),email:user.emailAddresses.find(e=>e.id===user.primaryEmailAddressId)?.emailAddress??null,
  plan:owner?'owner':member.plan,ownerAccess:member.status==='signed-in'&&member.ownerMode,
  passwordEnabled:user.passwordEnabled,twoFactorEnabled:user.twoFactorEnabled,
  icon:selectedIcon(user.privateMetadata.accountIcon,owner),iconEditable:!owner,
  security:{url:'/research/account/security',provider:'clerk',canChangePassword:user.passwordEnabled,canDisableMfa:!owner}};
}
export function accountError(error:unknown){const code=error instanceof Error?error.message:'';return reply({error:['sign-in','owner-required','invalid-input','owner-icon-fixed'].includes(code)?code:'account-unavailable'},code==='sign-in'?401:code==='owner-required'||code==='owner-icon-fixed'?403:code==='invalid-input'?400:503);}
export async function input(request:Request){
 if(request.headers.get('origin')!==new URL(request.url).origin||request.headers.get('content-type')?.split(';')[0]!=='application/json')throw Error('owner-required');
 try{const bytes=await bounded(request.body,2048);return JSON.parse(bytes?.toString('utf8')||'null');}catch{throw Error('invalid-input');}
}
