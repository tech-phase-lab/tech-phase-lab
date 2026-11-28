import { parse } from "node-html-parser";

export type FinancialFiling = { accession: string; form: string; filed: string; end: string; url: string; inline: boolean; earnings?: boolean };
const object = (v: unknown): Record<string, unknown> => v && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : {};
const date = (v: unknown) => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) && Number.isFinite(Date.parse(v)) ? v : null;
export function financialFilings(payload: unknown, cik: string, now = Date.now()): FinancialFiling[] {
  const root = object(payload);
  if (Number(root.cik) !== Number(cik)) throw Error("filing-cik-mismatch");
  const recent = object(object(root.filings).recent);
  const col = (name: string): unknown[] => Array.isArray(recent[name]) ? recent[name] as unknown[] : [];
  return col("accessionNumber").flatMap((value, i) => {
    const form = String(col("form")[i]), filed = date(col("filingDate")[i]), end = date(col("reportDate")[i]), document = col("primaryDocument")[i];
    if (typeof value !== "string" || !/^\d{10}-\d{2}-\d{6}$/.test(value) || !["10-K","10-K/A","20-F","20-F/A","40-F","40-F/A","10-Q","10-Q/A","6-K","6-K/A","8-K","8-K/A"].includes(form) || !filed || !end || Date.parse(filed) > now || end > filed || typeof document !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/.test(document)) return [];
    return [{ accession: value, form, filed, end, url: `https://www.sec.gov/Archives/edgar/data/${Number(cik)}/${value.replaceAll("-", "")}/${document}`, inline: col("isInlineXBRL")[i] === 1, earnings: /^8-K/.test(form) && String(col("items")[i] ?? "").split(",").some(item=>item.trim()==="2.02") }];
  }).sort((a,b) => b.end.localeCompare(a.end) || b.filed.localeCompare(a.filed));
}

/** The income statement's net result line, in its usual wordings: "net income", "net loss", "net earnings", and with the sign in brackets,
 *  "net (loss) income" or "net income (loss)" (Nov 28 audit: CRC's statement says "NET (LOSS) INCOME", so its revenue line was never named
 *  and its quarter, where total revenues of $421m sit below $1,002m of sales after derivative losses, was held as a conflict). */
