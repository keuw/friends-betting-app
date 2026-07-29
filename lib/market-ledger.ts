import type { MarketStatus, MarketView } from "./contracts";

export type MarketLifecycle = MarketStatus | "closed";
export type MarketLedgerFilter = MarketLifecycle | "all";

const MARKET_STATUS_RANK: Record<MarketLifecycle, number> = {
  open: 0,
  closed: 1,
  resolved: 2,
  void: 3,
};

export function getMarketLifecycle(
  market: Pick<MarketView, "status" | "closesAt">,
  nowMs = Date.now(),
): MarketLifecycle {
  if (market.status !== "open") return market.status;
  return new Date(market.closesAt).getTime() <= nowMs ? "closed" : "open";
}

export function filterAndSortMarkets(
  markets: readonly MarketView[],
  query: string,
  statusFilter: MarketLedgerFilter,
  nowMs = Date.now(),
): MarketView[] {
  const normalizedQuery = query.trim().toLocaleLowerCase();

  return markets
    .filter((market) => {
      const lifecycle = getMarketLifecycle(market, nowMs);
      const matchesStatus =
        statusFilter === "all" || lifecycle === statusFilter;
      const searchableStatus = {
        open: "open open for offers",
        closed: "closed awaiting result unresolved",
        resolved: "resolved",
        void: "void voided",
      }[lifecycle];
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
        MARKET_STATUS_RANK[getMarketLifecycle(left, nowMs)] -
          MARKET_STATUS_RANK[getMarketLifecycle(right, nowMs)] ||
        new Date(right.closesAt).getTime() -
          new Date(left.closesAt).getTime() ||
        new Date(right.createdAt).getTime() -
          new Date(left.createdAt).getTime(),
    );
}
