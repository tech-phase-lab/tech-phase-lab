import test from 'node:test';
import assert from 'node:assert/strict';
import {questions,emptyDiagnosisDraft,selectAnswer,draftToPlan,draftFromPlan,questionCopy,isQuestionVisible,questionNumber,QUESTION_TOTAL} from '../lib/resolute/diagnosis-form.ts';
import {emptyPlanAnswers,parsePlanAnswers,SUBSTITUTE_QUESTION_IDS} from '../lib/resolute/plan-answers.ts';
import {parsePlan,parsePlanSnapshot,parsePlanMutation} from '../lib/resolute/plan-data.ts';
import {notebookResult} from '../lib/resolute/plan-summary.ts';
import {rulebookChapters} from '../lib/resolute/rulebook.ts';
import {readPlanMutation} from '../lib/resolute/plan-http.ts';

// Owner, Nov 25: the diagnosis is always 30 questions; q21/q25/q26/q27 are replaced, never dropped.
const base={q01:'3to5',q02:'l25',q03:'stable',q04:'m6',q05:'m6',q06:'none',q07:'input',q08:'input',q09:'y10plus',q10:'rarely',
 q11:'p20',q12:'no',q13:'wait',q14:'never',q15:'hold',q16:'steady',q17:'monthly',q18:'weekly',q19:'never',q22:'p20',q23:'p10to30',
 q28:['cash_low'],q29:['over_tolerance'],q30:'ignore'};
function draft(over) {const d=emptyDiagnosisDraft();Object.assign(d.answers,base,over);d.numbers={q07:'10000000',q08:'3000000'};return d;}
const visible=a=>questions.filter(q=>isQuestionVisible(q.id,a));
const stamped=p=>({...p,createdAt:'2026-10-12T00:00:00.000Z',updatedAt:'2026-10-12T00:00:00.000Z'});

test('every path asks exactly 30 questions, from the first question to the last',()=>{
 assert.equal(QUESTION_TOTAL,30);
 for(const q20 of [null,'fund_etf','stock','bond','gold','mixed'])for(const q24 of [null,'none','single','steps2','steps3','steps4']){
  const shown=visible({...emptyPlanAnswers(),q20,q24});
  assert.equal(shown.length,30,`${q20}/${q24}`);
  // Each slot keeps its number whichever question of the pair is asked.
  for(const [index,q] of shown.entries())assert.equal(q.id.slice(0,3),questionNumber(index).toLowerCase());
 }
 assert.deepEqual(visible({...emptyPlanAnswers(),q20:'bond',q24:'none'}).map(q=>q.id).filter(id=>id.endsWith('alt')),['q21alt','q25alt','q26alt','q27alt']);
 assert.deepEqual(visible({...emptyPlanAnswers(),q20:'gold',q24:'single'}).map(q=>q.id).filter(id=>id.endsWith('alt')),['q21alt','q27alt']);
 assert.deepEqual(visible({...emptyPlanAnswers(),q20:'stock',q24:'steps2'}).map(q=>q.id).filter(id=>id.endsWith('alt')),[]);
});

test('substitute questions have the agreed JA and EN copy',()=>{
 const ja=id=>questionCopy(questions.find(q=>q.id===id),'ja'),en=id=>questionCopy(questions.find(q=>q.id===id),'en');
 assert.equal(ja('q21alt').text,'どんな商品が多い？');
 assert.deepEqual(ja('q21alt').options.map(o=>o.label),['全世界・米国のインデックス','高配当ETF','債券','金','半導体などのテーマ型','その他']);
 assert.equal(ja('q25alt').text,'下落中も積み立ては続ける？');assert.deepEqual(ja('q25alt').options.map(o=>o.label),['続ける','いったん止める','積み立てはしていない']);
 assert.equal(ja('q26alt').text,'大きく上がったとき利益を確定する目安は？');assert.deepEqual(ja('q26alt').options.map(o=>o.label),['+20%','+30%','+50%','決めていない']);
 assert.equal(ja('q27alt').text,'売ることを考えるのは何%下がったとき？');assert.deepEqual(ja('q27alt').options.map(o=>o.label),['−20%','−30%','−50%','売らない']);
 for(const id of SUBSTITUTE_QUESTION_IDS){assert.ok(en(id).text);assert.equal(en(id).options.length,ja(id).options.length);
  assert.ok(!/[぀-ヿ一-鿿]/u.test(en(id).text+en(id).options.map(o=>o.label).join('')));}
});

test('substitute answers are saved with the plan and round-trip through the plan API body',async()=>{
 const p=draftToPlan(draft({q20:'fund_etf',q21alt:['index','gold'],q24:'none',q25alt:'continue',q26alt:'p30',q27alt:'d30'}));
 assert.deepEqual(p.answers.q21alt,['index','gold']);assert.equal(p.answers.q25alt,'continue');assert.equal(p.answers.q26alt,'p30');assert.equal(p.answers.q27alt,'d30');
 assert.deepEqual(parsePlan(p),p);
 assert.deepEqual(parsePlanSnapshot({plan:stamped(p),revision:3}).plan,stamped(p));
 const body=JSON.stringify({plan:p,baseRevision:2});
 const request=new Request('https://example.test/internal/v1/plan',{method:'PUT',headers:{'content-type':'application/json'},body});
 assert.deepEqual((await readPlanMutation(request,'PUT')).plan,p);
 assert.deepEqual(draftFromPlan(p).answers.q21alt,['index','gold']);
 // An unanswered substitute is required before the result.
 assert.throws(()=>draftToPlan(draft({q20:'bond',q21alt:['bond'],q24:'none',q25alt:'pause',q26alt:'p20'})),/ANSWER_REQUIRED/);
});

