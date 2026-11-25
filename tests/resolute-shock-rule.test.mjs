// Owner, Nov 25: on a shaken day the home Shock Gauge card shows the member's OWN saved rules, never made-up advice.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {shockRuleView,shockRules} from '../lib/resolute/shock-rule.ts';
import {createReviewSamplePlan} from '../lib/resolute/review-sample.ts';

const plan=createReviewSamplePlan();
test('★1–2: nothing; ★3: one of the member\'s rules; ★4–5: two, prominently',()=>{
 assert.deepEqual(shockRuleView(plan,null,'ja'),{kind:'quiet'});
 assert.deepEqual(shockRuleView(plan,2,'ja'),{kind:'quiet'});
 const three=shockRuleView(plan,3,'ja');assert.equal(three.kind,'rules');assert.equal(three.prominent,false);assert.equal(three.lines.length,1);
 const five=shockRuleView(plan,5,'ja');assert.equal(five.prominent,true);
 assert.deepEqual(five.lines,['手を止めるとき：許容できる下落を超えたとき → 新しく買うのをやめて、ルールを読み直します',`許容できる下落（−${plan.tolerancePct}%）：投資額が90万円減ったら、ルールを読み直す目安です。生活費3.6か月分にあたります`]);
 assert.match(shockRuleView(plan,5,'en').lines[0],/^Pause and reconsider: .+ → Stop new purchases and review your rules\.$/);
});
test('only rules the member saved: pause conditions, loss limit, exit level; none set → a prompt to set one',()=>{
 const bare={...plan,answers:{...plan.answers,q29:[]},haltConditions:[],tolerancePct:null,toleranceDrop:null};
 assert.deepEqual(shockRules(bare,'ja'),[]);
 assert.deepEqual(shockRuleView(bare,5,'ja'),{kind:'missing',prominent:true});assert.deepEqual(shockRuleView(null,3,'ja'),{kind:'missing',prominent:false});
 assert.deepEqual(shockRules({...bare,stopLossPct:15},'ja'),['損切りのルール：自分で決めた損切りラインは −15%']);
 assert.deepEqual(shockRules({...bare,haltConditions:['NVDAが決算で売上見通しを下げたとき']},'ja'),['手を止めるとき：NVDAが決算で売上見通しを下げたとき → 新しく買うのをやめて、ルールを読み直します']);
});
test('home card: one-line name, 「詳細 →」, the member\'s rules instead of 「ルールを読み返す」',()=>{
 const home=readFileSync(new URL('../app/resolute/home/screen.tsx',import.meta.url),'utf8');
 assert.ok(home.includes("<ShockGaugeTitle locale={locale} compact/>"));assert.ok(home.includes("{en?'Details →':'詳細 →'}"));
 assert.ok(!home.includes('件すべて見る')&&!home.includes('ルールを読み返す'));
 assert.ok(home.includes("<Link href=\"/resolute/diagnosis\">{en?'Set your rules →':'ルールを決める →'}</Link>"));
 const gauge=readFileSync(new URL('../app/resolute/features/shock-gauge.tsx',import.meta.url),'utf8');
 assert.match(gauge,/flexWrap:'wrap-reverse'[^]*whiteSpace:'nowrap'\}\}>\{SHOCK_GAUGE_NAME\.ja\}/);
});
