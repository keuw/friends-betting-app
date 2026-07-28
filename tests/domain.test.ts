import assert from "node:assert/strict";
import test from "node:test";
import {
  americanOdds,
  derivePairBalances,
  gradeParlay,
  isValidMoneyTerm,
  type DebtEntry,
  type OfflineSettlementEntry,
} from "../lib/domain";

test("derives American odds from exact two-sided risk", () => {
  assert.equal(americanOdds(10_000, 15_000), 150);
  assert.equal(americanOdds(15_000, 10_000), -150);
  assert.equal(americanOdds(10_000, 10_000), 100);
});

test("rejects invalid money terms", () => {
  assert.equal(isValidMoneyTerm(1), true);
  assert.equal(isValidMoneyTerm(100_00), true);
  assert.equal(isValidMoneyTerm(0), false);
  assert.equal(isValidMoneyTerm(-1), false);
  assert.equal(isValidMoneyTerm(1.5), false);
  assert.equal(isValidMoneyTerm(Number.MAX_SAFE_INTEGER + 1), false);
});

test("grades parlays from the maker proposition", () => {
  assert.equal(gradeParlay(["won"]), "maker_won");
  assert.equal(gradeParlay(["won", "won", "void"]), "maker_won");
  assert.equal(gradeParlay(["won", "pending"]), "pending");
  assert.equal(gradeParlay(["lost", "pending"]), "taker_won");
  assert.equal(gradeParlay(["void", "void"]), "void");
  assert.equal(gradeParlay([]), "void");
});

test("nets reciprocal debts and confirmed offline settlements", () => {
  const debts: DebtEntry[] = [
    {
      id: "debt-1",
      debtorUserId: "alice",
      creditorUserId: "bob",
      amountCents: 15_000,
    },
    {
      id: "debt-2",
      debtorUserId: "bob",
      creditorUserId: "alice",
      amountCents: 10_000,
    },
  ];
  const settlements: OfflineSettlementEntry[] = [
    {
      id: "payment-1",
      debtorUserId: "alice",
      creditorUserId: "bob",
      amountCents: 2_000,
      status: "confirmed",
    },
    {
      id: "payment-2",
      debtorUserId: "alice",
      creditorUserId: "bob",
      amountCents: 1_000,
      status: "pending",
    },
  ];

  assert.deepEqual(derivePairBalances(debts, settlements), [
    {
      debtorUserId: "alice",
      creditorUserId: "bob",
      amountCents: 3_000,
    },
  ]);
});

test("flips the displayed debtor when reciprocal debt is larger", () => {
  const debts: DebtEntry[] = [
    {
      id: "debt-1",
      debtorUserId: "alice",
      creditorUserId: "bob",
      amountCents: 5_000,
    },
    {
      id: "debt-2",
      debtorUserId: "bob",
      creditorUserId: "alice",
      amountCents: 8_000,
    },
  ];

  assert.deepEqual(derivePairBalances(debts, []), [
    {
      debtorUserId: "bob",
      creditorUserId: "alice",
      amountCents: 3_000,
    },
  ]);
});
