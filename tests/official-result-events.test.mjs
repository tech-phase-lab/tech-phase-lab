import test from 'node:test';
import assert from 'node:assert/strict';
import { officialResultEvents } from '../lib/research/official-result-events.ts';
import { publicEvent } from '../lib/research/access.ts';
import { evidenceIssues } from '../lib/research/quality.ts';
const copy={ja:'Inferizeを買収',en:'Acquired Inferize'};
const note={id:'ir-result-123',ticker:'NBIS',kind:'acquisition',title:copy,summary:copy,
 facts:[copy,copy,copy],purpose:{ja:'非公開の事業目的',en:'PRIVATE-PURPOSE'},
 url:'https://nebius.com/newsroom/nebius-acquires-inferize-to-strengthen-nebius-token-factorys-production-inference-stack',
 sourceTitle:'Nebius acquires Inferize',publishedOn:'2026-10-01',dateBasis:'publication',publicAt:'2026-10-01T14:00:00Z'};
test('official current-source notes reach bilingual research without leaking analysis',()=>{
 const [event]=officialResultEvents([{...note,evidenceQuote:'PRIVATE-RAW-SOURCE'}]);
 assert.deepEqual(evidenceIssues(event),[]);
 assert.equal(event.kind,'acquisition');assert.equal(event.title.en,copy.en);
 assert.equal(JSON.stringify(event).includes('PRIVATE-RAW-SOURCE'),false);
 assert.equal(JSON.stringify(publicEvent(event)).includes('PRIVATE-PURPOSE'),false);
 for(const changes of [{url:'https://evil.example/newsroom/release'},{ticker:'MU'},{id:'operator-token'},{url:note.url+'?secret=1'},{kind:'trade'}])assert.throws(()=>officialResultEvents([{...note,...changes}]));
});

test('detected dates remain explicitly distinguished from official publication dates',()=>{
 const [event]=officialResultEvents([{...note,dateBasis:'detection'}]);
 assert.equal(event.dateBasis,'detection');
 assert.equal(publicEvent(event).dateBasis,'detection');
});

test('issuer notes show their own checked unknown/next lines and a kind-specific line otherwise',()=>{
 const unknown={ja:'買収金額は明らかにしていない。',en:'The release does not disclose the purchase price.'};
 const next={ja:'取引は2027年第1四半期に完了する見込みとしている。',en:'The deal is expected to close in the first quarter of 2027.'};
 const [own]=officialResultEvents([{...note,unknown,next}]);
 assert.deepEqual(own.unknown,unknown);assert.deepEqual(own.next,next);
 const [old]=officialResultEvents([note]);
 assert.match(old.unknown.ja,/買収/);assert.match(old.next.ja,/買収完了/);
 const seen=new Set();
 for(const kind of ['acquisition','earnings','partnership','product']){
  const [event]=officialResultEvents([{...note,kind}]);
  assert.ok(event.unknown.ja&&event.unknown.en&&event.next.ja&&event.next.en,kind);
  assert.doesNotMatch(event.unknown.ja,/今後の決算で確認します/);
  assert.doesNotMatch(event.next.ja,/発表した内容の進捗を追います/);
  seen.add(event.unknown.ja);seen.add(event.next.ja);
 }
 assert.equal(seen.size,8);
 // A malformed line falls back instead of failing the whole note.
 const [bad]=officialResultEvents([{...note,unknown:{ja:'https://x.example',en:'x'},next:'text'}]);
 assert.match(bad.unknown.ja,/買収/);assert.match(bad.next.ja,/買収完了/);
 // The locked (FREE) view still hides both lines.
 assert.deepEqual(publicEvent(own).unknown,{ja:'',en:''});assert.deepEqual(publicEvent(own).next,{ja:'',en:''});
});
