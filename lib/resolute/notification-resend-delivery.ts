import type { Pool } from "pg";
import { createAlertDelivery } from "./notification-delivery.ts";
import { createResendAlertProvider, resendOutboxEvidence } from "./notification-resend.ts";
import { createClerkNotificationRecipient } from "./notification-recipient.ts";
import { createMailStopTokens, mailStopLinks } from "./notification-stop-token.ts";

/** Explicit composition only. No startup/cron/config changes or implicit sends.
 * Production enablement also needs domain verification, a working public stop
 * endpoint and scoped worker permissions. A provider receipt is not inbox proof.
 */
export function createResendAlertDelivery(pool:Pick<Pool,"connect">,options:{
 enabled?:boolean;apiKey:string;from:string;publicOrigin:string;stopKey:Buffer;
 clerk:Parameters<typeof createClerkNotificationRecipient>[0];request?:typeof fetch;now?:()=>Date;
}) {
 const now=options.now??(()=>new Date());
 return async(userId:string,key:string,mode:"send"|"reconcile"="send")=>{
  if(!options.enabled)return "disabled";
  const tokens=createMailStopTokens(options.stopKey,()=>now().getTime());
  const recipient=createClerkNotificationRecipient(options.clerk);let locale:"ja"|"en"="ja";
  const deliver=createAlertDelivery(pool,{enabled:true,now,publicOrigin:options.publicOrigin,
   recipient:async id=>{const result=await recipient(id);locale=result.locale;return result;},
   links:async id=>mailStopLinks(options.publicOrigin,tokens,id,locale),
   provider:(client,id)=>createResendAlertProvider({apiKey:options.apiKey,from:options.from,enabled:true},resendOutboxEvidence(client,id),options.request,now),
  });
  return deliver(userId,key,mode);
 };
}
