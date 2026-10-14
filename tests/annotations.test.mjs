import test from 'node:test';
import assert from 'node:assert/strict';
import { parseAnnotations, textBlockId, markedSegments, eraseAnnotationRanges } from '../lib/research/annotations.ts';
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

test('erasing two characters preserves the rest of the same annotation and its note', () => {
  const original={...mark,kind:'note',note:'Keep this note',parts:[{block,start:0,end:text.length,quote:text}]};
  const result=eraseAnnotationRanges([original],[{block,start:4,end:6,quote:text.slice(4,6)}]);
  assert.equal(result.length,1);
  assert.equal(result[0].note,'Keep this note');
  assert.deepEqual(result[0].parts.map(p=>[p.start,p.end,p.quote]),[[0,4,text.slice(0,4)],[6,text.length,text.slice(6)]]);
  const segments=markedSegments(text,block,result);
  assert.equal(segments.map(s=>s.text).join(''),text);
  assert.equal(segments.find(s=>s.start===4).marks.length,0);
  assert.equal(segments.find(s=>s.start===6).marks.length,1);
  assert.deepEqual(parseAnnotations(JSON.stringify(result)),result);
});
test('partial erase affects only selected blocks even with overlapping selections', () => {
  const other={...mark,id:'other',parts:[{block:'other',start:4,end:10,quote:text.slice(4,10)}]};
  const cuts=[{block,start:5,end:7,quote:text.slice(5,7)},{block,start:6,end:9,quote:text.slice(6,9)}];
  const result=eraseAnnotationRanges([mark,other],cuts);
  assert.deepEqual(result[0].parts.map(p=>[p.start,p.end]),[[4,5],[9,10]]);
  assert.deepEqual(result[1],other);
  assert.deepEqual(eraseAnnotationRanges([mark],mark.parts),[]);
});
test('erasing a whole Unicode character preserves exact offsets on both sides', () => {
  const value='赤😀青';
  const original={...mark,parts:[{block,start:0,end:value.length,quote:value}]};
  const result=eraseAnnotationRanges([original],[{block,start:1,end:3,quote:'😀'}]);
  assert.deepEqual(result[0].parts.map(p=>[p.start,p.end,p.quote]),[[0,1,'赤'],[3,4,'青']]);
});