const INCOME_STATEMENT_NET = /net\s*\(?\s*(?:income|loss|earnings)/i;
type SecValue = { val: number; start?: string; end: string; filed: string; accn: string; form: string };
export type SecFacts = { cik: number; facts: Record<string, Record<string, { units: Record<string, SecValue[]> }>>; primaryRevenueTag?: string };
/** Read consolidated, standard-taxonomy facts from the original inline filing.
 * Dimensional segments, per-share units, nils and unsupported numeric transforms
 * are deliberately not interpreted as consolidated monetary amounts.
 */
export function inlineFinancialFacts(html: string, cik: string, filing: FinancialFiling, headerHtml?: string): SecFacts {
  const root = parse(html);
  // An inline XBRL document set keeps its contexts and units in one document's header and its facts in another (BMO's quarterly 6-K: the
  // header in bmo-20260731.htm, the statements in bmo-20260731_d2.htm): the header document is read for them too.
  const resources = headerHtml ? [parse(headerHtml), root] : [root];
  const result: SecFacts = { cik: Number(cik), facts: {} };
  const contexts = new Map<string, { start?: string; end: string }>();
  for (const node of resources.flatMap(r => r.querySelectorAll("xbrli\\:context"))) {
    const id = node.getAttribute("id"), identifier = node.querySelector("xbrli\\:identifier");
    if (!id || !identifier || identifier.getAttribute("scheme") !== "http://www.sec.gov/CIK" || Number(identifier.textContent.trim()) !== Number(cik) || node.querySelector("xbrli\\:segment") || node.querySelector("xbrli\\:scenario")) continue;
    const start = date(node.querySelector("xbrli\\:startdate")?.textContent.trim()), end = date(node.querySelector("xbrli\\:enddate")?.textContent.trim() ?? node.querySelector("xbrli\\:instant")?.textContent.trim());
    if (end && end <= filing.filed && (!start || start <= end)) contexts.set(id, { ...(start ? { start } : {}), end });
  }
  const units = new Map<string, string>();
  for (const node of resources.flatMap(r => r.querySelectorAll("xbrli\\:unit"))) {
    const id = node.getAttribute("id"), measures = node.querySelectorAll("xbrli\\:measure");
    if (!id || measures.length !== 1 || node.querySelector("xbrli\\:divide")) continue;
    const name = measures[0].textContent.trim();
    if (/^iso4217:[A-Z]{3}$/.test(name)) units.set(id, name.split(":")[1]);
    if (name === "xbrli:shares") units.set(id, "shares");
  }
  for (const node of root.querySelectorAll("ix\\:nonfraction")) {
    const attrs = node.attributes, name = attrs.name?.split(":"), context = contexts.get(attrs.contextRef), unit = units.get(attrs.unitRef);
    // A company's own capital-spending line, named plainly (UFPT: ufpt:PaymentsToAcquirePropertyAndEquipmentNet), is read under one
    // reserved name (EXTENSION_CAPEX in comparison.ts), used only when no standard capital-spending line exists.
    const extensionCapex = !!name && name.length === 2 && !["us-gaap","ifrs-full","dei","srt"].includes(name[0]) && /^PaymentsToAcquirePropert(?:y|ies)(?:Plant)?AndEquipment(?:Net)?$/.test(name[1]);
    if (!name || name.length !== 2 || (!["us-gaap","ifrs-full"].includes(name[0]) && !extensionCapex) || !context || !unit || attrs["xsi:nil"] === "true" || attrs.continuedAt || node.querySelector("ix\\:exclude")) continue;
    const format = attrs.format?.split(":")[1];
    if (format && !["num-dot-decimal", "numdotdecimal", "num-comma-decimal", "numcommadecimal", "zerodash", "fixed-zero"].includes(format)) continue;
    let text = node.textContent.trim().replace(/[\s\u00a0]/g, "");
    if (["zerodash","fixed-zero"].includes(format) && /^[-–—]$/.test(text)) text = "0";
    else if (["num-comma-decimal","numcommadecimal"].includes(format)) text = text.replaceAll(".", "").replace(",", ".");
    else text = text.replaceAll(",", "");
    // Inline XBRL carries the sign separately. Parentheses in display text
    // must not cause a second negation or be silently discarded.
    if (!/^\d+(?:\.\d+)?$/.test(text) || (attrs.sign && attrs.sign !== "-")) continue;
    const scale = attrs.scale === undefined ? 0 : Number(attrs.scale);
    if (!Number.isInteger(scale) || Math.abs(scale) > 18) continue;
    const val = Number(text) * 10 ** scale * (attrs.sign === "-" ? -1 : 1);
    if (!Number.isFinite(val) || Math.abs(val) > Number.MAX_SAFE_INTEGER) continue;
    const tag = extensionCapex ? ((result.facts["us-gaap"] ??= {})["TechPhaseExtensionCapex"] ??= { units: {} }) : ((result.facts[name[0]] ??= {})[name[1]] ??= { units: {} });
    (tag.units[unit] ??= []).push({ val, ...context, filed: filing.filed, accn: filing.accession, form: filing.form });
  }
  // A company can disclose contract revenue AND total revenue (including
  // financing revenue). The consolidated income statement identifies which
  // standard concept is its total; note tables alone cannot establish this.
  const primary = new Set<string>();
  const revenueNames = new Set(["us-gaap:Revenues","us-gaap:RevenueFromContractWithCustomerExcludingAssessedTax","us-gaap:SalesRevenueNet","us-gaap:RegulatedAndUnregulatedOperatingRevenue","ifrs-full:Revenue","ifrs-full:RevenueFromContractsWithCustomers"]);
  for (const table of root.querySelectorAll("table")) {
    const text = table.textContent.replace(/\s+/g," ");
    // The income statement: net income (or "net earnings": Devon) with per-share lines; its title need not say "operations" (PSEG: operating
    // revenues, operating expenses, net income).
    if (!INCOME_STATEMENT_NET.test(text) || !/basic.*diluted/i.test(text)) continue;
    for (const node of table.querySelectorAll("ix\\:nonfraction")) {
      const name = node.getAttribute("name"), context = contexts.get(node.getAttribute("contextRef") ?? "");
      if (name && revenueNames.has(name) && context?.end === filing.end) primary.add(name);
    }
  }
  if (primary.size === 1) result.primaryRevenueTag = [...primary][0];
  // The statement shows its sales lines and then their total (Devon: oil, gas and NGL sales, then total revenues, which derivative losses can
  // take below the sales line): the total line is the revenue.
  else if (primary.has("us-gaap:Revenues")) result.primaryRevenueTag = "us-gaap:Revenues";
  productServiceRevenue(html, cik, filing, result, headerHtml);
  return result;
}

const SEGMENT_REVENUE_TAGS = ["us-gaap:Revenues", "us-gaap:RevenueFromContractWithCustomerExcludingAssessedTax", "us-gaap:RevenueFromContractWithCustomerIncludingAssessedTax", "ifrs-full:Revenue", "ifrs-full:RevenueFromContractsWithCustomers"];
/** Revenue filed only as its product and service parts (L-2, Nov 28: RERE's 20-F tags net product revenues and net service revenues on
 *  srt:ProductOrServiceAxis and leaves its total net revenues untagged, so no consolidated revenue was ever read and the company was
 *  "unreadable"). Product and service are the whole of a company's revenue by definition, so for a period, currency and line with exactly
 *  those two members (one value each, no other member on that axis, no other dimension) and no consolidated revenue line of any kind in the
 *  document, their sum is the period's revenue. Anything else (a third member, a segment axis, a consolidated line) adds nothing. */
function productServiceRevenue(html: string, cik: string, filing: FinancialFiling, consolidated: SecFacts, headerHtml?: string): void {
  const contexts = new Map<string, { start: string; end: string; member: string }>();
  for (const source of headerHtml ? [headerHtml, html] : [html]) for (const m of source.matchAll(/<xbrli:context\b([^>]*)>([\s\S]*?)<\/xbrli:context\s*>/gi)) {
    const id = tagAttributes(m[1]).id, body = m[2];
    const identifier = /<xbrli:identifier\b([^>]*)>([\s\S]*?)<\/xbrli:identifier\s*>/i.exec(body);
    if (!id || !identifier || Number(stripTags(identifier[2]).trim()) !== Number(cik) || /<xbrli:scenario\b|<xbrldi:typedMember\b/i.test(body)) continue;
    const members = [...body.matchAll(/<xbrldi:explicitMember\b([^>]*)>([\s\S]*?)<\/xbrldi:explicitMember\s*>/gi)];
    if (members.length !== 1 || tagAttributes(members[0][1]).dimension !== "srt:ProductOrServiceAxis") continue;
    const read = (name: string) => { const found = new RegExp(`<xbrli:${name}\\b[^>]*>([\\s\\S]*?)</xbrli:${name}\\s*>`, "i").exec(body); return found ? stripTags(found[1]).trim() : undefined; };
    const start = date(read("startDate")), end = date(read("endDate"));
    if (start && end && start <= end && end <= filing.filed) contexts.set(id, { start, end, member: stripTags(members[0][2]).trim() });
  }
  if (!contexts.size) return;
  const units = new Map<string, string>();
  for (const source of headerHtml ? [headerHtml, html] : [html]) for (const m of source.matchAll(/<xbrli:unit\b([^>]*)>([\s\S]*?)<\/xbrli:unit\s*>/gi)) {
    const id = tagAttributes(m[1]).id, measures = [...m[2].matchAll(/<xbrli:measure\b[^>]*>([\s\S]*?)<\/xbrli:measure\s*>/gi)];
    const name = measures.length === 1 && !/<xbrli:divide\b/i.test(m[2]) ? stripTags(measures[0][1]).trim() : "";
    if (id && /^iso4217:[A-Z]{3}$/.test(name)) units.set(id, name.split(":")[1]);
  }
  const groups = new Map<string, { tag: string; unit: string; start: string; end: string; members: Map<string, Set<number>> }>();
  for (const m of html.matchAll(/<ix:nonFraction\b([^>]*?)(\/?)>/gi)) {
    if (m[2]) continue;
    const attrs = tagAttributes(m[1]), context = contexts.get(attrs.contextRef ?? ""), unit = units.get(attrs.unitRef ?? "");
    if (!context || !unit || !SEGMENT_REVENUE_TAGS.includes(attrs.name ?? "") || attrs["xsi:nil"] === "true" || attrs.continuedAt || (attrs.sign && attrs.sign !== "-")) continue;
    const close = html.indexOf("</ix:nonFraction", m.index);
    const format = attrs.format?.split(":")[1];
    let text = stripTags(html.slice(m.index + m[0].length, close)).trim().replace(/[\s ]/g, "");
    if (format && !["num-dot-decimal", "numdotdecimal", "num-comma-decimal", "numcommadecimal"].includes(format)) continue;
    text = format === "num-comma-decimal" || format === "numcommadecimal" ? text.replaceAll(".", "").replace(",", ".") : text.replaceAll(",", "");
    const scale = attrs.scale === undefined ? 0 : Number(attrs.scale);
    if (!/^\d+(?:\.\d+)?$/.test(text) || !Number.isInteger(scale) || Math.abs(scale) > 18) continue;
    const val = Number(text) * 10 ** scale * (attrs.sign === "-" ? -1 : 1);
    const key = `${attrs.name}|${unit}|${context.start}|${context.end}`;
    const group = groups.get(key) ?? { tag: attrs.name!, unit, start: context.start, end: context.end, members: new Map() };
    groups.set(key, group);
    (group.members.get(context.member) ?? group.members.set(context.member, new Set()).get(context.member)!).add(val);
  }
  const hasConsolidated = (unit: string, start: string, end: string) => SEGMENT_REVENUE_TAGS.some(name => {
    const [basis, tag] = name.split(":");
    return (consolidated.facts[basis]?.[tag]?.units[unit] ?? []).some(f => f.start === start && f.end === end);
  });
  const added = new Set<string>();
  for (const g of groups.values()) {
    const product = g.members.get("us-gaap:ProductMember"), service = g.members.get("us-gaap:ServiceMember");
    if (g.members.size !== 2 || product?.size !== 1 || service?.size !== 1 || hasConsolidated(g.unit, g.start, g.end)) continue;
    // One line per period and currency: the first standard line in SEGMENT_REVENUE_TAGS order.
    const period = `${g.unit}|${g.start}|${g.end}`;
    if (added.has(period)) continue;
    const better = [...groups.values()].find(o => o !== g && `${o.unit}|${o.start}|${o.end}` === period && SEGMENT_REVENUE_TAGS.indexOf(o.tag) < SEGMENT_REVENUE_TAGS.indexOf(g.tag)
      && o.members.size === 2 && o.members.get("us-gaap:ProductMember")?.size === 1 && o.members.get("us-gaap:ServiceMember")?.size === 1);
    if (better) continue;
    added.add(period);
    const [basis, tag] = g.tag.split(":");
    const val = [...product][0] + [...service][0];
    if (val <= 0) continue;
    (((consolidated.facts[basis] ??= {})[tag] ??= { units: {} }).units[g.unit] ??= []).push({ val, start: g.start, end: g.end, filed: filing.filed, accn: filing.accession, form: filing.form });
  }
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: "\"", apos: "'", nbsp: " " };
const decodeEntities = (s: string) => s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, code: string) => code[0] === "#"
  ? String.fromCodePoint(code[1] === "x" || code[1] === "X" ? parseInt(code.slice(2), 16) : Number(code.slice(1))) : ENTITIES[code.toLowerCase()] ?? whole);
