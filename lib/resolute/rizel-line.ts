import {isOwnerAccount} from '../membership/entitlements.ts';
/** RIZELの一言 on the members' Shock Gauge (go-live audit, Nov 25). The approved lines in the feed reach members only once the
 * owner has confirmed the lawyer-reviewed wording (#671) and set RESOLUTE_RIZEL_LINE_PUBLISHED=true on the web app (default off).
 * Owner accounts always see them. Applied in the frontend proxy, so it holds whichever resolute-api version is running. */
type Env=Record<string,string|undefined>;
export function rizelLinePublished(userId:string,env:Env=process.env){return isOwnerAccount(userId)||env.RESOLUTE_RIZEL_LINE_PUBLISHED==='true';}
export function withRizelLine(body:unknown,userId:string,env:Env=process.env):unknown{
 if(rizelLinePublished(userId,env)||!body||typeof body!=='object'||!Array.isArray((body as {quotes?:unknown}).quotes))return body;
 return {...body,quotes:[]};
}
