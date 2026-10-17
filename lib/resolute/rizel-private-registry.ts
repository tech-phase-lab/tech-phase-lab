import {createHash} from 'node:crypto';
import type {CopyEntry} from './rizel-selection';
export const RIZEL_LAYOUT_IDS=['A','B','C'].flatMap(group=>[`${group}-conclusion-01`,...['01','02','03'].map(n=>`${group}-reason-${n}`)]);
/** Validates exact approved text without copying it into public source files. */
export function parsePrivateRizelRegistry(raw:string,layoutOnly=false):CopyEntry[] {
 if(raw.length>200000)throw Error('INVALID_PRIVATE_BANK');
 const bank=JSON.parse(raw);
 const expected=layoutOnly?12:90;
 if(!Array.isArray(bank.entries)||bank.entries.length!==expected)throw Error('INVALID_PRIVATE_BANK');
 for(const e of bank.entries){
  if(!e||!e.english)throw Error('INVALID_PRIVATE_BANK');
  for(const [text,hash] of [[e.text,e.textSha256],[e.english.text,e.english.textSha256]])
   if(typeof text!=='string'||createHash('sha256').update(text).digest('hex')!==hash)throw Error('INVALID_PRIVATE_BANK');
  if(e.approval!=='approved'||e.english.approval!=='approved'||e.publication!=='withheld'||e.english.publication!=='withheld'||e.id==='D-executive-03'||layoutOnly&&!RIZEL_LAYOUT_IDS.includes(e.id))throw Error('INVALID_PRIVATE_BANK');
 }
 if(new Set(bank.entries.map((e:CopyEntry)=>e.id)).size!==expected)throw Error('INVALID_PRIVATE_BANK');
 return bank.entries;
}
