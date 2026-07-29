export type LegResult = "won" | "lost" | "void" | "pending";
export type BetResult = "maker_won" | "taker_won" | "void" | "pending";
export type RevisionLegWindow = {
  status: "open" | "resolved" | "void";
  closesAt: string;
};

export type DebtEntry = {
  id: string;
  debtorUserId: string;
  creditorUserId: string;
  amountCents: number;
};

export type OfflineSettlementEntry = {
  id: string;
  debtorUserId: string;
  creditorUserId: string;
  amountCents: number;
  status: "pending" | "confirmed" | "rejected" | "cancelled";
};

export type PairBalance = {
  debtorUserId: string;
  creditorUserId: string;
  amountCents: number;
};

export function isValidMoneyTerm(value: number): boolean {
  return Number.isSafeInteger(value) && value > 0;
}

export function americanOdds(riskCents: number, profitCents: number): number {
  if (!isValidMoneyTerm(riskCents) || !isValidMoneyTerm(profitCents)) {
    throw new Error("Risk and profit must be positive integer cents.");
  }

  if (profitCents >= riskCents) {
    return Math.round((profitCents / riskCents) * 100);
  }

  return -Math.round((riskCents / profitCents) * 100);
}

export function gradeParlay(
  results: readonly LegResult[],
  makerPosition: ParlayPosition = "back",
): BetResult {
  if (results.some((result) => result === "lost")) {
    return makerPosition === "back" ? "taker_won" : "maker_won";
  }

  const activeResults = results.filter((result) => result !== "void");
  if (activeResults.length === 0) {
    return "void";
  }

  if (activeResults.some((result) => result === "pending")) {
    return "pending";
  }

  return makerPosition === "back" ? "maker_won" : "taker_won";
}

export function canAmendBet(
  betStatus: BetResult,
  legs: readonly RevisionLegWindow[],
  nowMs = Date.now(),
): boolean {
  return (
    betStatus === "pending" &&
    legs.length > 0 &&
    legs.every(
      (leg) =>
        leg.status === "open" &&
        new Date(leg.closesAt).getTime() > nowMs,
    )
  );
}

export function derivePairBalances(
  debts: readonly DebtEntry[],
  settlements: readonly OfflineSettlementEntry[],
): PairBalance[] {
  const signedBalances = new Map<string, number>();

  for (const debt of debts) {
    addSignedPairAmount(
      signedBalances,
      debt.debtorUserId,
      debt.creditorUserId,
      debt.amountCents,
    );
  }

  for (const settlement of settlements) {
    if (settlement.status !== "confirmed") continue;
    addSignedPairAmount(
      signedBalances,
      settlement.creditorUserId,
      settlement.debtorUserId,
      settlement.amountCents,
    );
  }

  return [...signedBalances.entries()]
    .filter(([, amount]) => amount !== 0)
    .map(([key, amount]) => {
      const [firstUserId, secondUserId] = key.split("\u0000");
      if (amount > 0) {
        return {
          debtorUserId: firstUserId,
          creditorUserId: secondUserId,
          amountCents: amount,
        };
      }
      return {
        debtorUserId: secondUserId,
        creditorUserId: firstUserId,
        amountCents: Math.abs(amount),
      };
    })
    .sort((left, right) => {
      const leftKey = `${left.debtorUserId}\u0000${left.creditorUserId}`;
      const rightKey = `${right.debtorUserId}\u0000${right.creditorUserId}`;
      return leftKey.localeCompare(rightKey);
    });
}

function addSignedPairAmount(
  balances: Map<string, number>,
  debtorUserId: string,
  creditorUserId: string,
  amountCents: number,
): void {
  if (!Number.isSafeInteger(amountCents) || amountCents < 0) {
    throw new Error("Pair amounts must be non-negative integer cents.");
  }
  if (debtorUserId === creditorUserId) {
    throw new Error("A user cannot owe themselves.");
  }

  const [firstUserId, secondUserId] =
    debtorUserId < creditorUserId
      ? [debtorUserId, creditorUserId]
      : [creditorUserId, debtorUserId];
  const direction = debtorUserId === firstUserId ? 1 : -1;
  const key = `${firstUserId}\u0000${secondUserId}`;

  balances.set(key, (balances.get(key) ?? 0) + direction * amountCents);
}
import type { ParlayPosition } from "./contracts";
