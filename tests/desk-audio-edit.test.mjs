import test from 'node:test';
import assert from 'node:assert/strict';
import { cutAudioSpans, audioSamples, frameCount, exportEditedAudio } from '../lib/research/desk-audio-edit.ts';
import { verifyM4a } from '../lib/research/desk-audio.ts';
test('successive cuts preserve source samples, trim both ends, and undo does not alter the original timeline',()=>{
 const source=Float32Array.from({length:20},(_,i)=>i), original=[[0,20]];
 const first=cutAudioSpans(original,5,10);assert.deepEqual(first,[[0,5],[10,20]]);
 const second=cutAudioSpans(first,3,7);assert.deepEqual(second,[[0,3],[12,20]]);
 assert.deepEqual([...audioSamples(source,second,0,11)],[0,1,2,12,13,14,15,16,17,18,19]);
 assert.deepEqual([...audioSamples(source,second,2,4)],[2,12,13,14]);
 assert.deepEqual(cutAudioSpans(first,0,2),[[2,5],[10,20]]);
 assert.deepEqual(cutAudioSpans(first,13,15),[[0,5],[10,18]]);
 assert.deepEqual(original,[[0,20]]);assert.equal(frameCount(first),15);
 for(const pair of [[0,20],[4,4],[-1,3],[5,21],[1.2,2],[NaN,2]])assert.throws(()=>cutAudioSpans(original,...pair),/invalid-cut/);
});
test('M4A export sends only retained PCM to the encoder and produces an audio-only container',async()=>{
 const prior=Object.fromEntries(['AudioEncoder','AudioData','EncodedAudioChunk'].map(k=>[k,globalThis[k]]));let copied=[],closed=0;
 globalThis.EncodedAudioChunk=class { constructor(timestamp){this.timestamp=timestamp;this.type='key';this.byteLength=512;this.duration=100000;} copyTo(target){new Uint8Array(target.buffer||target,target.byteOffset||0,this.byteLength).fill(0);} };
 globalThis.AudioData=class {constructor(options){Object.assign(this,options);}close(){closed++;}};
 globalThis.AudioEncoder=class {static async isConfigSupported(){return {supported:true};}state='unconfigured';encodeQueueSize=0;constructor(callbacks){this.callbacks=callbacks;}configure(){this.state='configured';}encode(data){copied.push(...data.data);this.callbacks.output(new globalThis.EncodedAudioChunk(data.timestamp),{decoderConfig:{codec:'mp4a.40.2',sampleRate:44100,numberOfChannels:1,description:new Uint8Array([0x12,0x08])}});}async flush(){}close(){this.state='closed';}};
 try{
  const samples=Float32Array.from({length:20000},(_,i)=>i/20000),buffer={sampleRate:44100,numberOfChannels:1,getChannelData:()=>samples};
  const spans=cutAudioSpans([[0,samples.length]],2000,10000);
  const file=await exportEditedAudio(buffer,spans,new AbortController().signal,()=>{});
  assert.deepEqual(copied,[...samples.slice(0,2000),...samples.slice(10000)]);assert.ok(closed>0);assert.equal(file.type,'audio/mp4');
  const bytes=new Uint8Array(await file.arrayBuffer());await verifyM4a(bytes.length,async(at,n)=>bytes.subarray(at,at+n));
  const controller=new AbortController();controller.abort();await assert.rejects(exportEditedAudio(buffer,spans,controller.signal,()=>{}));
 }finally{for(const [key,value] of Object.entries(prior))if(value===undefined)delete globalThis[key];else globalThis[key]=value;}
});
