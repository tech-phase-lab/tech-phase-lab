import type { JSONContent } from "@tiptap/core";

// Keep existing text-only post storage; editor marks belong to text runs, never DOM ancestors.
export function deskDocument(value: string): JSONContent {
  function inline(text: string, marks: NonNullable<JSONContent["marks"]> = [], depth = 0): JSONContent[] {
    if (depth > 8) return text ? [{ type: "text", text, marks }] : [];
    const result: JSONContent[] = [];
    const pattern = /\*\*([^\n]+?)\*\*|==([^\n]+?)==|\[red\]([^\n]+?)\[\/red\]/g;
    let start = 0;
    for (const match of text.matchAll(pattern)) {
      if (match.index > start) result.push({ type: "text", text: text.slice(start, match.index), marks });
      const mark = match[1] !== undefined ? { type: "bold" } : match[2] !== undefined ? { type: "highlight" } : { type: "textStyle", attrs: { color: "#ff8888" } };
      result.push(...inline(match[1] ?? match[2] ?? match[3], [...marks.filter(existing => existing.type !== mark.type), mark], depth + 1));
      start = match.index + match[0].length;
    }
    if (start < text.length) result.push({ type: "text", text: text.slice(start), marks });
    return result;
  }
  return { type: "doc", content: value.split("\n").map(line => ({ type: "paragraph", content: inline(line) })) };
}
export function deskText(document: JSONContent): string {
  function read(node: JSONContent): string {
    if (node.type === "hardBreak") return "\n";
    if (node.type !== "text") return (node.content ?? []).map(read).join(node.type === "doc" ? "\n" : "");
    let text = node.text ?? "";
    const marks = node.marks ?? [];
    if (marks.some(mark => mark.type === "textStyle" && ["#ff8888", "rgb(255, 136, 136)"].includes(String(mark.attrs?.color).toLowerCase()))) text = `[red]${text}[/red]`;
    if (marks.some(mark => mark.type === "bold")) text = `**${text}**`;
    if (marks.some(mark => mark.type === "highlight")) text = `==${text}==`;
    return text;
  }
  return read(document);
}
