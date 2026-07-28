import assert from "node:assert/strict";
import test from "node:test";
import {
  americanOdds,
  canAmendBet,
  derivePairBalances,
  gradeParlay,
  isValidMoneyTerm,
  type DebtEntry,
  type OfflineSettlementEntry,
} from "../lib/domain";
import { filterAndSortMarkets } from "../lib/market-ledger";
import type { MarketView } from "../lib/contracts";

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

test("allows bet revisions only while every proposed leg is open", () => {
  const now = Date.parse("2026-07-28T12:00:00.000Z");
  assert.equal(
    canAmendBet(
      "pending",
      [
        { status: "open", closesAt: "2026-07-28T13:00:00.000Z" },
        { status: "open", closesAt: "2026-07-29T13:00:00.000Z" },
      ],
      now,
    ),
    true,
  );
  assert.equal(
    canAmendBet(
      "pending",
      [{ status: "open", closesAt: "2026-07-28T12:00:00.000Z" }],
      now,
    ),
    false,
  );
  assert.equal(
    canAmendBet(
      "pending",
      [{ status: "resolved", closesAt: "2026-07-29T13:00:00.000Z" }],
      now,
    ),
    false,
  );
  assert.equal(
    canAmendBet(
      "maker_won",
      [{ status: "open", closesAt: "2026-07-29T13:00:00.000Z" }],
      now,
    ),
    false,
  );
  assert.equal(canAmendBet("pending", [], now), false);
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

test("filters and orders the All markets ledger independently from the composer", () => {
  const market = (
    id: string,
    status: MarketView["status"],
    closesAt: string,
    overrides: Partial<MarketView> = {},
  ): MarketView => ({
    id,
    question: `${id} question`,
    description: `${id} context`,
    selectionA: `${id} side A`,
    selectionB: `${id} side B`,
    closesAt,
    status,
    winningSelection: null,
    creatorName: "Jordan",
    createdByMe: false,
    createdAt: "2026-07-28T12:00:00.000Z",
    currentRevisionId: `${id}-revision-1`,
    revisionNumber: 1,
    revisions: [],
    ...overrides,
  });
  const markets = [
    market("resolved-latest", "resolved", "2032-01-01T00:00:00.000Z", {
      creatorName: "Taylor Smith",
    }),
    market("open-early", "open", "2030-01-01T00:00:00.000Z"),
    market("void-latest", "void", "2033-01-01T00:00:00.000Z"),
    market("open-late", "open", "2031-01-01T00:00:00.000Z"),
  ];

  assert.deepEqual(
    filterAndSortMarkets(markets, "", "all").map(({ id }) => id),
    ["open-late", "open-early", "resolved-latest", "void-latest"],
  );
  assert.deepEqual(
    filterAndSortMarkets(markets, "smith", "resolved").map(({ id }) => id),
    ["resolved-latest"],
  );
  assert.deepEqual(
    filterAndSortMarkets(markets, "voided", "all").map(({ id }) => id),
    ["void-latest"],
  );
});
