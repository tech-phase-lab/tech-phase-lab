import assert from 'node:assert/strict';
import test from 'node:test';
import { newsPulseItems } from '../lib/research/news-pulse-items.ts';
import { officialPulseHeadlines, fitPulseHeadline } from '../lib/research/news-pulse-headline.ts';

const buyback={id:'1246',tickers:['NVDA'],publisher:'Reported company news',title:'NVDA: Reported buyback recap',translationJa:'NVDA：自社株買い実績の振り返り報道',
  url:'https://x.com/TrendSpider/status/2106523440635363385',publishedAt:'2026-10-03T23:15:00.000Z',observedAt:'2026-10-04T02:09:57.822Z',
  bodyJa:'報道によると、NVIDIAは前四半期に200億ドル弱の自社株を買い戻した。金額はフリーキャッシュフローの約92%に相当した。\n\n報道によると、NVIDIAは自社株買い枠を800億ドル追加で承認した。残る承認枠は約1110億ドルだった。',
  bodyEn:'According to the report, NVIDIA bought back its own shares for nearly $20 billion during the previous quarter. The amount was equivalent to about 92% of free cash flow.\n\nAccording to the report, NVIDIA approved $80 billion in additional share buyback authority. Remaining authorization is about $111 billion.'};
const mu={...buyback,id:'1244',tickers:['MU'],title:'MU: Broker business and industry outlook',translationJa:'MU：証券会社による事業・業界見通し',
  bodyJa:'JPMorganの見方として報じられた内容：メモリー供給は2028年まで逼迫が続くと見込む。\n\n顧客との受注協議は2031年まで及んでいる。',
  bodyEn:'Reported view of JPMorgan: Memory supply is expected to stay constrained through 2028.\n\nCustomer order talks already reach into 2031.'};
const oracle={...buyback,id:'1179',publisher:'Oracle',tickers:['ORCL'],
  title:'Oracle Announces Commitment to Absorb $300 Million in Rising Point Beach Energy Costs for Wisconsin Residents',
  translationJa:'Oracle、Point Beachの電力費用（約$300 million）を負担する計画',bodyJa:'電力費の計画に関する詳しい本文。',bodyEn:'The full source-backed details about the planned energy-cost commitment.'};
const treasury={id:'1311',topic:'government-bonds',publishedAt:'2026-10-04T00:48:02Z',observedAt:'2026-10-04T00:48:10Z',url:'https://x.com/Barchart/status/1234',
  titleJa:'米国債、10年間の成績が史上最悪に',titleEn:'U.S. Treasuries suffer their worst 10-year period in history'};
const bond={...treasury,id:'1310',titleJa:'米国10年物国債利回りが再び急上昇中',titleEn:'U.S. 10-Year Treasury Yield Rising Sharply Again'};
const feed={ok:true,enabled:false,items:[],officialUpdates:[buyback,mu,oracle],marketUpdates:[treasury,bond]};

// These are conservative font/space budgets for fit-selection logic, not an
// actual browser/mobile viewport claim. Live 390px DevTools is policy-blocked.
const measure=text=>Array.from(text).reduce((width,char)=>width+(char.codePointAt(0)>255?12:7),0);
const viewportBudget=width=>Math.min(width-40,width>=768?width-228:width)-22-16-28-(width<=600?70:100);

test('complete headline choices fit representative 320/375/390/768/932/1440 budgets in both languages',()=>{
  const before=JSON.stringify(feed);
  for(const lang of ['ja','en']) for(const viewport of [320,375,390,768,932,1440]) for(const item of newsPulseItems(feed,lang)) {
    const width=viewportBudget(viewport), chosen=fitPulseHeadline(item.headlines,width,measure);
    assert.ok(chosen,`${lang} ${viewport} ${item.id}`);
    assert.ok(item.headlines.includes(chosen));
    assert.ok(measure(chosen)<=width,`${lang} ${viewport}: ${chosen}`);
    assert.doesNotMatch(chosen,/\n|…|\.\.\.|92%|1110|111B/);
  }
  assert.equal(JSON.stringify(feed),before);
});

