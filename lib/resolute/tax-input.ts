// The tax UI accepts whole yen in both languages. It does not convert currencies.
export const TAX_INPUT_LIMIT = 1_000_000_000_000;
export function parseTaxYen(value: string): number | null {
  if (!/^\d+$/.test(value)) return null;
  const amount = Number(value);
  return Number.isSafeInteger(amount) && amount <= TAX_INPUT_LIMIT ? amount : null;
}
