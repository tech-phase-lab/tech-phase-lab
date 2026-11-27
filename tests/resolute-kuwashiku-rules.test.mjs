import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {shortRules,articleLink} from '../lib/resolute/plan-short-rules.ts';

const snapshot=(plan)=>({revision:1,plan:plan&&{answers:{q28:['cash_low','no_reason'],q29:['cant_sleep']},noBuyConditions:['決算発表の前日'],haltConditions:[],stopLossPct:15,...plan}});

test('くわしく panel: the member\'s own rules, shortest form, with the plan screen\'s labels; nothing without a saved plan',()=>{
 assert.deepEqual(shortRules(snapshot({}),'ja'),[
  {key:'noBuy',label:'買わない条件',text:'貯金が減ったとき / 買う理由を説明できないとき / 決算発表の前日'},
  {key:'halt',label:'立ち止まる条件',text:'眠れないほど不安なとき'},
  {key:'stopLoss',label:'損切りのライン',text:'−15%'}]);
 assert.deepEqual(shortRules(snapshot({}),'en').map(r=>r.label),['Conditions for holding off','Conditions for pausing','Exit line']);
 // A line with nothing set is left out; no plan → nothing.
 assert.deepEqual(shortRules(snapshot({answers:{},noBuyConditions:[],stopLossPct:null}),'ja'),[]);
 assert.deepEqual(shortRules({revision:0,plan:null},'ja'),[]);assert.deepEqual(shortRules(null,'ja'),[]);
 assert.equal(shortRules(snapshot({stopLossPct:12.5}),'ja')[2].text,'−12.5%');
});

test('くわしく panel: 「記事を読む →」 opens the story\'s source in a new tab; never for an owner-added story\'s placeholder link',async()=>{
 assert.equal(articleLink('https://www.reuters.com/markets/x'),'https://www.reuters.com/markets/x');
 assert.equal(articleLink('https://techphase.app/resolute/news'),null);
 assert.equal(articleLink('http://insecure.example/x'),null);assert.equal(articleLink('not a url'),null);
 const section=await readFile(new URL('../app/resolute/home/shock-section.tsx',import.meta.url),'utf8');
 assert.match(section,/href=\{link\} target="_blank" rel="noopener noreferrer"/);
 assert.match(section,/'記事を読む →'/);
 // The rules come from the plan this tab already loaded (no new read) and are not shown in a display sample.
 assert.match(section,/useRemembered<PlanSnapshot>\('plan'\)/);assert.match(section,/sample\?\[\]:shortRules\(plan,locale\)/);
});
