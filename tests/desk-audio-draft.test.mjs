import test from 'node:test';
import assert from 'node:assert/strict';
import { validCutDraft, loadAudioDraft, saveAudioDraft } from '../lib/research/desk-audio-draft.ts';
const cut = { history: [[[0,1000]],[[100,1000]],[[100,300],[400,1000]]], from: 2, to: 3, length: 1000, sampleRate: 100 };
test('restored cuts retain undo history and selection only for the same decoded audio', () => {
  assert.equal(validCutDraft(cut,1000,100),true);
  assert.equal(validCutDraft(cut,999,100),false);
  assert.equal(validCutDraft(cut,1000,44100),false);
  for (const patch of [{history:[]},{history:[[[0,1001]]]},{history:[[[100,300],[200,400]]]},{history:[[[0,0]]]},{history:[[[0.1,300]]]},{from:-1},{from:4,to:3},{to:9},{to:NaN},{history:Array(52).fill([[0,1000]])}]) assert.equal(validCutDraft({...cut,...patch},1000,100),false);
});
test('unavailable local storage rejects without claiming an audio draft was saved', async () => {
  assert.equal(typeof indexedDB,'undefined');
  await assert.rejects(saveAudioDraft('owner:new', {title:'test',edited:false,cut:null}), /storage-unavailable/);
  await assert.rejects(loadAudioDraft('owner:new'), /storage-unavailable/);
  await assert.rejects(saveAudioDraft('owner:new',null), /storage-unavailable/);
});
