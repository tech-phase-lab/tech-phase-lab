/** Owner-decided RIZEL rewrites (server only). The texts live in the private environment variable
 * RESOLUTE_RIZEL_OWNER_REWRITES_JSON, never in the repository: {"<copy id>":{"ja":"...","en":"..."}}.
 * Logs carry fixed codes (and a well-formed copy id) only, never the texts.
 */
import {rizelCopyIssues} from './risk-copy-check.ts';
export type Locale='ja'|'en';
export type OwnerRewrites=Readonly<Record<string,Readonly<Record<Locale,string>>>>;
export const OWNER_REWRITE_ISSUE='owner-rewrite';
const ID=/^[A-D]-[a-z-]+-\d{2}$/;
type Warn=(line:string)=>void;
const warning=(warn:Warn,reason:string,extra:Record<string,unknown>={})=>warn(JSON.stringify({event:'RESOLUTE_RIZEL_OWNER_REWRITE_IGNORED',reason,...extra}));
/** Malformed input → empty list. An entry is ignored as a whole when either text is invalid or fails the copy check. */
export function parseOwnerRewrites(raw:unknown,warn:Warn=console.warn):OwnerRewrites{
 if(raw===undefined||raw===null||raw==='')return {};
 let value:unknown;
 try{value=typeof raw==='string'?JSON.parse(raw):raw;}catch{warning(warn,'invalid-json');return {};}
 if(!value||typeof value!=='object'||Array.isArray(value)){warning(warn,'invalid-shape');return {};}
 const out:Record<string,Readonly<Record<Locale,string>>>={};
 for(const [id,entry] of Object.entries(value as Record<string,unknown>)){
  if(!ID.test(id)){warning(warn,'invalid-id');continue;}
  const e=entry as Record<string,unknown>|null;
  if(!e||typeof e!=='object'||Array.isArray(e)){warning(warn,'invalid-entry',{id});continue;}
  const bad=(['ja','en'] as const).find(l=>typeof e[l]!=='string'||!(e[l] as string).trim()||(e[l] as string).length>1000);
  if(bad){warning(warn,'invalid-text',{id,locale:bad});continue;}
  const codes=(['ja','en'] as const).flatMap(l=>rizelCopyIssues(e[l] as string));
  if(codes.length){warning(warn,'copy-check',{id,codes:[...new Set(codes)]});continue;}
  out[id]=Object.freeze({ja:e.ja as string,en:e.en as string});
 }
 return Object.freeze(out);
}
let cache:{raw:string|undefined;value:OwnerRewrites}|null=null;
/** Reads the environment once per distinct value (warnings are not repeated on every request). */
export function ownerRewrites(env:Record<string,string|undefined>=process.env):OwnerRewrites{
 const raw=env.RESOLUTE_RIZEL_OWNER_REWRITES_JSON;
 if(!cache||cache.raw!==raw)cache={raw,value:parseOwnerRewrites(raw)};
 return cache.value;
}
/** Owner rewrite for this locale while the approved text still differs from it; null when there is none or it already matches. */
export function pendingOwnerRewrite(e:{id:string;text:string;english?:{text:string}},locale:Locale,rewrites:OwnerRewrites=ownerRewrites()){
 const target=Object.hasOwn(rewrites,e.id)?rewrites[e.id][locale]:undefined;
 if(target===undefined)return null;
 return (locale==='ja'?e.text:e.english?.text)===target?null:target;
}