test('NVDA headline preserves completed action, period, amount bound and report attribution without its second sentence',()=>{
  const before=JSON.stringify(buyback);
  const ja=officialPulseHeadlines(buyback,'ja',buyback.translationJa),en=officialPulseHeadlines(buyback,'en',buyback.title);
  assert.equal(ja[0],'NVIDIA、前四半期に200億ドル弱買戻しと報道');
  assert.equal(en[0],'NVIDIA: nearly $20B repurchased prior qtr (report)');
  assert.ok(ja.includes('NVIDIA、前四半期の買戻し報道'));
  assert.ok(en.includes('NVIDIA: prior-qtr buyback report'));
  assert.equal(JSON.stringify(buyback),before);
  for(const language of ['ja','en']) {
    const [pulse]=newsPulseItems({...feed,marketUpdates:[],officialUpdates:[buyback]},language);
    assert.ok(pulse.body.includes(language==='ja'?buyback.bodyJa:buyback.bodyEn));
    assert.equal(pulse.at,buyback.publishedAt);
    assert.ok(pulse.headlines.every(text=>!text.includes('92%')));
  }
});

test('changed negation, planned action, period or appended qualification cannot inherit a positive buyback headline',()=>{
  for(const bodyEn of [buyback.bodyEn.replace('bought back','did not buy back'),buyback.bodyEn.replace('bought back','plans to buy back'),buyback.bodyEn.replace('previous quarter','previous month'),buyback.bodyEn.replace('flow.','flow. However, the amount is disputed.')]) {
    const item={...buyback,bodyEn};
    for(const lang of ['ja','en']) assert.ok(officialPulseHeadlines(item,lang,lang==='ja'?item.translationJa:item.title).every(x=>!x.includes('200')&&!x.includes('$20')));
  }
});

test('decimal amounts and approximate bounds remain whole; no number is shortened by a character cut',()=>{
  const item={...buyback,bodyJa:buyback.bodyJa.replace('200億ドル弱','207.5億ドル弱'),bodyEn:buyback.bodyEn.replace('$20 billion','$20.75 billion')};
  assert.ok(officialPulseHeadlines(item,'ja',item.translationJa)[0].includes('207.5億ドル弱'));
  assert.ok(officialPulseHeadlines(item,'en',item.title)[0].includes('nearly $20.75B'));
  assert.equal(fitPulseHeadline(['Exact $20.75B claim','Short topic'],0,measure),'');
});

test('MU forecast keeps its broker and 2028 horizon when room permits; Oracle remains a future commitment',()=>{
  assert.equal(officialPulseHeadlines(mu,'ja',mu.translationJa)[0],'JPMorgan：2028年までメモリー逼迫予想');
  assert.equal(officialPulseHeadlines(mu,'en',mu.title)[0],'JPMorgan sees tight memory supply through 2028');
  assert.equal(officialPulseHeadlines(oracle,'en',oracle.title)[0],'Oracle: Point Beach energy-cost commitment');
  assert.equal(officialPulseHeadlines(oracle,'ja',oracle.translationJa)[0],'Oracle、Point Beachの電力費負担計画');
  assert.ok(officialPulseHeadlines(oracle,'en',oracle.title).includes('Oracle: energy-cost commitment'));
  assert.ok(officialPulseHeadlines(oracle,'ja',oracle.translationJa).includes('Oracle、電力費負担の計画'));
  assert.ok(officialPulseHeadlines(oracle,'en',oracle.title).every(text=>!text.includes('cover')));
  for(const lang of ['ja','en']) {
    const changed={...mu,bodyEn:mu.bodyEn.replace('stay constrained','not stay constrained')};
    assert.ok(officialPulseHeadlines(changed,lang,lang==='ja'?mu.translationJa:mu.title).every(x=>!x.includes('2028')));
  }
});

test('unknown long prose never becomes a header paragraph and brief alternatives always disclose pending review',()=>{
  const long='A long headline with 3.45%, J.P. Morgan and several source-specific qualifications. '.repeat(4);
  const unknown={...oracle,title:long,translationJa:long};
  for(const lang of ['ja','en']) {
    const values=officialPulseHeadlines(unknown,lang,long,long);
    assert.ok(values.every(x=>!x.includes('3.45')));
    const brief=officialPulseHeadlines({...unknown,brief:{version:1,scope:'company',validFacts:1,pendingFacts:1}},lang,long);
    assert.ok(brief.every(x=>/確認中|pending/.test(x)));
    assert.ok(brief.every(x=>!x.includes('3.45')));
  }
});
