import assert from "node:assert/strict";
import test from "node:test";
import type { BetStatus } from "../lib/contracts";
import {
  countMatchedBets,
  filterMatchedBets,
  getBetLifecycle,
} from "../lib/bet-ledger";

type TestBet = {
  id: string;
  isParticipant: boolean;
  status: BetStatus;
};

const bets: TestBet[] = [
  { id: "pending-newest", isParticipant: true, status: "pending" },
  { id: "maker-result", isParticipant: true, status: "maker_won" },
  { id: "voided", isParticipant: true, status: "void" },
  { id: "taker-result", isParticipant: false, status: "taker_won" },
  { id: "pending-oldest", isParticipant: false, status: "pending" },
];

test("maps stored bet outcomes to user-facing matched-bet lifecycles", () => {
  assert.equal(getBetLifecycle("pending"), "pending");
  assert.equal(getBetLifecycle("maker_won"), "resolved");
  assert.equal(getBetLifecycle("taker_won"), "resolved");
  assert.equal(getBetLifecycle("void"), "void");
});

test("defaults the current matched-bet ledger to pending and resolved bets", () => {
  assert.deepEqual(
    filterMatchedBets(bets, "current").map(({ id }) => id),
    [
      "pending-newest",
      "maker-result",
      "taker-result",
      "pending-oldest",
    ],
  );
});

test("filters every matched-bet lifecycle without changing input order", () => {
  assert.deepEqual(
    filterMatchedBets(bets, "pending").map(({ id }) => id),
    ["pending-newest", "pending-oldest"],
  );
  assert.deepEqual(
    filterMatchedBets(bets, "resolved").map(({ id }) => id),
    ["maker-result", "taker-result"],
  );
  assert.deepEqual(
    filterMatchedBets(bets, "void").map(({ id }) => id),
    ["voided"],
  );
  assert.deepEqual(
    filterMatchedBets(bets, "all").map(({ id }) => id),
    bets.map(({ id }) => id),
  );
});

test("filters My live to participant-pending bets without changing input order", () => {
  assert.deepEqual(
    filterMatchedBets(bets, "mine").map(({ id }) => id),
    ["pending-newest"],
  );
});

test("counts My live, current, pending, resolved, voided, and all matched bets", () => {
  assert.deepEqual(countMatchedBets(bets), {
    mine: 1,
    current: 4,
    pending: 2,
    resolved: 2,
    void: 1,
    all: 5,
  });
});
