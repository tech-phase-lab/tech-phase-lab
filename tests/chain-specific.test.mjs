import test from 'node:test';
import assert from 'node:assert/strict';
import {candidatesFromSource,concreteJapanese,independentQuote} from '../scripts/chain/specific.mjs';
const issuer={id:'BE',name:'Bloom Energy',aliases:['Bloom'],cik:1};
const other={id:'ORCL',name:'Oracle',aliases:['Oracle'],cik:2};
const universe=new Map([[issuer.id,issuer],[other.id,other]]);
const source=body=>({url:'https://bloom.example/news/a',date:'2026-01-01',body});
const rows=(body,extra={})=>candidatesFromSource({source:source(body),issuer,universe,...extra});
test('specific description preserves quantity, product, and action',()=>{
 const [r]=rows('Bloom Energy and Oracle partner to deploy up to 2.8 GW of fuel cells.');
 assert.equal(r.text_ja,'ORCLと最大2.8GW燃料電池の導入');assert.deepEqual(r.reasons,[]);
});
test('generic partnership stays a reported rejection',()=>{
 const [r]=rows('Bloom Energy and Oracle announced a strategic partnership.');
 assert.equal(r.text_ja,null);assert.deepEqual(r.reasons,['specific_fact_missing']);
});
test('quotes are complete exact sentences and long claims are rejected rather than truncated',()=>{
 const q='Bloom Energy and Oracle partner to develop '+ 'advanced '.repeat(25)+'fuel cells.';
 const [r]=rows(q);assert.equal(r.evidence_quote,null);assert.ok(r.reasons.includes('complete_quote_over_200'));
});
test('source mentions without an explicit relationship are not claims',()=>assert.deepEqual(rows('Bloom Energy had a great quarter. Oracle reported growth.'),[]));
test('vendor direction must be supported by the clause',()=>{
 assert.equal(rows('Bloom Energy supplies fuel cells to Oracle.')[0].type,'納入・採用先');
 assert.equal(rows('Oracle supplies fuel cells to Bloom Energy.')[0].type,'供給・採用元');
 assert.ok(rows('Bloom Energy and Oracle announced an agreement for fuel cells.')[0].reasons.includes('relationship_direction_unproven'));
});
test('competition requires own 10-K Competition section',()=>{
 const q='Bloom Energy competes with Oracle in cloud services.';
 assert.ok(rows(q)[0].reasons.includes('competition_not_own_10k_section'));
 const [r]=rows(q,{source:{...source(q),competition:[q]},filing:{form:'10-K',cik:1,date:'2026-01-01'}});
 assert.equal(r.type,'競合');assert.equal(r.text_ja,'ORCLとクラウドで競合');assert.deepEqual(r.reasons,[]);
});
test('investment without a confirmed subject and recipient fails closed',()=>assert.equal(concreteJapanese('Bloom Energy announces a $1 billion investment with Oracle.',other,'提携・出資・技術対応'),null));
test('product without action or partnership is not enough',()=>assert.equal(concreteJapanese('Bloom Energy and Oracle discuss fuel cells.',other,'提携・出資・技術対応'),null));
test('a terminated partnership is not published as a live relationship',()=>assert.ok(rows('Bloom Energy and Oracle terminated their fuel cell partnership.')[0].reasons.includes('relationship_negated_or_ended')));
test('a complete independent clause can be quoted exactly from a long sentence',()=>{
 const clause='Bloom Energy and Oracle partner to deploy fuel cells';
 const q='The announcement provides extensive background about global computing markets and changing infrastructure demands across many different countries and regions; '+clause+'.';
 assert.equal(independentQuote(q,issuer,other),clause+'.');
 assert.equal(rows(q)[0].evidence_quote,clause+'.');
});
test('abstract product partnership alone is not a concrete description',()=>assert.equal(concreteJapanese('Bloom Energy and Oracle partner on cloud solutions.',other,'提携・出資・技術対応'),null));
test('investment direction uses an explicit grammatical subject and recipient',()=>assert.equal(concreteJapanese('Oracle invested $2 billion in Bloom Energy.',other,'提携・出資・技術対応',issuer),'ORCLがBEに20億ドル出資'));
test('money unrelated to the investment is not translated as invested capital',()=>assert.equal(concreteJapanese('Oracle invested in Bloom Energy, whose annual revenue exceeds $2 billion.',other,'提携・出資・技術対応',issuer),null));
test('a multi-company list is retained as an ambiguous rejection',()=>{
 const third={id:'NVDA',name:'NVIDIA',aliases:['NVIDIA']};
 const r=rows('Bloom Energy and Oracle partner to deploy NVIDIA GPUs.',{universe:new Map([...universe,[third.id,third]])});
 assert.ok(r.every(x=>x.reasons.includes('multi_party_scope_unproven')));
});
test('conditional investment is retained but not accepted',()=>assert.ok(rows('Oracle might invest $2 billion in Bloom Energy.')[0].reasons.includes('conditional_claim')));
test('visible concise heading remains usable when normalized body joins paragraphs',()=>{
 const heading='Bloom Energy and Oracle partner to deploy up to 2.8 Gigawatts of fuel cells';
 const body=heading+' October 1, 2026 '+'Background '.repeat(30)+'.';
 const result=rows(body,{source:{...source(body),html:`<article><h1>${heading}</h1><p>${'Background '.repeat(30)}.</p></article>`}});
 const accepted=result.find(r=>r.reasons.length===0);
 assert.equal(accepted.evidence_quote,heading);assert.equal(accepted.text_ja,'ORCLと最大2.8GW燃料電池の導入');
 assert.ok(result.some(r=>r.reasons.includes('complete_quote_over_200')));
});
test('heading absent from extracted body cannot become evidence',()=>{
 const heading='Bloom Energy and Oracle partner to deploy fuel cells';
 assert.deepEqual(rows('Unrelated body.',{source:{...source('Unrelated body.'),html:`<h1>${heading}</h1>`}}),[]);
});
test('navigation heading cannot become a source claim',()=>{
 const heading='Bloom Energy and Oracle partner to deploy fuel cells';
 const body=heading+' '+ 'Background '.repeat(30)+'.';
 const result=rows(body,{source:{...source(body),html:`<nav><h2>${heading}</h2></nav>`}});
 assert.ok(result.every(r=>r.reasons.length>0));
});
test('spelled-out megawatts preserve the stated capacity',()=>assert.equal(concreteJapanese('Bloom Energy and Oracle partner to deploy 100 megawatts of fuel cells.',other,'提携・出資・技術対応'),'ORCLと100MW燃料電池の導入'));
const nvda={id:'NVDA',name:'NVIDIA',aliases:['NVIDIA']};
const realRow=(q,from,to)=>candidatesFromSource({source:source(q),issuer:from,universe:new Map([from,to].map(c=>[c.id,c]))});
test('CEO praise of another company investment is not a bilateral relationship',()=>{
 const mu={id:'MU',name:'Micron',aliases:['Micron']},qcom={id:'QCOM',name:'Qualcomm Incorporated',aliases:['Qualcomm']};
 const q='Cristiano Amon, President and CEO, Qualcomm Incorporated “Micron’s investment in U.S.-based memory manufacturing is a significant milestone for the semiconductor industry.';
 assert.ok(realRow(q,mu,qcom).every(r=>r.reasons.length>0));
});
test('collaborative robot is an adjective, not company collaboration',()=>{
 const amzn={id:'AMZN',name:'Amazon',aliases:['Amazon Robotics']};
 const q='Agility Robotics, Amazon Robotics, Figure and Skild AI build America’s collaborative robot workforce using NVIDIA’s three-computer architecture.';
 assert.ok(realRow(q,nvda,amzn).every(r=>r.reasons.length>0));
});
test('memory advancement does not become AI factory manufacturing',()=>{
 const sk={id:'SKHY',name:'SK hynix',aliases:['SK hynix']};
 const q='NVIDIA and SK hynix today announced a multiyear technology partnership to advance next-generation memory for the global AI factory buildout and accelerate semiconductor design and manufacturing.';
 const [r]=realRow(q,nvda,sk);assert.deepEqual(r.reasons,[]);assert.equal(r.text_ja,'SKHYと次世代メモリー技術開発で複数年提携');
});
test('GPU monitoring software is not described as GPU hardware deployment',()=>{
 const nebius={id:'NBIS',name:'Nebius',aliases:['Nebius']};
 const q='Fleet management: Optimizing Nebius’s holistic fleet health by deploying NVIDIA’s latest GPU health monitoring and software recommendations.';
 const [r]=realRow(q,nvda,nebius);assert.deepEqual(r.reasons,[]);assert.equal(r.text_ja,'NBISとGPU健全性監視・ソフト推奨を導入');
});
test('intended infrastructure deployment preserves maximum capacity and planned status',()=>{
 const iren={id:'IREN',name:'IREN',aliases:['IREN']};
 const q='As part of the partnership: NVIDIA and IREN intend to support deployment of up to 5 gigawatts of NVIDIA DSX-aligned AI infrastructure across IREN’s global data center pipeline over time.';
 const [r]=realRow(q,nvda,iren);assert.deepEqual(r.reasons,[]);assert.equal(r.text_ja,'IRENと最大5GWAI基盤の導入を計画');
});
test('investment in progress and future investment preserve actor and future status',()=>{
 const lite={id:'LITE',name:'Lumentum',aliases:['Lumentum']};
 for(const [tense,suffix]of [['is investing',''],['will invest','予定']]){
 const [r]=realRow(`NVIDIA ${tense} $2 billion in Lumentum.`,nvda,lite);
 assert.deepEqual(r.reasons,[]);assert.equal(r.text_ja,'NVDAがLITEに20億ドル出資'+suffix);
 }
});
test('at least capacity is not silently changed into exact capacity',()=>{
 const openai={id:'OpenAI',name:'OpenAI',aliases:['OpenAI']};
 assert.equal(concreteJapanese('NVIDIA and OpenAI partner to deploy at least 10 gigawatts of NVIDIA systems.',openai,'提携・出資・技術対応',nvda),'OpenAIと10GW以上システムの導入');
});
test('BE partnership heading preserves scale without inventing fuel-cell wording',()=>{
 const q='Bloom Energy and Oracle Expand Strategic Partnership to Deploy up to 2.8 GW to Accelerate AI Infrastructure Build-Out';
 const [r]=rows(q);assert.deepEqual(r.reasons,[]);assert.equal(r.text_ja,'ORCLと最大2.8GW導入でAI基盤拡張');
});
test('partnership financial scale is not rewritten as a completed investment',()=>{
 const bam={id:'BAM',name:'Brookfield',aliases:['Brookfield']};
 const q='Brookfield and Bloom Energy Announce $5 Billion Strategic AI Infrastructure Partnership';
 const [r]=realRow(q,issuer,bam);assert.deepEqual(r.reasons,[]);assert.equal(r.text_ja,'BAMと50億ドル規模のAI基盤提携');
});
test('adopting ones own fuel cells to power a customer is not buying from that customer',()=>{
 const nebius={id:'NBIS',name:'Nebius',aliases:['Nebius']};
 const q='and Bloom Energy today announced an agreement to deploy Bloom’s fuel cell technology to help power Nebius’s AI infrastructure build-out.';
 const [r]=realRow(q,issuer,nebius);assert.ok(r.reasons.includes('relationship_direction_unproven'));
});
test('a first-party filing bullet can identify the implied actor, other filings cannot',()=>{
 const openai={id:'OpenAI',name:'OpenAI',aliases:['OpenAI']},origin={...nvda,cik:1};
 const q='•Announced a strategic partnership with OpenAI to deploy at least 10 gigawatts of NVIDIA systems for OpenAI’s next-generation AI infrastructure.';
 const context={source:source(q),issuer:origin,universe:new Map([origin,openai].map(c=>[c.id,c]))};
 assert.deepEqual(candidatesFromSource({...context,filing:{cik:1,form:'8-K'}})[0].reasons,[]);
 assert.ok(candidatesFromSource({...context,filing:{cik:2,form:'8-K'}})[0].reasons.includes('relationship_direction_unproven'));
});
test('sovereign AI stack delivery is grounded in the action and object',()=>{
 const nbis={id:'NBIS',name:'Nebius',aliases:['Nebius']},pltr={id:'PLTR',name:'Palantir',aliases:['Palantir']};
 const q='Palantir and Nebius partner to deliver a complete sovereign AI stack to Palantir customers';
 const [r]=realRow(q,nbis,pltr);assert.deepEqual(r.reasons,[]);assert.equal(r.text_ja,'PLTRと主権AI基盤の提供');
});
test('database migration is derived from a complete migration phrase',()=>{
 const oracle={id:'ORCL',name:'Oracle',aliases:['Oracle']},amazon={id:'AMZN',name:'Amazon',aliases:['Amazon Web Services','AWS']};
 const q='Oracle and Amazon Web Services (AWS) also signed an expanded, long-term strategic collaboration agreement focused on accelerating customer migration to Oracle AI Database@AWS.';
 const [r]=realRow(q,oracle,amazon);assert.deepEqual(r.reasons,[]);assert.equal(r.text_ja,'AMZNとDatabase@AWSへの移行促進');
 assert.equal(concreteJapanese('Oracle and AWS discuss migration and Oracle AI Database@AWS.',amazon,'提携・出資・技術対応',oracle),null);
});
test('equipment deployment spending preserves ceiling and plan without implying equity investment',()=>{
 const bam={id:'BAM',name:'Brookfield',aliases:['Brookfield']};
 const q='At the center of the new partnership, Brookfield will invest up to $5 billion to deploy Bloom’s advanced fuel cell technology.';
 const [r]=realRow(q,issuer,bam);
 assert.deepEqual(r.reasons,[]);assert.equal(r.text_ja,'BAMが最大50億ドルで燃料電池導入予定');
 assert.ok(!r.text_ja.includes('出資'));assert.ok(Array.from(r.text_ja).length<=30);
});
test('VMware AI Factory is a software platform, not a physical data center',()=>{
 const broadcom={id:'AVGO',name:'Broadcom',aliases:['Broadcom']},amd={id:'AMD',name:'AMD',aliases:['AMD']};
 const q='Broadcom and AMD are collaborating to deliver a VMware AI Factory that pairs VCF with AMD Instinct GPUs and the open AMD ROCm software ecosystem.';
 const [r]=realRow(q,broadcom,amd);assert.deepEqual(r.reasons,[]);assert.equal(r.text_ja,'AMDとVMware製AI基盤を提供');
});
test('quantum algorithm development preserves cargo loading and distribution purpose',()=>{
 const ionq={id:'IONQ',name:'IonQ',aliases:['IonQ']},airbus={id:'Airbus',name:'Airbus',aliases:['Airbus']};
 const q='In 2022, IonQ and Airbus partnered on a project to develop smarter algorithms based on quantum computers to achieve cost savings due to more efficient cargo loading and distribution.';
 const [r]=realRow(q,ionq,airbus);assert.deepEqual(r.reasons,[]);assert.equal(r.text_ja,'Airbusと貨物積載・配送向け量子アルゴリズム開発');
 assert.ok(Array.from(r.text_ja).length<=30);
});
