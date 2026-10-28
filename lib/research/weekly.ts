export const weeklyHeadings = ["今週の重要ニュース", "注目企業の動き", "市場の振り返り", "来週の注目点"];
export function weeklySections(body: string) {
  const chunks = body.split(/^##\s+/m);
  const sections = chunks.slice(1).map(chunk => { const i=chunk.indexOf("\n");return {title:(i<0?chunk:chunk.slice(0,i)).trim(),body:(i<0?"":chunk.slice(i+1)).trim()}; });
  return sections.length && !chunks[0].trim() ? sections : [{title:"",body}];
}
