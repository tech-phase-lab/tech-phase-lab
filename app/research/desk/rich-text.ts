/** The persisted format stays text-only; raw HTML is never saved or rendered. */
const escape = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
export function editorHtml(text: string, depth = 0): string {
  if (depth > 8) return escape(text);
  const pattern = /\*\*([^\n]+?)\*\*|==([^\n]+?)==|\[red\]([^\n]+?)\[\/red\]/g;
  let result = "", start = 0;
  for (const match of text.matchAll(pattern)) {
    result += escape(text.slice(start, match.index));
    const inner = editorHtml(match[1] ?? match[2] ?? match[3], depth + 1);
    result += match[1] !== undefined ? `<b>${inner}</b>` : match[2] !== undefined ? `<span style="background-color: rgb(112, 91, 0)">${inner}</span>` : `<span style="color: rgb(255, 136, 136)">${inner}</span>`;
    start = match.index + match[0].length;
  }
  return (result + escape(text.slice(start))).replace(/\n/g, "<br>");
}
export function editorText(root: Node): string {
  function read(node: Node): string {
    if (node.nodeType === 3) return node.textContent ?? "";
    if (node.nodeType !== 1) return Array.from(node.childNodes).map(read).join("");
    const element = node as HTMLElement;
    if (element.tagName === "BR") return "\n";
    let text = Array.from(node.childNodes).map(read).join("");
    const wrap = (left: string, right: string) => { text = text.split("\n").map(line => line ? left + line + right : "").join("\n"); };
    if (["B", "STRONG"].includes(element.tagName) || ["bold", "700", "800"].includes(element.style.fontWeight)) wrap("**", "**");
    const color = element.style.color || element.getAttribute("color") || "";
    if (["rgb(255, 136, 136)", "#ff8888"].includes(color.toLowerCase())) wrap("[red]", "[/red]");
    if (element.tagName === "MARK" || element.style.backgroundColor === "rgb(112, 91, 0)") wrap("==", "==");
    return text;
  }
  // Browser Enter inserts DIV/P blocks, while Shift+Enter inserts BR.
  let text = "";
  for (const child of Array.from(root.childNodes)) {
    if (child.nodeType === 1 && ["DIV", "P"].includes((child as Element).tagName) && text && !text.endsWith("\n")) text += "\n";
    text += read(child);
  }
  return text.replace(/\u00a0/g, " ");
}
