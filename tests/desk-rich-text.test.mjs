import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import { JSDOM } from 'jsdom';
import { Editor } from '@tiptap/core';
import { deskDocument, deskText } from '../app/research/desk/document.ts';
const dom = new JSDOM('<!doctype html><html><body></body></html>', { pretendToBeVisual: true });
for (const key of ['window','document','navigator','Node','HTMLElement','MutationObserver','DOMParser','getComputedStyle','requestAnimationFrame','cancelAnimationFrame']) Object.defineProperty(globalThis,key,{configurable:true,value: key==='window'?dom.window : typeof dom.window[key]==='function' && ['getComputedStyle','requestAnimationFrame','cancelAnimationFrame'].includes(key)?dom.window[key].bind(dom.window):dom.window[key]});
const source=readFileSync(new URL('../app/research/desk/editor-extensions.ts',import.meta.url),'utf8').replace(/from "([^"]+)"/g,(_,id)=>`from ${JSON.stringify(id==='./document'?new URL('../app/research/desk/document.ts',import.meta.url).href:import.meta.resolve(id))}`);
const {deskExtensions}=await import('data:text/javascript;base64,'+Buffer.from(stripTypeScriptTypes(source)).toString('base64'));
function editor(value='') { return new Editor({element:document.createElement('div'),extensions:deskExtensions(),content:deskDocument(value),enableInputRules:false,enablePasteRules:false}); }
const type=(editor,text)=>editor.view.dispatch(editor.state.tr.insertText(text));
test('bold off affects only future input; cursor movement, saving and reopening never restore it',()=>{
 const e=editor();
 try{
  e.commands.toggleBold(); type(e,'あいう'); e.commands.toggleBold(); type(e,'えお');
  assert.equal(deskText(e.getJSON()),'**あいう**えお');
  e.commands.setTextSelection(6); assert.equal(e.isActive('bold'),false);
  e.commands.setContent(deskDocument(deskText(e.getJSON()))); assert.equal(deskText(e.getJSON()),'**あいう**えお');
  e.commands.setTextSelection({from:1,to:4}); e.commands.toggleBold();
  assert.equal(deskText(e.getJSON()),'あいうえお');
  e.commands.setTextSelection(6); type(e,'か');
  e.commands.setContent(deskDocument(deskText(e.getJSON())));
  assert.equal(deskText(e.getJSON()),'あいうえおか');
 }finally{e.destroy();}
});
test('red off stays off and selected red text can be removed without recoloring ordinary text',()=>{
 const e=editor();
 try{
  e.commands.setColor('#ff8888'); type(e,'あいう'); e.commands.unsetColor(); type(e,'えお');
  assert.equal(deskText(e.getJSON()),'[red]あいう[/red]えお');
  e.commands.setTextSelection(6); assert.equal(e.isActive('textStyle',{color:'#ff8888'}),false);
  e.commands.setContent(deskDocument(deskText(e.getJSON())));
  e.commands.setTextSelection({from:1,to:4}); e.commands.unsetColor();
  e.commands.setTextSelection(6); type(e,'か');
  assert.equal(deskText(e.getJSON()),'あいうえおか');
 }finally{e.destroy();}
});
test('legacy posts retain independent marks, blank lines and literal HTML; limit rejects whole transaction',()=>{
 const value='本文\n==**[red]強調[/red]**==\n\n<script>alert(1)</script>';
 const e=editor(value);
 try{
  assert.equal(deskText(e.getJSON()),value);
  assert.doesNotMatch(e.getHTML(),/<script>/);
  assert.match(e.getHTML(),/&lt;script&gt;/);
  e.commands.setContent(deskDocument('あ'.repeat(6000)));
  e.commands.setTextSelection(6001); type(e,'い');
  assert.equal(deskText(e.getJSON()).length,6000);
 }finally{e.destroy();}
});
test('clear at caret removes bold/red/highlight only for following input',()=>{
 const e=editor();
 try{
  e.chain().setBold().setColor('#ff8888').setHighlight().run(); type(e,'あいう');
  e.chain().unsetBold().unsetColor().unsetHighlight().run(); type(e,'えお');
  assert.equal(deskText(e.getJSON()),'==**[red]あいう[/red]**==えお');
 }finally{e.destroy();}
});