test('plans saved before the substitute questions existed stay readable and are served exactly as stored',()=>{
 const old=draftToPlan(draft({q20:'stock',q21:['tech_semis'],q24:'steps3',q25:'d10',q26:'b5',q27:'equal'}));
 assert.equal(Object.keys(old.answers).length,30);assert.deepEqual(parsePlan(old),old);
 // The shape stored before Nov 25 for a member who skipped q21/q25/q26/q27: 30 answers, no substitutes.
 const legacy=draftToPlan(draft({q20:'fund_etf',q21alt:['index'],q24:'none',q25alt:'continue',q26alt:'p20',q27alt:'d20'}));
 for(const id of SUBSTITUTE_QUESTION_IDS)delete legacy.answers[id];
 const parsed=parsePlan(legacy);assert.deepEqual(parsed,legacy);assert.equal(Object.keys(parsed.answers).length,30);
 assert.equal(parsePlanMutation('PUT',{plan:legacy,baseRevision:1}).plan.answers.q21alt,undefined);
 // An old plan still opens in My Rules and the book without substitute lines.
 assert.equal(notebookResult(legacy,'ja').rows.length,7);assert.ok(rulebookChapters(legacy,'en').length>0);
 // Re-taking the diagnosis from an old plan asks only for the substitutes it never answered.
 const d=draftFromPlan(stamped(legacy));
 assert.deepEqual(visible(d.answers).filter(q=>d.answers[q.id]==null&&!q.multi).map(q=>q.id),['q25alt','q26alt','q27alt']);
});

test('substitute answers are validated against the question that decides them',()=>{
 const e=emptyPlanAnswers();
 for(const patch of [{q20:'stock',q21alt:['index']},{q21alt:['index']},{q24:'single',q25alt:'continue'},{q24:'steps2',q26alt:'p20'},
  {q24:'steps2',q27alt:'d20'},{q24:null,q27alt:'never'},{q20:'bond',q21alt:[]},{q20:'bond',q21alt:'index'},{q24:'none',q25alt:'later'},{q21x:null}])
  assert.throws(()=>parsePlanAnswers({...e,...patch}),/INVALID_PLAN_ANSWERS/);
 assert.equal(parsePlanAnswers({...e,q24:'single',q27alt:'never'}).q27alt,'never');
 // Explicit nulls are not stored: only answered substitutes are kept.
 assert.deepEqual(Object.keys(parsePlanAnswers({...e,q21alt:null,q25alt:null})),Object.keys(e));
});

test('changing an answer that swaps a question clears only the swapped-out answer',()=>{
 let d=draft({q20:'stock',q21:['tech_semis'],q24:'steps3',q25:'d10',q26:'b5',q27:'equal'});
 d=selectAnswer(d,'q20','gold');
 assert.equal(d.answers.q21,null);assert.equal(d.answers.q21alt,undefined);
 assert.equal(d.answers.q25,'d10');assert.equal(d.answers.q22,'p20');assert.deepEqual(d.answers.q28,['cash_low']);
 d=selectAnswer(d,'q24','single');
 assert.equal(d.answers.q27,null);assert.equal(d.answers.q25,'d10');assert.equal(d.answers.q26,'b5');
 assert.deepEqual(visible(d.answers).filter(q=>d.answers[q.id]==null).map(q=>q.id),['q21alt','q27alt']);
 d=selectAnswer(selectAnswer(d,'q21alt',['theme']),'q27alt','d50');
 const p=draftToPlan(d);assert.equal(p.answers.q27alt,'d50');assert.deepEqual(p.answers.q21alt,['theme']);
 // Swapping back removes the substitute answer rather than saving a hidden one.
 d=selectAnswer(d,'q24','steps2');assert.equal(d.answers.q27alt,undefined);
});

test('My Rules, the book and the result rows include the substitute answers in JA and EN',()=>{
 const p=stamped(draftToPlan(draft({q20:'fund_etf',q21alt:['index'],q24:'none',q25alt:'pause',q26alt:'p50',q27alt:'never'})));
 const ja=notebookResult(p,'ja').rows.slice(7),en=notebookResult(p,'en').rows.slice(7);
 assert.deepEqual(ja.map(r=>r.rule),['全世界・米国のインデックス','下落中は積み立てをいったん止める','50%上がったら利益確定を考える','下落では売らない']);
 assert.equal(en.length,4);assert.ok(en.every(r=>!/[぀-ヿ一-鿿]/u.test(r.item+r.rule+r.meaning)));
 const book=JSON.stringify(rulebookChapters(p,'ja'));
 for(const text of ['全世界・米国のインデックス','下落中は積み立てをいったん止める','50%上がったら利益確定を考える','下落では売らない'])assert.ok(book.includes(text),text);
 const enBook=JSON.stringify(rulebookChapters(p,'en'));assert.ok(enBook.includes('Consider taking profits after a 50% rise'));
});
