// Tax calculations use whole yen. Display inputs use 万円, except fees (円).
export const TAX_INPUT_LIMIT = 1_000_000_000_000;
export function parseTaxYen(value: string): number | null {
  if (!/^\d+$/.test(value)) return null;
  const amount = Number(value);
  return Number.isSafeInteger(amount) && amount <= TAX_INPUT_LIMIT ? amount : null;
}

// Exact decimal scaling: up to four places in 万円, with no binary rounding.
export function parseTaxAmount(value:string,unit:"yen"|"man"):number|null {
 if(value==="")return 0;
 if(unit==="yen")return parseTaxYen(value);
 if(!/^\d+(?:\.\d{0,4})?$/.test(value))return null;
 const [whole,fraction=""]=value.split(".");
 const yen=BigInt(whole)*BigInt(10000)+BigInt(fraction.padEnd(4,"0"));
 return yen<=BigInt(TAX_INPUT_LIMIT)?Number(yen):null;
}
