import {clerkClient} from '@clerk/nextjs/server';
import {accountIdentity,readProfile,reply,accountError,input} from '@/lib/account/server';
import {profileInput} from '@/lib/account/profile';
import {isOwnerAccount} from '@/lib/membership/entitlements';
export const dynamic='force-dynamic';
export async function GET(){try{return reply(await readProfile(await accountIdentity()));}catch(e){return accountError(e);}}
export async function PATCH(request:Request){try{
 const userId=await accountIdentity(),value=profileInput(await input(request),isOwnerAccount(userId));
 const client=await clerkClient();
 if(value.displayName!==undefined)await client.users.updateUser(userId,{firstName:value.displayName,lastName:''});
 if(value.icon!==undefined)await client.users.updateUserMetadata(userId,{privateMetadata:{accountIcon:value.icon}});
 return reply(await readProfile(userId));
}catch(e){return accountError(e);}}
