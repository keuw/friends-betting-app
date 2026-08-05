import type { AppAction, ParlayPosition, Selection } from "./contracts";
import { isValidMoneyTerm } from "./domain";

const MAX_TEXT_LENGTH = 500;

export class AppError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export function parseAppAction(input: unknown): AppAction {
  const record = asRecord(input);
  const type = requiredString(record.type, "type");

  switch (type) {
    case "create_market":
      return {
        type,
        question: requiredString(record.question, "question"),
        description: optionalString(record.description, "description"),
        selectionA: requiredString(record.selectionA, "selectionA"),
        selectionB: requiredString(record.selectionB, "selectionB"),
        closesAt: requiredString(record.closesAt, "closesAt"),
      };
    case "edit_market":
      return {
        type,
        marketId: requiredId(record.marketId, "marketId"),
        baseRevisionId: requiredId(
          record.baseRevisionId,
          "baseRevisionId",
        ),
        question: requiredString(record.question, "question"),
        description: optionalString(record.description, "description"),
        selectionA: requiredString(record.selectionA, "selectionA"),
        selectionB: requiredString(record.selectionB, "selectionB"),
        closesAt: requiredString(record.closesAt, "closesAt"),
        changeNote: requiredString(record.changeNote, "changeNote"),
      };
    case "reopen_market":
      return {
        type,
        marketId: requiredId(record.marketId, "marketId"),
        baseRevisionId: requiredId(
          record.baseRevisionId,
          "baseRevisionId",
        ),
        closesAt: requiredString(record.closesAt, "closesAt"),
        changeNote: requiredString(record.changeNote, "changeNote"),
      };
    case "delete_market":
      return {
        type,
        marketId: requiredId(record.marketId, "marketId"),
      };
    case "create_offer":
      return {
        type,
        makerPosition: optionalParlayPosition(record.makerPosition) ?? "back",
        makerRiskCents: requiredMoney(record.makerRiskCents, "makerRiskCents"),
        takerRiskCents: requiredMoney(record.takerRiskCents, "takerRiskCents"),
        legs: requiredLegs(record.legs),
      };
    case "create_counteroffer":
      return {
        type,
        offerId: requiredId(record.offerId, "offerId"),
        parentCounterId: optionalId(
          record.parentCounterId,
          "parentCounterId",
        ),
        makerRiskCents: requiredMoney(record.makerRiskCents, "makerRiskCents"),
        takerRiskCents: requiredMoney(record.takerRiskCents, "takerRiskCents"),
      };
    case "accept_offer":
      return {
        type,
        offerId: requiredId(record.offerId, "offerId"),
        counterId: optionalId(record.counterId, "counterId"),
      };
    case "decline_counteroffer":
      return {
        type,
        counterId: requiredId(record.counterId, "counterId"),
      };
    case "cancel_offer":
      return {
        type,
        offerId: requiredId(record.offerId, "offerId"),
      };
    case "resolve_market": {
      const result = requiredString(record.result, "result");
      if (result !== "a" && result !== "b" && result !== "void") {
        throw new AppError(400, "INVALID_RESULT", "Choose A, B, or void.");
      }
      return {
        type,
        marketId: requiredId(record.marketId, "marketId"),
        marketRevisionId: requiredId(
          record.marketRevisionId,
          "marketRevisionId",
        ),
        result,
      };
    }
    case "unresolve_market": {
      const reason = requiredString(record.reason, "reason");
      if (reason.length < 3 || reason.length > 200) {
        throw new AppError(
          400,
          "INVALID_UNRESOLVE_REASON",
          "Reason must be between 3 and 200 characters.",
        );
      }
      return {
        type,
        marketId: requiredId(record.marketId, "marketId"),
        marketRevisionId: requiredId(
          record.marketRevisionId,
          "marketRevisionId",
        ),
        reason,
      };
    }
    case "propose_bet_revision":
      return {
        type,
        betId: requiredId(record.betId, "betId"),
        makerPosition: optionalParlayPosition(record.makerPosition),
        makerRiskCents: requiredMoney(record.makerRiskCents, "makerRiskCents"),
        takerRiskCents: requiredMoney(record.takerRiskCents, "takerRiskCents"),
        changeNote: requiredString(record.changeNote, "changeNote"),
        legs: requiredLegs(record.legs),
      };
    case "respond_bet_revision": {
      const decision = requiredString(record.decision, "decision");
      if (decision !== "accepted" && decision !== "rejected") {
        throw new AppError(
          400,
          "INVALID_DECISION",
          "Accept or reject the revision.",
        );
      }
      return {
        type,
        betRevisionId: requiredId(
          record.betRevisionId,
          "betRevisionId",
        ),
        decision,
      };
    }
    case "cancel_bet_revision":
      return {
        type,
        betRevisionId: requiredId(
          record.betRevisionId,
          "betRevisionId",
        ),
      };
    case "request_bet_void": {
      const reason = requiredString(record.reason, "reason");
      if (reason.length < 3 || reason.length > 200) {
        throw new AppError(
          400,
          "INVALID_VOID_REASON",
          "Reason must be between 3 and 200 characters.",
        );
      }
      return {
        type,
        betId: requiredId(record.betId, "betId"),
        reason,
      };
    }
    case "respond_bet_void": {
      const decision = requiredString(record.decision, "decision");
      if (decision !== "accepted" && decision !== "rejected") {
        throw new AppError(
          400,
          "INVALID_DECISION",
          "Accept or reject the void request.",
        );
      }
      return {
        type,
        betVoidRequestId: requiredId(
          record.betVoidRequestId,
          "betVoidRequestId",
        ),
        decision,
      };
    }
    case "cancel_bet_void":
      return {
        type,
        betVoidRequestId: requiredId(
          record.betVoidRequestId,
          "betVoidRequestId",
        ),
      };
    case "propose_offline_settlement":
      return {
        type,
        creditorUserId: requiredId(
          record.creditorUserId,
          "creditorUserId",
        ),
        amountCents: requiredMoney(record.amountCents, "amountCents"),
      };
    case "respond_offline_settlement": {
      const decision = requiredString(record.decision, "decision");
      if (decision !== "confirmed" && decision !== "rejected") {
        throw new AppError(
          400,
          "INVALID_DECISION",
          "Confirm or reject the settlement.",
        );
      }
      return {
        type,
        settlementId: requiredId(record.settlementId, "settlementId"),
        decision,
      };
    }
    default:
      throw new AppError(400, "UNKNOWN_ACTION", "Unknown action.");
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new AppError(400, "INVALID_BODY", "Expected a JSON object.");
  }
  return value as Record<string, unknown>;
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new AppError(400, "INVALID_FIELD", `${field} is required.`);
  }
  if (value.length > MAX_TEXT_LENGTH) {
    throw new AppError(400, "FIELD_TOO_LONG", `${field} is too long.`);
  }
  return value.trim();
}

