export type LegalBlock =
  | { kind: "title"; text: string }
  | { kind: "heading"; text: string }
  | { kind: "items"; items: { no: string; text: string }[] }
  | { kind: "bullets"; items: string[] }
  | { kind: "table"; header: string[]; rows: string[][] }
  | { kind: "text"; text: string };

/** Splits the owner's Markdown into blocks without touching the wording: nothing is added, removed or reworded
 * (bracketed placeholders such as 【制定日】 stay as written). */
export function parseLegal(source: string): LegalBlock[] {
  const blocks: LegalBlock[] = [];
  for (const line of source.split("\n")) {
    const text = line.trimEnd();
    if (!text.trim()) continue;
    const title = /^#\s+(.+)$/.exec(text), heading = /^##\s+(.+)$/.exec(text), numbered = /^(\d+)\.\s+(.+)$/.exec(text), bullet = /^-\s+(.+)$/.exec(text);
    const last = blocks[blocks.length - 1];
    // A Markdown table (the commercial-transactions notice): the first row is the header, the |---| line is skipped.
    if (/^\|.*\|$/.test(text.trim())) {
      const cells = text.trim().slice(1, -1).split("|").map(cell => cell.trim());
      if (cells.every(cell => /^:?-+:?$/.test(cell))) continue;
      if (last?.kind === "table") last.rows.push(cells); else blocks.push({ kind: "table", header: cells, rows: [] });
      continue;
    }
    if (heading) blocks.push({ kind: "heading", text: heading[1] });
    else if (title) blocks.push({ kind: "title", text: title[1] });
    else if (numbered) {
      const item = { no: numbered[1], text: numbered[2] };
      if (last?.kind === "items") last.items.push(item); else blocks.push({ kind: "items", items: [item] });
    } else if (bullet) {
      if (last?.kind === "bullets") last.items.push(bullet[1]); else blocks.push({ kind: "bullets", items: [bullet[1]] });
    } else blocks.push({ kind: "text", text });
  }
  return blocks;
}
