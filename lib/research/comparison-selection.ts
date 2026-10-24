type Company = { ticker: string; name: string };

/** Mouse and keyboard selection share exactly the same eligible companies. */
export function comparisonChoices<T extends Company>(companies: T[], selection: string[], slot: number): T[] {
  return companies.filter(company => !selection.some((ticker, index) => index !== slot && ticker === company.ticker)).slice(0, 10);
}

export function moveChoice(companies: Company[], activeTicker: string | null, direction: 1 | -1): string | null {
  if (!companies.length) return null;
  const current = companies.findIndex(company => company.ticker === activeTicker);
  const next = current < 0 ? (direction === 1 ? 0 : companies.length - 1) : (current + direction + companies.length) % companies.length;
  return companies[next].ticker;
}

/** An exact ticker or an explicitly highlighted candidate is safe to select. */
export function enterChoice<T extends Company>(companies: T[], query: string, activeTicker: string | null): T | undefined {
  return companies.find(company => company.ticker === activeTicker)
    ?? companies.find(company => company.ticker.toLowerCase() === query.trim().toLowerCase());
}
