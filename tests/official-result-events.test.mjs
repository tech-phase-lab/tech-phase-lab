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
