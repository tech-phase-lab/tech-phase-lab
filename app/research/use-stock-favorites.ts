"use client";

import { toggleFavoriteStock } from "@/lib/research/favorites";
import { setFavoriteListMembership, watchlistSlots } from "@/lib/research/favorite-lists";
import { useFavoriteLists } from "./watchlist/use-favorite-lists";

// Stock-page stars use the first list, including its account-scoped sync/journal.
// Other lists and price-alert settings must remain untouched.
export function useStockFavorites() {
  const { lists, update, error, status, ready, editable, retry } = useFavoriteLists();
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
  function setMembership(listId: string, ticker: string, included: boolean, name?: string) {
    if (!ready || !editable) return false;
    return update(current => setFavoriteListMembership(current, listId, ticker, included, name));
  }
  return { favorites: ready ? primary.tickers : [], toggle,
    lists: ready ? watchlistSlots(lists) : [], setMembership, status, retry,
    error: error || status === "error" || status === "conflict", editable: ready && editable };
}
