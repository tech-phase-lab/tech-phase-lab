export const accountIcons = ['initial','rocket','chart','diamond','crown','bolt','fire','moon','sun','wave','mountain','compass','shield','anchor','target','eagle','bull','bear','lion','dragon','robot','brain','telescope','coin'] as const;
import {THEME_IDS} from '@/lib/research/favorite-themes';
export function profileInput(value: unknown, owner: boolean): {displayName?:string;icon?:string;themes?:string[]} {
 if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('invalid-input');
 const body=value as Record<string,unknown>, keys=Object.keys(body);
 if(!keys.length||keys.some(k=>!['displayName','icon','themes'].includes(k)))throw Error('invalid-input');
 const result: {displayName?:string;icon?:string;themes?:string[]}={};
 if('themes' in body){
  const list=body.themes;
  if(!Array.isArray(list)||list.length>THEME_IDS.length||list.some(id=>typeof id!=='string'||!THEME_IDS.includes(id)))throw Error('invalid-input');
  result.themes=THEME_IDS.filter(id=>(list as string[]).includes(id));
 }
 if('displayName' in body){
  if(typeof body.displayName!=='string')throw Error('invalid-input');
  const name=body.displayName.trim();
  if(!name||[...name].length>60||/[\u0000-\u001f\u007f-\u009f]/u.test(name))throw Error('invalid-input');
  result.displayName=name;
 }
 if('icon' in body){
  if(owner)throw Error('owner-icon-fixed');
  if(typeof body.icon!=='string'||!accountIcons.some(i=>i===body.icon))throw Error('invalid-input');
  result.icon=body.icon;
 }
 return result;
}
export function selectedIcon(value:unknown, owner:boolean){return owner?'owner':accountIcons.some(i=>i===value)?String(value):'initial';}