function optionalString(value: unknown, field: string): string {
  if (value === undefined || value === null) return "";
  if (typeof value !== "string") {
    throw new AppError(400, "INVALID_FIELD", `${field} must be text.`);
  }
  if (value.length > MAX_TEXT_LENGTH) {
    throw new AppError(400, "FIELD_TOO_LONG", `${field} is too long.`);
  }
  return value.trim();
}

function requiredId(value: unknown, field: string): string {
  const id = requiredString(value, field);
  if (id.length > 100) {
    throw new AppError(400, "INVALID_ID", `${field} is invalid.`);
  }
  return id;
}

function optionalId(value: unknown, field: string): string | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  return requiredId(value, field);
}

function optionalParlayPosition(
  value: unknown,
): ParlayPosition | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  if (value !== "back" && value !== "fade") {
    throw new AppError(
      400,
      "INVALID_POSITION",
      "Choose whether to back or fade the parlay.",
    );
  }
  return value;
}

function requiredMoney(value: unknown, field: string): number {
  if (typeof value !== "number" || !isValidMoneyTerm(value)) {
    throw new AppError(
      400,
      "INVALID_MONEY",
      `${field} must be positive whole cents.`,
    );
  }
  return value;
}

function requiredLegs(
  value: unknown,
): Array<{
  marketId: string;
  marketRevisionId: string;
  selection: Selection;
}> {
  if (!Array.isArray(value) || value.length === 0) {
    throw new AppError(400, "LEGS_REQUIRED", "Choose at least one selection.");
  }
  return value.map((rawLeg) => {
    const leg = asRecord(rawLeg);
    const selection = requiredString(leg.selection, "selection");
    if (selection !== "a" && selection !== "b") {
      throw new AppError(400, "INVALID_SELECTION", "Choose side A or B.");
    }
    return {
      marketId: requiredId(leg.marketId, "marketId"),
      marketRevisionId: requiredId(
        leg.marketRevisionId,
        "marketRevisionId",
      ),
      selection,
    };
  });
}
