"use client";

import { toggleFavoriteStock } from "@/lib/research/favorites";
import { useFavoriteLists } from "./watchlist/use-favorite-lists";

// Stock-page stars use the first list, including its account-scoped sync/journal.
// Other lists and price-alert settings must remain untouched.
export function useStockFavorites() {
  const { lists, update, error, status, ready, editable } = useFavoriteLists();
  const primary = lists.find(list => list.id === "default") ?? lists[0];
  function toggle(ticker: string, name?: string) {
    if (!ready || !editable || !/^[A-Z][A-Z0-9.-]{0,14}$/.test(ticker)) return false;
    return update(current => {
      const lists = current.lists.map(list => list.id === "default"
        ? { ...list, tickers: toggleFavoriteStock(list.tickers, ticker) } : list);
      const added = !current.lists.find(list => list.id === "default")?.tickers.includes(ticker)
        && lists.find(list => list.id === "default")?.tickers.includes(ticker);
      const companyName = name?.trim().slice(0, 160);
      return { ...current, lists,
        names: added && companyName ? { ...current.names, [ticker]: companyName } : current.names,
      };
    });
  }
  return { favorites: ready ? primary.tickers : [], toggle,
    error: error || status === "error" || status === "conflict", editable: ready && editable };
}
