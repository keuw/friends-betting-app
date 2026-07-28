import assert from "node:assert/strict";
import test from "node:test";
import { AppError, parseAppAction } from "../lib/action-parser";

test("parses market edits against an explicit base revision", () => {
  assert.deepEqual(
    parseAppAction({
      type: "edit_market",
      marketId: "market-1",
      baseRevisionId: "market-revision-1",
      question: "Will the corrected result happen?",
      description: "Corrected context",
      selectionA: "Yes",
      selectionB: "No",
      closesAt: "2030-01-01T00:00:00.000Z",
      changeNote: "Clarified the original wording",
    }),
    {
      type: "edit_market",
      marketId: "market-1",
      baseRevisionId: "market-revision-1",
      question: "Will the corrected result happen?",
      description: "Corrected context",
      selectionA: "Yes",
      selectionB: "No",
      closesAt: "2030-01-01T00:00:00.000Z",
      changeNote: "Clarified the original wording",
    },
  );
});

test("requires exact market revisions for resolution and revised legs", () => {
  assert.throws(
    () =>
      parseAppAction({
        type: "resolve_market",
        marketId: "market-1",
        result: "a",
      }),
    (error: unknown) =>
      error instanceof AppError &&
      error.code === "INVALID_FIELD" &&
      error.message === "marketRevisionId is required.",
  );

  assert.throws(
    () =>
      parseAppAction({
        type: "propose_bet_revision",
        betId: "bet-1",
        makerRiskCents: 1_000,
        takerRiskCents: 1_500,
        changeNote: "Change the selected side",
        legs: [{ marketId: "market-1", selection: "b" }],
      }),
    (error: unknown) =>
      error instanceof AppError &&
      error.code === "INVALID_FIELD" &&
      error.message === "marketRevisionId is required.",
  );
});

test("accepts only explicit bet-revision decisions", () => {
  assert.throws(
    () =>
      parseAppAction({
        type: "respond_bet_revision",
        betRevisionId: "bet-revision-2",
        decision: "maybe",
      }),
    (error: unknown) =>
      error instanceof AppError && error.code === "INVALID_DECISION",
  );

  assert.deepEqual(
    parseAppAction({
      type: "respond_bet_revision",
      betRevisionId: "bet-revision-2",
      decision: "accepted",
    }),
    {
      type: "respond_bet_revision",
      betRevisionId: "bet-revision-2",
      decision: "accepted",
    },
  );
});
