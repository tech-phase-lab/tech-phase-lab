import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ts from 'typescript';
const require = createRequire(import.meta.url);
const source = readFileSync(new URL('../app/research/desk/body.tsx', import.meta.url), 'utf8');
const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 } }).outputText;
const loaded = { exports: {} };
new Function('require', 'module', 'exports', code)(id => id.endsWith('.module.css') ? { default: { red: 'red', highlight: 'highlight' } } : require(id), loaded, loaded.exports);
const { default: Body, mediaSource } = loaded.exports;
const render = (text, media = false) => renderToStaticMarkup(React.createElement(Body, { text, media }));
test('desk formatting renders emphasis without interpreting author HTML or dropping plain text', () => {
  const html = render('通常\n**太字** [red]赤文字[/red] ==黄色線==\n\n<script>alert(1)</script>');
  assert.match(html, /<strong>太字<\/strong>/);
  assert.match(html, /class="red">赤文字/);
  assert.match(html, /<mark class="highlight">黄色線/);
  assert.match(html, /&lt;script&gt;/);
  assert.doesNotMatch(html, /<script>/);
  assert.match(html, /<br\/>/);
  assert.match(render('**閉じない'), /\*\*閉じない/);
});
test('media is opt-in, accepts only HTTPS supported formats and exact YouTube hosts', () => {
  for (const url of ['javascript:alert(1)', 'http://example.com/a.mp3', 'https://user:pass@example.com/a.mp3', 'https://example.com:8080/a.mp3', 'https://example.com/a.html']) assert.equal(mediaSource(url, 'audio'), null);
  for (const url of ['https://youtube.com.evil.test/watch?v=abcdefghijk', 'https://youtube.com/watch?v=bad', 'https://example.com/embed']) assert.equal(mediaSource(url, 'video'), null);
  const audio = '[audio](https://example.com/voice.mp3)';
  assert.doesNotMatch(render(audio), /<audio/);
  assert.match(render(audio, true), /<audio controls="" preload="none"/);
  assert.doesNotMatch(render(audio, true), /autoplay/);
  assert.match(render('[video](https://youtu.be/abcdefghijk)', true), /https:\/\/www.youtube-nocookie.com\/embed\/abcdefghijk/);
  assert.match(render('[video](https://example.com/movie.mp4)', true), /<video controls="" preload="none"/);
  assert.doesNotMatch(render('[video](https://youtube.com.evil.test/watch?v=abcdefghijk)', true), /<iframe/);
});

test('images and audio alone are valid attachments, nested formatting remains visible', () => {
  assert.match(render('[image](https://example.com/photo.webp)',true), /<img[^>]+src="https:\/\/example.com\/photo.webp"/);
  assert.equal(mediaSource('https://example.com/script.svg','image'),null);
  assert.doesNotMatch(render('[image](https://example.com/photo.webp)'), /<img/);
  assert.match(render('==**[red]強調[/red]**=='), /<mark[^>]*><strong><span class="red">強調<\/span><\/strong><\/mark>/);
});

test('uploaded MP3 links stay on the membership-gated route and carry the published post reference',()=>{
 const path='/api/research/desk-media/12345678-1234-4123-8123-123456789abc.mp3';
 const html=renderToStaticMarkup(React.createElement(Body,{text:`[audio](${path})`,media:true,postId:'synthetic-note-0001'}));
 assert.match(html,/audio[^>]+src="[^"]+\?post=synthetic-note-0001"/);
 for(const bad of [path+'?other=1',path.replace('.mp3','.mp4'),'/api/research/desk-media/../../secret','//evil.test/a.mp3']) assert.equal(mediaSource(bad,'audio'),null);
 for(const url of ['https://m.youtube.com/watch?v=abcdefghijk','https://youtube.com/shorts/abcdefghijk','https://youtube.com/live/abcdefghijk']) assert.match(mediaSource(url,'video').embed,/youtube-nocookie/);
});
