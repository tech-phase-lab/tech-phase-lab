/** Company names as the price screens show them, never cut with 「…」 (owner, Nov 25: 「Alphabet / Goo…」): the first of two names written
 * "A / B" ("Alphabet / Google" → "Alphabet"), and no legal suffix ("Micron Technology Inc" → "Micron Technology"). A name still too long for its
 * place wraps to a second line. */
export function shortCompanyName(name: string): string {
  const first = name.split(" / ")[0].trim() || name;
  return first.replace(/[,.]?\s+(Inc|Incorporated|Corp|Corporation|Co|Company|Ltd|Limited|PLC|Plc|N\.V|S\.A|Holdings?)\.?(\s+Class [A-C])?$/i, "").replace(/\s+/g, " ").trim() || first;
}
