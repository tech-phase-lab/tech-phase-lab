import test from 'node:test';
import assert from 'node:assert/strict';
import { parseAnnotations, textBlockId, markedSegments } from '../lib/research/annotations.ts';
const text = '売上高は100億ドル。次の決算を確認。';
const block = textBlockId('r.0', text);
const mark = {id:'1',kind:'highlight',color:'yellow',parts:[{block,start:4,end:10,quote:text.slice(4,10)}],note:''};
test('annotation records reject corrupt storage, oversized notes and invalid offsets', () => {
  assert.deepEqual(parseAnnotations('bad'),[]);
  for(const bad of [{...mark,color:'gold'},{...mark,note:'x'.repeat(1001)},{...mark,parts:[{...mark.parts[0],start:-1}]}]) assert.deepEqual(parseAnnotations(JSON.stringify([bad])),[]);
  assert.deepEqual(parseAnnotations(JSON.stringify([mark,mark])),[mark]);
});
test('overlapping highlights and underlines preserve all original text', () => {
  const second={...mark,id:'2',kind:'underline',color:'red',parts:[{block,start:7,end:15,quote:text.slice(7,15)}]};
  const segments=markedSegments(text,block,[mark,second]);
  assert.equal(segments.map(x=>x.text).join(''),text);
  assert.equal(segments.find(x=>x.start===7).marks.length,2);
});
test('article revisions cannot attach an old mark to new text or offsets', () => {
  const revised=text.replace('100','200');
  assert.notEqual(textBlockId('r.0',revised),block);
  assert.ok(markedSegments(revised,textBlockId('r.0',revised),[mark]).every(x=>x.marks.length===0));
  assert.ok(markedSegments(revised,block,[mark]).every(x=>x.marks.length===0));
});
test('different article text paths isolate identical sentences and Unicode ranges', () => {
  assert.notEqual(textBlockId('r.1',text),block);
  const unicode='決算😀を確認'; const b=textBlockId('r',unicode);
  const m={...mark,parts:[{block:b,start:2,end:4,quote:'😀'}]};
  assert.equal(markedSegments(unicode,b,[m]).find(x=>x.marks.length).text,'😀');
});
