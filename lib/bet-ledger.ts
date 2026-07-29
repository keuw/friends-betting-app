import type { BetStatus } from "./contracts";

export type BetLifecycle = "pending" | "resolved" | "void";
export type BetLedgerFilter = BetLifecycle | "mine" | "all";

export const DEFAULT_BET_LEDGER_FILTER: BetLedgerFilter = "pending";

export function shouldShowFirstUseBetLedgerEmpty(
  totalBetCount: number,
  statusFilter: BetLedgerFilter,
): boolean {
  return totalBetCount === 0 && statusFilter === DEFAULT_BET_LEDGER_FILTER;
}

export function getBetLifecycle(status: BetStatus): BetLifecycle {
  if (status === "pending") return "pending";
  if (status === "void") return "void";
  return "resolved";
}

export function filterMatchedBets<
  T extends { isParticipant: boolean; status: BetStatus },
>(
  bets: readonly T[],
  statusFilter: BetLedgerFilter,
): T[] {
  if (statusFilter === "all") return [...bets];
  if (statusFilter === "mine") {
    return bets.filter(
      (bet) => bet.isParticipant && bet.status === "pending",
    );
  }

  return bets.filter((bet) => {
    const lifecycle = getBetLifecycle(bet.status);
    return lifecycle === statusFilter;
  });
}

export function countMatchedBets(
  bets: readonly { isParticipant: boolean; status: BetStatus }[],
): Record<BetLedgerFilter, number> {
  const counts: Record<BetLifecycle, number> = {
    pending: 0,
    resolved: 0,
    void: 0,
  };

  for (const bet of bets) {
    counts[getBetLifecycle(bet.status)] += 1;
  }

  return {
    mine: filterMatchedBets(bets, "mine").length,
    ...counts,
    all: bets.length,
  };
}
