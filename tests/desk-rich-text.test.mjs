import test from 'node:test';
import assert from 'node:assert/strict';
import { parse } from 'node-html-parser';
import { editorHtml, editorText } from '../app/research/desk/rich-text.ts';
function dom(html) {
 const convert = node => ({nodeType:node.nodeType,tagName:node.tagName,textContent:node.textContent,childNodes:node.childNodes.map(convert),getAttribute:key=>node.getAttribute?.(key),style:Object.fromEntries((node.getAttribute?.('style')||'').split(';').filter(Boolean).map(x=>{const [k,...v]=x.split(':');return [k.trim().replace(/-([a-z])/g,(_,c)=>c.toUpperCase()),v.join(':').trim()];}))});
 return convert(parse(html));
}
test('editable DOM displays formatting and round-trips combined styles without saving HTML', () => {
 const text='本文\n==**[red]強調[/red]**==\n次の行';
 const html=editorHtml(text);
 assert.doesNotMatch(html,/\*\*|\[red\]|==/);
 const saved=editorText(dom(html));
 assert.equal(saved,text);
 assert.equal(editorText(dom('<div>A</div><div>B</div><div><br></div><div>C</div>')),'A\nB\n\nC');
 assert.equal(editorText(dom('<font color="#ff8888">赤</font>')),'[red]赤[/red]');
 assert.equal(editorText(dom('<span style="background-color: rgb(112, 91, 0)">黄</span>')),'==黄==');
 assert.match(editorHtml('<img src=x onerror=alert(1)>'),/&lt;img/);
 assert.doesNotMatch(editorHtml('<script>x</script>'),/<script>/);
});
