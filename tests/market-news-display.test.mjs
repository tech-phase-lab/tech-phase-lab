import test from 'node:test';
import assert from 'node:assert/strict';
import { marketNewsBody, marketNewsDisplay } from '../lib/research/market-news-display.ts';
const titleJa='Nasdaq-100指数：追加予定 Moderna（$MRNA）、除外予定 Warner Bros Discovery（$WBD）。';
const item={topic:'index-membership',titleJa,titleEn:'Moderna will join the Nasdaq-100 index, replacing Warner Bros Discovery.'};
test('index display uses tickers without parenthesized companies or terminal punctuation',()=>{
  assert.deepEqual(marketNewsDisplay(item,'ja'),{label:'指数の組み入れ・除外',title:'Nasdaq-100：追加予定 $MRNA　除外予定 $WBD'});
  assert.equal(marketNewsDisplay(item,'en').title,item.titleEn);
  assert.equal(item.titleJa,titleJa);
});
test('formatting never drops effective dates, reverses roles or rewrites unfamiliar statements',()=>{
  for(const title of [titleJa+' 適用は10月5日',titleJa.replace('追加予定','追加済み'),titleJa.replace('Nasdaq-100','別の指数')])
    assert.equal(marketNewsDisplay({...item,titleJa:title},'ja').title,title);
  const title='S&P 500指数：追加予定 Twilio（$TWLO）、除外予定 Corteva（$CTVA）。';
  assert.deepEqual(marketNewsDisplay({...item,titleJa:title},'ja'),{label:'指数の組み入れ・除外',title:'S&P 500：追加予定 $TWLO　除外予定 $CTVA'});
  const bond='米国30年債利回り -0.01ポイント、4.32%';
  assert.deepEqual(marketNewsDisplay({...item,topic:'government-bonds',titleJa:bond},'ja'),{label:'国債',title:bond});
});
test('headline-only index, Treasury and oil updates never derive details from title variations',()=>{
  const updates=[item,
    {...item,titleJa:'S&P 500指数：追加予定 Twilio（$TWLO）、除外予定 Corteva（$CTVA）。'},
    {topic:'government-bonds',titleJa:'米国10年物国債利回りが再び急上昇中',titleEn:'U.S. 10-Year Treasury Yield ripping again'},
    {topic:'crude-oil',titleJa:'原油価格の速報',titleEn:'Crude oil update'}];
  for(const update of updates) for(const lang of ['ja','en']) {
    const before=structuredClone(update);
    assert.equal(marketNewsBody(update,lang),undefined);
    assert.deepEqual(update,before);
  }
  assert.equal(marketNewsDisplay(item,'ja').title,'Nasdaq-100：追加予定 $MRNA　除外予定 $WBD');
  assert.equal(marketNewsDisplay(item,'en').title,item.titleEn);
});
