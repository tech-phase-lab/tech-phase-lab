import assert from 'node:assert/strict';
import test from 'node:test';
import { execFileSync } from 'node:child_process';
import { availableNewsPayload } from '../lib/research/general-news.ts';

// Exercise the actual Python projection and actual browser/server validator.
// Optional association must not discard a complete source-faithful story.
const projected = JSON.parse(execFileSync('python3', ['-c', String.raw`
import json,sys
sys.path.insert(0,'scripts/research')
import general_source_news as news
symbols=['AMD','AMZN','AVGO','GOOG','MSFT','NVDA','NBIS']
result=[]
for count in (0,1,5,6,7):
    tags=symbols[:count]
    row={'id':count+1,'source_news':True,'related_subject':'Orion Labs',
         'related_tickers':tags,'ticker':None,'category':'company-development',
         'url':'https://x.com/wallstengine/status/'+str(count+1),
         'published_at':'2026-10-01T08:00:00Z','observed_at':'2026-10-01T08:00:28Z',
         'units':[{'id':'0','actor':'report'}]}
    note={'facts':[{'en':'Orion Labs plans new factories.',
                    'ja':'Orion Labsは新しい工場の建設を計画している。'}]}
    item=news.public_item(row,note)
    result.append({'sourceTagCount':len(row['related_tickers']),'item':item})
print(json.dumps(result))
`], { cwd: new URL('..', import.meta.url), encoding: 'utf8' }));

for (const { sourceTagCount, item } of projected) {
  test(`Python source story with ${sourceTagCount} optional ticker associations survives frontend transport`, () => {
    assert.equal(item.tickers.length, Math.min(sourceTagCount, 5));
    const parsed = availableNewsPayload({ ok: true, enabled: false, items: [], officialUpdates: [item] });
    assert.equal(parsed.officialUpdates.length, 1);
    assert.equal(parsed.officialUpdates[0].title, item.title);
    assert.equal(parsed.officialUpdates[0].bodyJa, item.bodyJa);
    assert.equal(parsed.officialUpdates[0].bodyEn, item.bodyEn);
    assert.deepEqual(parsed.officialUpdates[0].tickers, item.tickers);
  });
}
