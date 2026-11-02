/** Broker names. A holding belongs to the broker it was read from, so the same ticker at two brokers never overwrites or double counts. */
export const OTHER = "その他";
export const MANUAL = "手入力";
/** The ones offered first in the "取り込み元" sheet. */
export const BROKER_CHOICES = ["楽天証券", "SBI証券", "マネックス証券", "松井証券"] as const;

/** One canonical name per broker, however the screen or the reader wrote it ("SBI", "SBI証券", "SBI Securities" are all SBI証券). */
const KNOWN: [RegExp, string][] = [
  [/sbi/, "SBI証券"],
  [/楽天|rakuten/, "楽天証券"],
  [/マネックス|monex/, "マネックス証券"],
  [/松井|matsui/, "松井証券"],
  [/カブコム|kabucom|kabu\.?com|auかぶ/, "auカブコム証券"],
  [/大和|daiwa/, "大和証券"],
  [/野村|nomura/, "野村證券"],
  [/日興|smbc|nikko/, "SMBC日興証券"],
  [/moomoo|ムームー|futu|フツ/, "moomoo"],
];
const fold = (text: string) => text.normalize("NFKC").toLowerCase().replace(/[\s・･\-_]/g, "");

/** Anything that is not recognised becomes その他 (never asked about). */
export function normalizeBroker(raw: unknown): string {
  if (typeof raw !== "string") return OTHER;
  const text = fold(raw);
  if (!text || /^(その他|不明|unknown|null|none|n\/a)$/.test(text)) return OTHER;
  for (const [pattern, name] of KNOWN) if (pattern.test(text)) return name;
  return OTHER;
}

/** A name typed in by the reader: trimmed, folded onto a known broker when it is one, else kept as typed (up to 20 characters). */
export function typedBroker(raw: string): string {
  const text = raw.trim().slice(0, 20);
  if (!text) return OTHER;
  const known = normalizeBroker(text);
  return known === OTHER ? text : known;
}