const stripTags = (s: string) => decodeEntities(s.replace(/<[^>]*>/g, ""));
function tagAttributes(raw: string): Record<string, string> {
  const out: Record<string, string> = {};
  // A repeated attribute keeps its first value, as an HTML parser does.
  for (const m of raw.matchAll(/([A-Za-z_][\w:.-]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) if (!(m[1] in out)) out[m[1]] = decodeEntities(m[2] ?? m[3] ?? "");
  return out;
}
/** inlineFinancialFacts for a document too large to parse into a tree (L-2, Nov 28: KB's, SHG's, KEP's, AVAL's and six other foreign
 *  banks' and utilities' 20-F documents are 20 to 40 MB, so their annual figures were never read). The same rules, read with plain
 *  pattern scans over the text: consolidated contexts of the company's own CIK, single-measure currency or share units, ix:nonFraction
 *  facts with a supported format, sign and scale, the company's own capital-spending line, and the income statement's revenue line. A
 *  test holds it to the tree reader's answer on the same documents. */
export function inlineFinancialFactsText(html: string, cik: string, filing: FinancialFiling, headerHtml?: string): SecFacts {
  const result: SecFacts = { cik: Number(cik), facts: {} };
  const sources = headerHtml ? [headerHtml, html] : [html];
  const contexts = new Map<string, { start?: string; end: string }>();
  for (const source of sources) for (const m of source.matchAll(/<xbrli:context\b([^>]*)>([\s\S]*?)<\/xbrli:context\s*>/gi)) {
    const id = tagAttributes(m[1]).id, body = m[2];
    const identifier = /<xbrli:identifier\b([^>]*)>([\s\S]*?)<\/xbrli:identifier\s*>/i.exec(body);
    if (!id || !identifier || tagAttributes(identifier[1]).scheme !== "http://www.sec.gov/CIK" || Number(stripTags(identifier[2]).trim()) !== Number(cik) || /<xbrli:(?:segment|scenario)\b/i.test(body)) continue;
    const read = (name: string) => { const found = new RegExp(`<xbrli:${name}\\b[^>]*>([\\s\\S]*?)</xbrli:${name}\\s*>`, "i").exec(body); return found ? stripTags(found[1]).trim() : undefined; };
    const start = date(read("startDate")), end = date(read("endDate") ?? read("instant"));
    if (end && end <= filing.filed && (!start || start <= end)) contexts.set(id, { ...(start ? { start } : {}), end });
  }
  const units = new Map<string, string>();
  for (const source of sources) for (const m of source.matchAll(/<xbrli:unit\b([^>]*)>([\s\S]*?)<\/xbrli:unit\s*>/gi)) {
    const id = tagAttributes(m[1]).id, measures = [...m[2].matchAll(/<xbrli:measure\b[^>]*>([\s\S]*?)<\/xbrli:measure\s*>/gi)];
    if (!id || measures.length !== 1 || /<xbrli:divide\b/i.test(m[2])) continue;
    const name = stripTags(measures[0][1]).trim();
    if (/^iso4217:[A-Z]{3}$/.test(name)) units.set(id, name.split(":")[1]);
    if (name === "xbrli:shares") units.set(id, "shares");
  }
  // Facts can nest (COP: the same share count for two dates, one ix:nonFraction inside the other): each opening tag is paired with its own
  // closing tag, and its text is everything between them.
  const facts: [string, string][] = [];
  const open: { attrs: string; from: number }[] = [];
  for (const m of html.matchAll(/<(\/?)ix:nonFraction\b([^>]*?)(\/?)>/gi)) {
    if (m[1]) { const top = open.pop(); if (top) facts.push([top.attrs, html.slice(top.from, m.index)]); }
    else if (!m[3]) open.push({ attrs: m[2], from: m.index + m[0].length });
  }
  for (const m of facts.map(([attrs, body]) => [undefined, attrs, "", body] as const)) {
    const attrs = tagAttributes(m[1]), name = attrs.name?.split(":"), context = contexts.get(attrs.contextRef), unit = units.get(attrs.unitRef);
    const extensionCapex = !!name && name.length === 2 && !["us-gaap","ifrs-full","dei","srt"].includes(name[0]) && /^PaymentsToAcquirePropert(?:y|ies)(?:Plant)?AndEquipment(?:Net)?$/.test(name[1]);
    if (!name || name.length !== 2 || (!["us-gaap","ifrs-full"].includes(name[0]) && !extensionCapex) || !context || !unit || attrs["xsi:nil"] === "true" || attrs.continuedAt || /<ix:exclude\b/i.test(m[3])) continue;
    const format = attrs.format?.split(":")[1];
    if (format && !["num-dot-decimal", "numdotdecimal", "num-comma-decimal", "numcommadecimal", "zerodash", "fixed-zero"].includes(format)) continue;
    let text = stripTags(m[3]).trim().replace(/[\s ]/g, "");
    if (["zerodash","fixed-zero"].includes(format) && /^[-–—]$/.test(text)) text = "0";
    else if (["num-comma-decimal","numcommadecimal"].includes(format)) text = text.replaceAll(".", "").replace(",", ".");
    else text = text.replaceAll(",", "");
    if (!/^\d+(?:\.\d+)?$/.test(text) || (attrs.sign && attrs.sign !== "-")) continue;
    const scale = attrs.scale === undefined ? 0 : Number(attrs.scale);
    if (!Number.isInteger(scale) || Math.abs(scale) > 18) continue;
    const val = Number(text) * 10 ** scale * (attrs.sign === "-" ? -1 : 1);
    if (!Number.isFinite(val) || Math.abs(val) > Number.MAX_SAFE_INTEGER) continue;
    const tag = extensionCapex ? ((result.facts["us-gaap"] ??= {})["TechPhaseExtensionCapex"] ??= { units: {} }) : ((result.facts[name[0]] ??= {})[name[1]] ??= { units: {} });
    (tag.units[unit] ??= []).push({ val, ...context, filed: filing.filed, accn: filing.accession, form: filing.form });
  }
  const primary = new Set<string>();
  const revenueNames = new Set(["us-gaap:Revenues","us-gaap:RevenueFromContractWithCustomerExcludingAssessedTax","us-gaap:SalesRevenueNet","us-gaap:RegulatedAndUnregulatedOperatingRevenue","ifrs-full:Revenue","ifrs-full:RevenueFromContractsWithCustomers"]);
  for (const table of html.matchAll(/<table\b[\s\S]*?<\/table\s*>/gi)) {
    const text = stripTags(table[0]).replace(/\s+/g, " ");
    if (!INCOME_STATEMENT_NET.test(text) || !/basic.*diluted/i.test(text)) continue;
    for (const m of table[0].matchAll(/<ix:nonFraction\b([^>]*)>/gi)) {
      const attrs = tagAttributes(m[1]), context = contexts.get(attrs.contextRef ?? "");
      if (attrs.name && revenueNames.has(attrs.name) && context?.end === filing.end) primary.add(attrs.name);
    }
  }
  if (primary.size === 1) result.primaryRevenueTag = [...primary][0];
  else if (primary.has("us-gaap:Revenues")) result.primaryRevenueTag = "us-gaap:Revenues";
  productServiceRevenue(html, cik, filing, result, headerHtml);
  return result;
}

export function mergeFinancialFacts(base: unknown, additions: SecFacts[], cik: string): SecFacts {
  const root = object(base);
  const result: SecFacts = Number(root.cik) === Number(cik) ? structuredClone(root) as SecFacts : { cik: Number(cik), facts: {} };
  result.facts ??= {};
  for (const extra of additions) {
    if (extra.cik !== Number(cik)) throw Error("facts-cik-mismatch");
    for (const [basis, tags] of Object.entries(extra.facts)) for (const [name, tag] of Object.entries(tags)) for (const [unit, values] of Object.entries(tag.units)) {
      const target = ((result.facts[basis] ??= {})[name] ??= { units: {} });
      const accessions = new Set(values.map(f => f.accn));
      // Direct consolidated facts replace the same filing's aggregate facts;
      // conflicting direct facts are retained for the extractor to reject.
      target.units[unit] = [...(target.units[unit] ?? []).filter(f => !accessions.has(f.accn)), ...values];
    }
  }
  return result;
}

/** TSMC's quarterly release is an untagged 6-K exhibit. Read its actuals
 * table, verifying period headers, NT$ millions and the published YoY rate.
 * Guidance and USD convenience translations never enter this table parser.
 */
export function tsmQuarterFacts(html: string, cik: string, filing: FinancialFiling): SecFacts | null {
  if (Number(cik) !== 1046179 || !filing.form.startsWith("6-K")) return null;
  const year = Number(filing.end.slice(0,4)), month = Number(filing.end.slice(5,7)), quarter = month / 3;
  if (!Number.isInteger(quarter) || !["03-31","06-30","09-30","12-31"].includes(filing.end.slice(5))) return null;
  const root = parse(html), text = root.textContent.replace(/\s+/g, " ");
  if (!/TSMC\s*\(TWSE:\s*2330,\s*NYSE:\s*TSM\)/.test(text) || !/Unit:\s*NT\$\s*million,\s*except for EPS/i.test(text)) return null;
  const current = `${quarter}Q${String(year).slice(-2)}`, prior = `${quarter}Q${String(year-1).slice(-2)}`;
  for (const table of root.querySelectorAll("table")) {
    const rows = table.querySelectorAll("tr").map(row => row.querySelectorAll("td").map(cell => cell.textContent.replace(/\s+/g," ").trim()));
    if (!rows.some(row => row.length === 6 && row[1].startsWith(`${current}Amount`) && row[2] === `${prior}Amount` && /YoY/.test(row[3]))) continue;
    const revenues = rows.filter(row => row[0] === "Net sales"), incomes = rows.filter(row => row[0] === "Income from operations");
    if (revenues.length !== 1 || incomes.length !== 1) return null;
    const numeric = (s: string): number | null => /^\(?\d{1,3}(?:,\d{3})*(?:\.\d+)?\)?$/.test(s) || /^\(?\d+(?:\.\d+)?\)?$/.test(s) ? Number(s.replace(/[(),]/g,"")) * (s.startsWith("(") ? -1 : 1) : null;
    const revenue = numeric(revenues[0][1]), previous = numeric(revenues[0][2]), income = numeric(incomes[0][1]), reportedGrowth = numeric(revenues[0][3]);
    if (revenue === null || revenue <= 0 || previous === null || previous <= 0 || income === null || reportedGrowth === null || Math.abs((revenue/previous-1)*100-reportedGrowth) > .06) return null;
    const start = `${year}-${String(month-2).padStart(2,"0")}-01`, previousEnd = `${year-1}${filing.end.slice(4)}`, previousStart = `${year-1}${start.slice(4)}`;
    const fact = (val: number, start: string, end: string): SecValue => ({ val: val * 1_000_000, start, end, filed: filing.filed, accn: filing.accession, form: filing.form });
    return { cik: Number(cik), facts: { "ifrs-full": {
      Revenue: { units: { TWD: [fact(revenue,start,filing.end),fact(previous,previousStart,previousEnd)] } },
      ProfitLossFromOperatingActivities: { units: { TWD: [fact(income,start,filing.end)] } },
    } } };
  }
  return null;
}

/** Reviewed TSM statements supersede the earlier rounded earnings release.
 * Only the explicitly headed three-month columns are used for performance;
 * six/nine-month columns remain outside the quarterly comparison.
 */
export function tsmStatementFacts(html: string, cik: string, filing: FinancialFiling): SecFacts | null {
  if (Number(cik) !== 1046179 || !filing.form.startsWith("6-K")) return null;
  const root = parse(html), text = root.textContent.replace(/\s+/g," ");
  if (!text.includes("Taiwan Semiconductor Manufacturing Company Limited and Subsidiaries") || !/CONSOLIDATED STATEMENTS OF COMPREHENSIVE INCOME\s*\(In Thousands of New Taiwan Dollars, Except Earnings Per Share\)/.test(text)) return null;
  const year = Number(filing.end.slice(0,4)), month = Number(filing.end.slice(5,7));
  if (!["03-31","06-30","09-30"].includes(filing.end.slice(5))) return null;
  const months = ["","January","February","March","April","May","June","July","August","September","October","November","December"];
  const period = `${months[month]} ${Number(filing.end.slice(8))}`;
  const tables = root.querySelectorAll("table").map(table => table.querySelectorAll("tr").map(row => row.querySelectorAll("td").map(cell=>cell.textContent.replace(/\s+/g," ").trim()).filter(Boolean)));
  const statements = tables.filter(rows => rows.some(row => row[0] === `For the Three Months Ended ${period}`) && rows.some(row => row[0] === String(year) && row[1] === String(year-1)) && rows.some(row => /^NET REVENUE(?: \(Notes? .+\))?$/.test(row[0] ?? "")));
  if (statements.length !== 1) return null;
  const numeric = (s: string | undefined): number | null => s && /^\$?\(?\d{1,3}(?:,\d{3})*\)?$/.test(s) ? Number(s.replace(/[$(),]/g,"")) * (s.includes("(") ? -1 : 1) : null;
  const rowFor = (rows: string[][], label: RegExp) => { const found=rows.filter(row=>label.test(row[0]??"")); return found.length===1 ? found[0] : null; };
  const revenues = rowFor(statements[0],/^NET REVENUE(?: \(Notes? .+\))?$/), incomes = rowFor(statements[0],/^INCOME FROM OPERATIONS(?: \(Notes? .+\))?$/);
  if (!revenues || !incomes || revenues.length !== 9 || incomes.length !== 9) return null;
  const revenue = numeric(revenues[1]), prior = numeric(revenues[3]), income = numeric(incomes[1]);
  if (revenue === null || revenue<=0 || prior===null || prior<=0 || income===null) return null;
  const start = `${year}-${String(month-2).padStart(2,"0")}-01`;
  const fact = (value: number, end = filing.end, from: string | null = start): SecValue => ({ val: value*1000, ...(from ? {start:from} : {}), end, filed:filing.filed, accn:filing.accession, form:filing.form });
  const values: SecFacts["facts"][string] = {
    Revenue: { units: { TWD: [fact(revenue),fact(prior,`${year-1}${filing.end.slice(4)}`,`${year-1}${start.slice(4)}`)] } },
    ProfitLossFromOperatingActivities: { units: { TWD: [fact(income)] } },
  };
  const balance = tables.filter(rows => rows.some(row=>row[0]===`${period}, ${year}` && row[1]===`December 31, ${year-1}`) && rows.some(row=>row[0]==="Total current assets"));
  if (balance.length===1 && /CONSOLIDATED BALANCE SHEETS\s*\(In Thousands of New Taiwan Dollars\)/.test(text)) {
    for (const [tag,label] of [["CashAndCashEquivalents",/^Cash and cash equivalents(?: \(Notes? .+\))?$/],["CurrentAssets",/^Total current assets$/],["CurrentLiabilities",/^Total current liabilities$/]] as const) {
      const row=rowFor(balance[0],label), value=row?.length===7 ? numeric(row[1]) : null;
      if (value!==null && value>=0) values[tag]={units:{TWD:[fact(value,filing.end,null)]}};
    }
  }
  return {cik:Number(cik),facts:{"ifrs-full":values}};
}
