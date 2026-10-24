export function csvCell(value: unknown): string {
  let text = String(value ?? "");
  // Neutralize spreadsheet formulas, including leading whitespace/control characters.
  if (/^[\s\u0000-\u001f]*[=+@-]/.test(text)) text = "'" + text;
  return '"' + text.replaceAll('"', '""') + '"';
}
export function memberCsv(rows: unknown[][]): string {
  return "\uFEFF" + rows.map(row => row.map(csvCell).join(",")).join("\r\n");
}
