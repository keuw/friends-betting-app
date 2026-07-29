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

test("parses an explicit counteroffer decline", () => {
  assert.deepEqual(
    parseAppAction({
      type: "decline_counteroffer",
      counterId: "counter-1",
    }),
    {
      type: "decline_counteroffer",
      counterId: "counter-1",
    },
  );

  assert.throws(
    () =>
      parseAppAction({
        type: "decline_counteroffer",
      }),
    (error: unknown) =>
      error instanceof AppError &&
      error.code === "INVALID_FIELD" &&
      error.message === "counterId is required.",
  );
});

test("parses Back and Fade positions while preserving legacy defaults", () => {
  const legs = [
    {
      marketId: "market-1",
      marketRevisionId: "market-revision-1",
      selection: "a",
    },
    {
      marketId: "market-2",
      marketRevisionId: "market-revision-2",
      selection: "b",
    },
  ];

  assert.deepEqual(
    parseAppAction({
      type: "create_offer",
      makerRiskCents: 1_000,
      takerRiskCents: 1_500,
      makerPosition: "fade",
      legs,
    }),
    {
      type: "create_offer",
      makerRiskCents: 1_000,
      takerRiskCents: 1_500,
      makerPosition: "fade",
      legs,
    },
  );
  assert.deepEqual(
    parseAppAction({
      type: "create_offer",
      makerRiskCents: 1_000,
      takerRiskCents: 1_500,
      legs,
    }),
    {
      type: "create_offer",
      makerRiskCents: 1_000,
      takerRiskCents: 1_500,
      makerPosition: "back",
      legs,
    },
  );
  assert.deepEqual(
    parseAppAction({
      type: "propose_bet_revision",
      betId: "bet-1",
      makerRiskCents: 1_000,
      takerRiskCents: 1_500,
      makerPosition: "fade",
      changeNote: "Maker now fades the parlay",
      legs,
    }),
    {
      type: "propose_bet_revision",
      betId: "bet-1",
      makerRiskCents: 1_000,
      takerRiskCents: 1_500,
      makerPosition: "fade",
      changeNote: "Maker now fades the parlay",
      legs,
    },
  );

  assert.throws(
    () =>
      parseAppAction({
        type: "create_offer",
        makerRiskCents: 1_000,
        takerRiskCents: 1_500,
        makerPosition: "sometimes",
        legs,
      }),
    (error: unknown) =>
      error instanceof AppError && error.code === "INVALID_POSITION",
  );
});

test("parses unused-market deletion without accepting client-side eligibility", () => {
  assert.deepEqual(
    parseAppAction({
      type: "delete_market",
      marketId: "market-1",
      canDelete: true,
      force: true,
    }),
    {
      type: "delete_market",
      marketId: "market-1",
    },
  );

  assert.throws(
    () => parseAppAction({ type: "delete_market" }),
    (error: unknown) =>
      error instanceof AppError &&
      error.code === "INVALID_FIELD" &&
      error.message === "marketId is required.",
  );
});

test("parses the mutual matched-bet void lifecycle", () => {
  assert.deepEqual(
    parseAppAction({
      type: "request_bet_void",
      betId: "bet-1",
      reason: "We both entered the wrong terms.",
    }),
    {
      type: "request_bet_void",
      betId: "bet-1",
      reason: "We both entered the wrong terms.",
    },
  );
  assert.deepEqual(
    parseAppAction({
      type: "respond_bet_void",
      betVoidRequestId: "void-request-1",
      decision: "accepted",
    }),
    {
      type: "respond_bet_void",
      betVoidRequestId: "void-request-1",
      decision: "accepted",
    },
  );
  assert.deepEqual(
    parseAppAction({
      type: "respond_bet_void",
      betVoidRequestId: "void-request-1",
      decision: "rejected",
    }),
    {
      type: "respond_bet_void",
      betVoidRequestId: "void-request-1",
      decision: "rejected",
    },
  );
  assert.deepEqual(
    parseAppAction({
      type: "cancel_bet_void",
      betVoidRequestId: "void-request-1",
    }),
    {
      type: "cancel_bet_void",
      betVoidRequestId: "void-request-1",
    },
  );

  assert.throws(
    () =>
      parseAppAction({
        type: "request_bet_void",
        betId: "bet-1",
        reason: "No",
      }),
    (error: unknown) =>
      error instanceof AppError &&
      error.code === "INVALID_VOID_REASON",
  );
  assert.throws(
    () =>
      parseAppAction({
        type: "request_bet_void",
        betId: "bet-1",
        reason: "x".repeat(201),
      }),
    (error: unknown) =>
      error instanceof AppError &&
      error.code === "INVALID_VOID_REASON",
  );
  assert.throws(
    () =>
      parseAppAction({
        type: "respond_bet_void",
        betVoidRequestId: "void-request-1",
        decision: "maybe",
      }),
    (error: unknown) =>
      error instanceof AppError &&
      error.code === "INVALID_DECISION",
  );
});
