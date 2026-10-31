import {ownerAccessFromVerifiedAccount} from './owner-access.ts';
import { readPreferences } from "./preferences-data.ts";
import type { AlertRecipient } from "./notification-delivery.ts";

type ClerkUser={id?:unknown;banned?:boolean;locked?:boolean;primaryEmailAddressId?:unknown;
 emailAddresses?:{id?:unknown;emailAddress?:unknown;verification?:{status?:unknown}|null}[];publicMetadata?:unknown};
/** Re-read Clerk for every delivery; never take an address from a browser,
 * public metadata or the queued payload, and never fall back to a secondary email.
 * Per-channel opt-outs are rechecked from notification_settings by the sender.
 */
export function createClerkNotificationRecipient(client:{users:{getUser:(id:string)=>Promise<unknown>}},production=false) {
 return async(userId:string):Promise<AlertRecipient>=>{
  if(!/^user_[A-Za-z0-9]{1,128}$/.test(userId))throw new Error("Invalid recipient identity");
  const user=await client.users.getUser(userId) as ClerkUser|null;
  if(!user||user.id!==userId)throw new Error("Recipient identity mismatch");
  const preferences=readPreferences(user.publicMetadata);
  const primary=Array.isArray(user.emailAddresses)?user.emailAddresses.find(e=>e.id===user.primaryEmailAddressId):undefined;
  const email=primary?.emailAddress;
  const verified=!user.banned&&!user.locked&&typeof user.primaryEmailAddressId==="string"&&
   primary?.verification?.status==="verified"&&typeof email==="string"&&email.length<=320&&/^\S+@\S+\.\S+$/.test(email)&&!/[\r\n<>]/.test(email);
  const ownerAccess=ownerAccessFromVerifiedAccount(user,production);
  return {...(ownerAccess?{ownerAccess}:{}),userId,email:verified?email as string:"",verified,preferencesConfigured:preferences.configured,
   unsubscribed:false,locale:preferences.locale??"ja"};
 };
}
