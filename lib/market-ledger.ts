import type { MarketStatus, MarketView } from "./contracts";

export type MarketLedgerFilter = MarketStatus | "all";

const MARKET_STATUS_RANK: Record<MarketStatus, number> = {
  open: 0,
  resolved: 1,
  void: 2,
};

export function filterAndSortMarkets(
  markets: readonly MarketView[],
  query: string,
  statusFilter: MarketLedgerFilter,
): MarketView[] {
  const normalizedQuery = query.trim().toLocaleLowerCase();

  return markets
    .filter((market) => {
      const matchesStatus =
        statusFilter === "all" || market.status === statusFilter;
      const searchableStatus =
        market.status === "void" ? "void voided" : market.status;
      const matchesQuery =
        !normalizedQuery ||
        [
          market.question,
          market.description,
          market.selectionA,
          market.selectionB,
          market.creatorName,
          searchableStatus,
        ].some((value) => value.toLocaleLowerCase().includes(normalizedQuery));

      return matchesStatus && matchesQuery;
    })
    .sort(
      (left, right) =>
        MARKET_STATUS_RANK[left.status] - MARKET_STATUS_RANK[right.status] ||
        new Date(right.closesAt).getTime() -
          new Date(left.closesAt).getTime() ||
        new Date(right.createdAt).getTime() -
          new Date(left.createdAt).getTime(),
    );
}
