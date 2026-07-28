import { getChatGPTUser } from "@/app/chatgpt-auth";
import { ensureSchema, getD1 } from "@/db";
import {
  derivePairBalances,
  gradeParlay,
  isValidMoneyTerm,
  type DebtEntry,
  type LegResult,
  type OfflineSettlementEntry,
} from "@/lib/domain";
import type {
  AppAction,
  AppState,
  BetStatus,
  MarketStatus,
  OfferStatus,
  Selection,
  SettlementStatus,
} from "@/lib/contracts";

type AppUser = {
  id: string;
  email: string;
  displayName: string;
};

type UserRow = {
  id: string;
  email: string;
  display_name: string;
};

type MarketRow = {
  id: string;
  question: string;
  description: string;
  selection_a: string;
  selection_b: string;
  closes_at: string;
  status: MarketStatus;
  winning_selection: Selection | null;
  creator_user_id: string;
  creator_name: string;
  created_at: string;
};

type OfferRow = {
  id: string;
  maker_user_id: string;
  maker_name: string;
  maker_risk_cents: number;
  taker_risk_cents: number;
  status: OfferStatus;
  created_at: string;
  accepted_at: string | null;
};

type OfferLegRow = {
  offer_id: string;
  market_id: string;
  market_question: string;
  market_closes_at: string;
  selection_a: string;
  selection_b: string;
  maker_selection: Selection;
  market_status: MarketStatus;
};

type CounterRow = {
  id: string;
  root_offer_id: string;
  parent_counter_id: string | null;
  challenger_user_id: string;
  challenger_name: string;
  proposer_user_id: string;
  proposer_name: string;
  recipient_user_id: string;
  recipient_name: string;
  maker_risk_cents: number;
  taker_risk_cents: number;
  status: "pending" | "accepted" | "superseded";
  created_at: string;
};

type BetRow = {
  id: string;
  offer_id: string;
  maker_user_id: string;
  maker_name: string;
  taker_user_id: string;
  taker_name: string;
  maker_risk_cents: number;
  taker_risk_cents: number;
  status: BetStatus;
  accepted_at: string;
  settled_at: string | null;
};

type DebtRow = {
  id: string;
  debtor_user_id: string;
  creditor_user_id: string;
  amount_cents: number;
};

type SettlementRow = {
  id: string;
  debtor_user_id: string;
  debtor_name: string;
  creditor_user_id: string;
  creditor_name: string;
  amount_cents: number;
  status: SettlementStatus;
  proposed_at: string;
  responded_at: string | null;
};

type AuditRow = {
  id: string;
  actor_name: string;
  action: string;
  entity_type: string;
  entity_id: string;
  metadata_json: string;
  created_at: string;
};

type RootOfferRow = {
  id: string;
  maker_user_id: string;
  maker_risk_cents: number;
  taker_risk_cents: number;
  status: OfferStatus;
};

type CounterDetailRow = {
  id: string;
  root_offer_id: string;
  parent_counter_id: string | null;
  challenger_user_id: string;
  proposer_user_id: string;
  recipient_user_id: string;
  maker_risk_cents: number;
  taker_risk_cents: number;
  status: "pending" | "accepted" | "superseded";
};

type PendingBetLegRow = {
  bet_id: string;
  offer_id: string;
  maker_user_id: string;
  taker_user_id: string;
  maker_risk_cents: number;
  taker_risk_cents: number;
  maker_selection: Selection;
  market_status: MarketStatus;
  winning_selection: Selection | null;
};

const MAX_TEXT_LENGTH = 500;
const MAX_LEGS = 8;

export class AppError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export async function requireAppUser(): Promise<AppUser> {
  const identity = await getChatGPTUser();
  if (!identity) {
    throw new AppError(401, "SIGN_IN_REQUIRED", "Sign in with ChatGPT first.");
  }

  await ensureSchema();
  const db = getD1();
  const email = identity.email.trim().toLowerCase();
  const displayName = identity.displayName.trim() || email.split("@")[0];

  await db
    .prepare(
      `INSERT INTO users (id, email, display_name)
       VALUES (?, ?, ?)
       ON CONFLICT(email) DO UPDATE SET display_name = excluded.display_name`,
    )
    .bind(crypto.randomUUID(), email, displayName)
    .run();

  const user = await first<UserRow>(
    db
      .prepare(
        `SELECT id, email, display_name
         FROM users
         WHERE email = ?`,
      )
      .bind(email),
  );
  if (!user) {
    throw new AppError(500, "USER_INIT_FAILED", "Could not initialize user.");
  }

  return {
    id: user.id,
    email: user.email,
    displayName: user.display_name,
  };
}

export async function getAppState(user: AppUser): Promise<AppState> {
  await ensureSchema();
  await expireStaleOffers();
  await settlePendingBets();

  const db = getD1();
  const [
    usersResult,
    marketsResult,
    offersResult,
    legsResult,
    countersResult,
    betsResult,
    debtsResult,
    settlementsResult,
    activityResult,
  ] = await db.batch([
    db.prepare(`SELECT id, email, display_name FROM users`),
    db.prepare(
      `SELECT m.*, u.display_name AS creator_name
       FROM markets m
       JOIN users u ON u.id = m.creator_user_id
       ORDER BY
         CASE m.status WHEN 'open' THEN 0 WHEN 'resolved' THEN 1 ELSE 2 END,
         datetime(m.closes_at) DESC,
         datetime(m.created_at) DESC`,
    ),
    db.prepare(
      `SELECT o.*, u.display_name AS maker_name
       FROM offers o
       JOIN users u ON u.id = o.maker_user_id
       ORDER BY
         CASE o.status WHEN 'open' THEN 0 ELSE 1 END,
         datetime(o.created_at) DESC
       LIMIT 100`,
    ),
    db.prepare(
      `SELECT l.offer_id, l.market_id, l.maker_selection,
              m.question AS market_question, m.selection_a, m.selection_b,
              m.closes_at AS market_closes_at, m.status AS market_status
       FROM offer_legs l
       JOIN markets m ON m.id = l.market_id
       ORDER BY l.offer_id, m.closes_at`,
    ),
    db.prepare(
      `SELECT c.*,
              challenger.display_name AS challenger_name,
              proposer.display_name AS proposer_name,
              recipient.display_name AS recipient_name
       FROM counteroffers c
       JOIN users challenger ON challenger.id = c.challenger_user_id
       JOIN users proposer ON proposer.id = c.proposer_user_id
       JOIN users recipient ON recipient.id = c.recipient_user_id
       ORDER BY datetime(c.created_at) ASC`,
    ),
    db.prepare(
      `SELECT b.*,
              maker.display_name AS maker_name,
              taker.display_name AS taker_name
       FROM bets b
       JOIN users maker ON maker.id = b.maker_user_id
       JOIN users taker ON taker.id = b.taker_user_id
       ORDER BY datetime(b.accepted_at) DESC
       LIMIT 100`,
    ),
    db.prepare(
      `SELECT id, debtor_user_id, creditor_user_id, amount_cents
       FROM debts`,
    ),
    db.prepare(
      `SELECT s.*,
              debtor.display_name AS debtor_name,
              creditor.display_name AS creditor_name
       FROM offline_settlements s
       JOIN users debtor ON debtor.id = s.debtor_user_id
       JOIN users creditor ON creditor.id = s.creditor_user_id
       ORDER BY datetime(s.proposed_at) DESC
       LIMIT 100`,
    ),
    db.prepare(
      `SELECT a.*, u.display_name AS actor_name
       FROM audit_events a
       JOIN users u ON u.id = a.actor_user_id
       ORDER BY datetime(a.created_at) DESC
       LIMIT 40`,
    ),
  ]);

  const users = rows<UserRow>(usersResult);
  const userNames = new Map(users.map((row) => [row.id, row.display_name]));
  const marketRows = rows<MarketRow>(marketsResult);
  const offerRows = rows<OfferRow>(offersResult);
  const legRows = rows<OfferLegRow>(legsResult);
  const counterRows = rows<CounterRow>(countersResult);
  const betRows = rows<BetRow>(betsResult);
  const debtRows = rows<DebtRow>(debtsResult);
  const settlementRows = rows<SettlementRow>(settlementsResult);

  const legsByOffer = groupBy(legRows, (row) => row.offer_id);
  const countersByOffer = groupBy(counterRows, (row) => row.root_offer_id);

  const pairBalances = derivePairBalances(
    debtRows.map<DebtEntry>((row) => ({
      id: row.id,
      debtorUserId: row.debtor_user_id,
      creditorUserId: row.creditor_user_id,
      amountCents: row.amount_cents,
    })),
    settlementRows.map<OfflineSettlementEntry>((row) => ({
      id: row.id,
      debtorUserId: row.debtor_user_id,
      creditorUserId: row.creditor_user_id,
      amountCents: row.amount_cents,
      status: row.status,
    })),
  );

  return {
    viewer: { id: user.id, displayName: user.displayName },
    markets: marketRows.map((market) => ({
      id: market.id,
      question: market.question,
      description: market.description,
      selectionA: market.selection_a,
      selectionB: market.selection_b,
      closesAt: market.closes_at,
      status: market.status,
      winningSelection: market.winning_selection,
      creatorName: market.creator_name,
      createdByMe: market.creator_user_id === user.id,
      createdAt: market.created_at,
    })),
    offers: offerRows.map((offer) => ({
      id: offer.id,
      makerName: offer.maker_name,
      makerRiskCents: offer.maker_risk_cents,
      takerRiskCents: offer.taker_risk_cents,
      status: offer.status,
      createdAt: offer.created_at,
      acceptedAt: offer.accepted_at,
      isMine: offer.maker_user_id === user.id,
      legs: toLegViews(legsByOffer.get(offer.id) ?? []),
      counters: (countersByOffer.get(offer.id) ?? []).map((counter) => ({
        id: counter.id,
        parentCounterId: counter.parent_counter_id,
        challengerName: counter.challenger_name,
        proposerName: counter.proposer_name,
        recipientName: counter.recipient_name,
        makerRiskCents: counter.maker_risk_cents,
        takerRiskCents: counter.taker_risk_cents,
        status: counter.status,
        createdAt: counter.created_at,
        canRespond:
          counter.status === "pending" &&
          counter.recipient_user_id === user.id,
      })),
    })),
    bets: betRows.map((bet) => ({
      id: bet.id,
      makerName: bet.maker_name,
      takerName: bet.taker_name,
      makerRiskCents: bet.maker_risk_cents,
      takerRiskCents: bet.taker_risk_cents,
      status: bet.status,
      acceptedAt: bet.accepted_at,
      settledAt: bet.settled_at,
      isParticipant:
        bet.maker_user_id === user.id || bet.taker_user_id === user.id,
      mySide:
        bet.maker_user_id === user.id
          ? "maker"
          : bet.taker_user_id === user.id
            ? "taker"
            : null,
      legs: toLegViews(legsByOffer.get(bet.offer_id) ?? []),
    })),
    pairBalances: pairBalances.map((balance) => ({
      debtorUserId: balance.debtorUserId,
      debtorName: userNames.get(balance.debtorUserId) ?? "Unknown",
      creditorUserId: balance.creditorUserId,
      creditorName: userNames.get(balance.creditorUserId) ?? "Unknown",
      amountCents: balance.amountCents,
      involvesMe:
        balance.debtorUserId === user.id ||
        balance.creditorUserId === user.id,
      iOwe: balance.debtorUserId === user.id,
      owedToMe: balance.creditorUserId === user.id,
    })),
    settlements: settlementRows.map((settlement) => ({
      id: settlement.id,
      debtorName: settlement.debtor_name,
      creditorName: settlement.creditor_name,
      amountCents: settlement.amount_cents,
      status: settlement.status,
      proposedAt: settlement.proposed_at,
      respondedAt: settlement.responded_at,
      canRespond:
        settlement.status === "pending" &&
        settlement.creditor_user_id === user.id,
      isMine:
        settlement.debtor_user_id === user.id ||
        settlement.creditor_user_id === user.id,
    })),
    activity: rows<AuditRow>(activityResult).map((activity) => ({
      id: activity.id,
      actorName: activity.actor_name,
      action: activity.action,
      entityType: activity.entity_type,
      entityId: activity.entity_id,
      metadata: safeJson(activity.metadata_json),
      createdAt: activity.created_at,
    })),
  };
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
    case "create_offer":
      return {
        type,
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
        result,
      };
    }
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

export async function performAction(
  user: AppUser,
  action: AppAction,
): Promise<void> {
  await ensureSchema();

  switch (action.type) {
    case "create_market":
      await createMarket(user, action);
      return;
    case "create_offer":
      await createOffer(user, action);
      return;
    case "create_counteroffer":
      await createCounteroffer(user, action);
      return;
    case "accept_offer":
      await acceptOffer(user, action);
      return;
    case "cancel_offer":
      await cancelOffer(user, action.offerId);
      return;
    case "resolve_market":
      await resolveMarket(user, action.marketId, action.result);
      return;
    case "propose_offline_settlement":
      await proposeOfflineSettlement(
        user,
        action.creditorUserId,
        action.amountCents,
      );
      return;
    case "respond_offline_settlement":
      await respondOfflineSettlement(
        user,
        action.settlementId,
        action.decision,
      );
  }
}

async function createMarket(
  user: AppUser,
  action: Extract<AppAction, { type: "create_market" }>,
): Promise<void> {
  const question = boundedText(action.question, "Question", 5, 160);
  const description = boundedText(action.description, "Description", 0, 500);
  const selectionA = boundedText(action.selectionA, "Selection A", 1, 60);
  const selectionB = boundedText(action.selectionB, "Selection B", 1, 60);
  if (selectionA.toLowerCase() === selectionB.toLowerCase()) {
    throw new AppError(
      400,
      "DUPLICATE_SELECTIONS",
      "Selections must be different.",
    );
  }

  const closesAt = new Date(action.closesAt);
  if (Number.isNaN(closesAt.getTime()) || closesAt.getTime() <= Date.now()) {
    throw new AppError(
      400,
      "INVALID_CLOSE_TIME",
      "Choose a future closing time.",
    );
  }

  const id = crypto.randomUUID();
  const db = getD1();
  await db.batch([
    db
      .prepare(
        `INSERT INTO markets
          (id, question, description, selection_a, selection_b, closes_at, creator_user_id)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        id,
        question,
        description,
        selectionA,
        selectionB,
        closesAt.toISOString(),
        user.id,
      ),
    auditStatement(db, user.id, "created_market", "market", id, {
      question,
    }),
  ]);
}

async function createOffer(
  user: AppUser,
  action: Extract<AppAction, { type: "create_offer" }>,
): Promise<void> {
  if (action.legs.length > MAX_LEGS) {
    throw new AppError(
      400,
      "TOO_MANY_LEGS",
      `Use at most ${MAX_LEGS} legs.`,
    );
  }

  const uniqueMarketIds = new Set(action.legs.map((leg) => leg.marketId));
  if (uniqueMarketIds.size !== action.legs.length) {
    throw new AppError(
      400,
      "DUPLICATE_MARKET",
      "A parlay can use each market only once.",
    );
  }

  const marketRows = await getMarketsByIds([...uniqueMarketIds]);
  if (marketRows.length !== uniqueMarketIds.size) {
    throw new AppError(404, "MARKET_NOT_FOUND", "A selected market is missing.");
  }

  const nowMs = Date.now();
  for (const market of marketRows) {
    if (
      market.status !== "open" ||
      new Date(market.closes_at).getTime() <= nowMs
    ) {
      throw new AppError(
        409,
        "MARKET_CLOSED",
        "A selected market is already closed.",
      );
    }
  }

  const offerId = crypto.randomUUID();
  const expiresAt = marketRows
    .map((market) => market.closes_at)
    .sort()[0];
  const db = getD1();
  const statements: D1PreparedStatement[] = [
    db
      .prepare(
        `INSERT INTO offers
          (id, maker_user_id, maker_risk_cents, taker_risk_cents, expires_at)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .bind(
        offerId,
        user.id,
        action.makerRiskCents,
        action.takerRiskCents,
        expiresAt,
      ),
  ];
  for (const leg of action.legs) {
    statements.push(
      db
        .prepare(
          `INSERT INTO offer_legs
            (id, offer_id, market_id, maker_selection)
           VALUES (?, ?, ?, ?)`,
        )
        .bind(crypto.randomUUID(), offerId, leg.marketId, leg.selection),
    );
  }
  statements.push(
    auditStatement(db, user.id, "created_offer", "offer", offerId, {
      makerRiskCents: action.makerRiskCents,
      takerRiskCents: action.takerRiskCents,
      legCount: action.legs.length,
    }),
  );
  await db.batch(statements);
}

async function createCounteroffer(
  user: AppUser,
  action: Extract<AppAction, { type: "create_counteroffer" }>,
): Promise<void> {
  const db = getD1();
  const root = await first<RootOfferRow>(
    db
      .prepare(
        `SELECT id, maker_user_id, maker_risk_cents, taker_risk_cents, status
         FROM offers
         WHERE id = ?`,
      )
      .bind(action.offerId),
  );
  if (!root) {
    throw new AppError(404, "OFFER_NOT_FOUND", "Offer not found.");
  }
  if (root.status !== "open") {
    throw new AppError(409, "OFFER_TAKEN", "This offer is no longer open.");
  }
  const counterMarkets = await getMarketsForOffer(root.id);
  if (
    counterMarkets.length === 0 ||
    counterMarkets.some(
      (market) =>
        market.status !== "open" ||
        new Date(market.closes_at).getTime() <= Date.now(),
    )
  ) {
    throw new AppError(
      409,
      "MARKET_CLOSED",
      "A market in this offer is already closed.",
    );
  }

  let parent: CounterDetailRow | null = null;
  let challengerUserId = user.id;
  let recipientUserId = root.maker_user_id;

  if (action.parentCounterId) {
    parent = await first<CounterDetailRow>(
      db
        .prepare(
          `SELECT *
           FROM counteroffers
           WHERE id = ? AND root_offer_id = ?`,
        )
        .bind(action.parentCounterId, root.id),
    );
    if (!parent || parent.status !== "pending") {
      throw new AppError(
        409,
        "COUNTER_STALE",
        "That counteroffer is no longer active.",
      );
    }
    if (parent.recipient_user_id !== user.id) {
      throw new AppError(
        403,
        "NOT_COUNTER_RECIPIENT",
        "Only the recipient can counter these terms.",
      );
    }
    challengerUserId = parent.challenger_user_id;
    recipientUserId =
      user.id === root.maker_user_id
        ? challengerUserId
        : root.maker_user_id;
  } else if (user.id === root.maker_user_id) {
    throw new AppError(
      400,
      "SELF_COUNTER",
      "Wait for another friend to propose different terms.",
    );
  }

  const counterId = crypto.randomUUID();
  const statements: D1PreparedStatement[] = [
    db
      .prepare(
        `INSERT INTO counteroffers
          (id, root_offer_id, parent_counter_id, challenger_user_id,
           proposer_user_id, recipient_user_id, maker_risk_cents, taker_risk_cents)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        counterId,
        root.id,
        parent?.id ?? null,
        challengerUserId,
        user.id,
        recipientUserId,
        action.makerRiskCents,
        action.takerRiskCents,
      ),
  ];
  if (parent) {
    statements.push(
      db
        .prepare(
          `UPDATE counteroffers
           SET status = 'superseded'
           WHERE id = ? AND status = 'pending'`,
        )
        .bind(parent.id),
    );
  }
  statements.push(
    auditStatement(
      db,
      user.id,
      "created_counteroffer",
      "counteroffer",
      counterId,
      {
        offerId: root.id,
        makerRiskCents: action.makerRiskCents,
        takerRiskCents: action.takerRiskCents,
      },
    ),
  );
  await db.batch(statements);
}

async function acceptOffer(
  user: AppUser,
  action: Extract<AppAction, { type: "accept_offer" }>,
): Promise<void> {
  const db = getD1();
  const root = await first<RootOfferRow>(
    db
      .prepare(
        `SELECT id, maker_user_id, maker_risk_cents, taker_risk_cents, status
         FROM offers
         WHERE id = ?`,
      )
      .bind(action.offerId),
  );
  if (!root) {
    throw new AppError(404, "OFFER_NOT_FOUND", "Offer not found.");
  }
  if (root.status !== "open") {
    throw new AppError(409, "OFFER_TAKEN", "Another friend got there first.");
  }

  let takerUserId = user.id;
  let makerRiskCents = root.maker_risk_cents;
  let takerRiskCents = root.taker_risk_cents;
  let acceptedCounterId: string | null = null;

  if (action.counterId) {
    const counter = await first<CounterDetailRow>(
      db
        .prepare(
          `SELECT *
           FROM counteroffers
           WHERE id = ? AND root_offer_id = ?`,
        )
        .bind(action.counterId, root.id),
    );
    if (!counter || counter.status !== "pending") {
      throw new AppError(
        409,
        "COUNTER_STALE",
        "That counteroffer is no longer active.",
      );
    }
    if (counter.recipient_user_id !== user.id) {
      throw new AppError(
        403,
        "NOT_COUNTER_RECIPIENT",
        "Only the recipient can accept these terms.",
      );
    }
    takerUserId = counter.challenger_user_id;
    makerRiskCents = counter.maker_risk_cents;
    takerRiskCents = counter.taker_risk_cents;
    acceptedCounterId = counter.id;
  } else if (root.maker_user_id === user.id) {
    throw new AppError(400, "SELF_ACCEPT", "You cannot accept your own offer.");
  }

  const marketRows = await getMarketsForOffer(root.id);
  if (
    marketRows.length === 0 ||
    marketRows.some(
      (market) =>
        market.status !== "open" ||
        new Date(market.closes_at).getTime() <= Date.now(),
    )
  ) {
    throw new AppError(
      409,
      "MARKET_CLOSED",
      "A market in this offer is already closed.",
    );
  }
  const betId = crypto.randomUUID();
  try {
    const results = await db.batch([
      db
        .prepare(
          `INSERT INTO bets
            (id, offer_id, maker_user_id, taker_user_id, maker_risk_cents,
             taker_risk_cents, accepted_counter_id)
           SELECT ?, id, maker_user_id, ?, ?, ?, ?
           FROM offers
           WHERE id = ? AND status = 'open'`,
        )
        .bind(
          betId,
          takerUserId,
          makerRiskCents,
          takerRiskCents,
          acceptedCounterId,
          root.id,
        ),
      db
        .prepare(
          `UPDATE offers
           SET status = 'accepted',
               accepted_by_user_id = ?,
               accepted_counter_id = ?,
               accepted_at = CURRENT_TIMESTAMP
           WHERE id = ? AND status = 'open'`,
        )
        .bind(takerUserId, acceptedCounterId, root.id),
      db
        .prepare(
          `UPDATE counteroffers
           SET status = CASE WHEN id = ? THEN 'accepted' ELSE 'superseded' END
           WHERE root_offer_id = ? AND status = 'pending'`,
        )
        .bind(acceptedCounterId ?? "", root.id),
    ]);
    if (results[0].meta.changes !== 1) {
      throw new AppError(
        409,
        "OFFER_TAKEN",
        "Another friend got there first.",
      );
    }
  } catch (error) {
    if (
      error instanceof AppError ||
      String(error).toLowerCase().includes("unique")
    ) {
      throw error instanceof AppError
        ? error
        : new AppError(
            409,
            "OFFER_TAKEN",
            "Another friend got there first.",
          );
    }
    throw error;
  }

  await auditStatement(db, user.id, "accepted_offer", "bet", betId, {
    offerId: root.id,
    acceptedCounterId,
  }).run();
}

async function cancelOffer(user: AppUser, offerId: string): Promise<void> {
  const db = getD1();
  const offer = await first<RootOfferRow>(
    db
      .prepare(
        `SELECT id, maker_user_id, maker_risk_cents, taker_risk_cents, status
         FROM offers
         WHERE id = ?`,
      )
      .bind(offerId),
  );
  if (!offer) {
    throw new AppError(404, "OFFER_NOT_FOUND", "Offer not found.");
  }
  if (offer.maker_user_id !== user.id) {
    throw new AppError(403, "NOT_OFFER_OWNER", "Only the maker can cancel.");
  }
  if (offer.status !== "open") {
    throw new AppError(409, "OFFER_NOT_OPEN", "This offer is no longer open.");
  }

  await db.batch([
    db
      .prepare(
        `UPDATE offers
         SET status = 'cancelled'
         WHERE id = ? AND status = 'open'`,
      )
      .bind(offer.id),
    db
      .prepare(
        `UPDATE counteroffers
         SET status = 'superseded'
         WHERE root_offer_id = ? AND status = 'pending'`,
      )
      .bind(offer.id),
    auditStatement(db, user.id, "cancelled_offer", "offer", offer.id),
  ]);
}

async function resolveMarket(
  user: AppUser,
  marketId: string,
  result: Selection | "void",
): Promise<void> {
  const db = getD1();
  const market = await first<{
    id: string;
    creator_user_id: string;
    status: MarketStatus;
  }>(
    db
      .prepare(
        `SELECT id, creator_user_id, status
         FROM markets
         WHERE id = ?`,
      )
      .bind(marketId),
  );
  if (!market) {
    throw new AppError(404, "MARKET_NOT_FOUND", "Market not found.");
  }
  if (market.creator_user_id !== user.id) {
    throw new AppError(
      403,
      "NOT_MARKET_ORACLE",
      "Only the market creator can resolve it.",
    );
  }
  if (market.status !== "open") {
    throw new AppError(409, "MARKET_RESOLVED", "This market is already final.");
  }

  const update = await db
    .prepare(
      `UPDATE markets
       SET status = ?,
           winning_selection = ?,
           resolved_at = CURRENT_TIMESTAMP
       WHERE id = ? AND status = 'open'`,
    )
    .bind(result === "void" ? "void" : "resolved", result === "void" ? null : result, market.id)
    .run();
  if (update.meta.changes !== 1) {
    throw new AppError(
      409,
      "MARKET_RESOLVED",
      "Another resolution was recorded first.",
    );
  }

  await db.batch([
    db
      .prepare(
        `UPDATE offers
         SET status = 'expired'
         WHERE status = 'open'
           AND id IN (
             SELECT offer_id FROM offer_legs WHERE market_id = ?
           )`,
      )
      .bind(market.id),
    db
      .prepare(
        `UPDATE counteroffers
         SET status = 'superseded'
         WHERE status = 'pending'
           AND root_offer_id IN (
             SELECT offer_id FROM offer_legs WHERE market_id = ?
           )`,
      )
      .bind(market.id),
    auditStatement(db, user.id, "resolved_market", "market", market.id, {
      result,
    }),
  ]);

  await settlePendingBets();
}

async function proposeOfflineSettlement(
  user: AppUser,
  creditorUserId: string,
  amountCents: number,
): Promise<void> {
  if (creditorUserId === user.id) {
    throw new AppError(400, "SELF_SETTLEMENT", "Choose another friend.");
  }
  const balances = await currentPairBalances();
  const balance = balances.find(
    (item) =>
      item.debtorUserId === user.id &&
      item.creditorUserId === creditorUserId,
  );
  if (!balance || amountCents > balance.amountCents) {
    throw new AppError(
      409,
      "SETTLEMENT_TOO_LARGE",
      "That amount is greater than the current net debt.",
    );
  }

  const db = getD1();
  const existing = await first<{ id: string }>(
    db
      .prepare(
        `SELECT id
         FROM offline_settlements
         WHERE debtor_user_id = ?
           AND creditor_user_id = ?
           AND status = 'pending'
         LIMIT 1`,
      )
      .bind(user.id, creditorUserId),
  );
  if (existing) {
    throw new AppError(
      409,
      "SETTLEMENT_PENDING",
      "This friend already has a payment awaiting confirmation.",
    );
  }

  const id = crypto.randomUUID();
  await db.batch([
    db
      .prepare(
        `INSERT INTO offline_settlements
          (id, debtor_user_id, creditor_user_id, amount_cents)
         VALUES (?, ?, ?, ?)`,
      )
      .bind(id, user.id, creditorUserId, amountCents),
    auditStatement(
      db,
      user.id,
      "proposed_offline_settlement",
      "offline_settlement",
      id,
      { amountCents },
    ),
  ]);
}

async function respondOfflineSettlement(
  user: AppUser,
  settlementId: string,
  decision: "confirmed" | "rejected",
): Promise<void> {
  const db = getD1();
  const settlement = await first<{
    id: string;
    debtor_user_id: string;
    creditor_user_id: string;
    amount_cents: number;
    status: SettlementStatus;
  }>(
    db
      .prepare(
        `SELECT *
         FROM offline_settlements
         WHERE id = ?`,
      )
      .bind(settlementId),
  );
  if (!settlement) {
    throw new AppError(404, "SETTLEMENT_NOT_FOUND", "Settlement not found.");
  }
  if (settlement.creditor_user_id !== user.id) {
    throw new AppError(
      403,
      "NOT_SETTLEMENT_RECIPIENT",
      "Only the receiving friend can respond.",
    );
  }
  if (settlement.status === decision) return;
  if (settlement.status !== "pending") {
    throw new AppError(
      409,
      "SETTLEMENT_FINAL",
      "This settlement already has a response.",
    );
  }

  if (decision === "confirmed") {
    const balances = await currentPairBalances();
    const balance = balances.find(
      (item) =>
        item.debtorUserId === settlement.debtor_user_id &&
        item.creditorUserId === settlement.creditor_user_id,
    );
    if (!balance || settlement.amount_cents > balance.amountCents) {
      throw new AppError(
        409,
        "SETTLEMENT_STALE",
        "The net debt changed. Reject this request and create a new amount.",
      );
    }
  }

  const update = await db
    .prepare(
      `UPDATE offline_settlements
       SET status = ?, responded_at = CURRENT_TIMESTAMP
       WHERE id = ? AND status = 'pending'`,
    )
    .bind(decision, settlement.id)
    .run();
  if (update.meta.changes !== 1) {
    throw new AppError(
      409,
      "SETTLEMENT_FINAL",
      "Another response was recorded first.",
    );
  }

  await auditStatement(
    db,
    user.id,
    `${decision}_offline_settlement`,
    "offline_settlement",
    settlement.id,
    { amountCents: settlement.amount_cents },
  ).run();
}

async function expireStaleOffers(): Promise<void> {
  const db = getD1();
  await db.batch([
    db.prepare(
      `UPDATE offers
       SET status = 'expired'
       WHERE status = 'open'
         AND expires_at IS NOT NULL
         AND datetime(expires_at) <= CURRENT_TIMESTAMP`,
    ),
    db.prepare(
      `UPDATE counteroffers
       SET status = 'superseded'
       WHERE status = 'pending'
         AND root_offer_id IN (
           SELECT id FROM offers WHERE status = 'expired'
         )`,
    ),
  ]);
}

async function settlePendingBets(): Promise<void> {
  const db = getD1();
  const pendingLegs = await all<PendingBetLegRow>(
    db.prepare(
      `SELECT b.id AS bet_id, b.offer_id, b.maker_user_id, b.taker_user_id,
              b.maker_risk_cents, b.taker_risk_cents,
              l.maker_selection, m.status AS market_status,
              m.winning_selection
       FROM bets b
       JOIN offer_legs l ON l.offer_id = b.offer_id
       JOIN markets m ON m.id = l.market_id
       WHERE b.status = 'pending'
       ORDER BY b.id`,
    ),
  );
  const byBet = groupBy(pendingLegs, (row) => row.bet_id);
  const statements: D1PreparedStatement[] = [];

  for (const [betId, legs] of byBet) {
    const result = gradeParlay(
      legs.map<LegResult>((leg) => {
        if (leg.market_status === "open") return "pending";
        if (leg.market_status === "void") return "void";
        return leg.winning_selection === leg.maker_selection ? "won" : "lost";
      }),
    );
    if (result === "pending") continue;

    const bet = legs[0];
    statements.push(
      db
        .prepare(
          `UPDATE bets
           SET status = ?, settled_at = CURRENT_TIMESTAMP
           WHERE id = ? AND status = 'pending'`,
        )
        .bind(result, betId),
    );
    if (result === "maker_won") {
      statements.push(
        debtInsertStatement(
          db,
          betId,
          bet.taker_user_id,
          bet.maker_user_id,
          bet.taker_risk_cents,
        ),
      );
    } else if (result === "taker_won") {
      statements.push(
        debtInsertStatement(
          db,
          betId,
          bet.maker_user_id,
          bet.taker_user_id,
          bet.maker_risk_cents,
        ),
      );
    }
  }

  if (statements.length > 0) {
    await db.batch(statements);
  }
}

async function currentPairBalances() {
  const db = getD1();
  const [debtResult, settlementResult] = await db.batch([
    db.prepare(
      `SELECT id, debtor_user_id, creditor_user_id, amount_cents FROM debts`,
    ),
    db.prepare(
      `SELECT id, debtor_user_id, creditor_user_id, amount_cents, status
       FROM offline_settlements`,
    ),
  ]);
  return derivePairBalances(
    rows<DebtRow>(debtResult).map((row) => ({
      id: row.id,
      debtorUserId: row.debtor_user_id,
      creditorUserId: row.creditor_user_id,
      amountCents: row.amount_cents,
    })),
    rows<{
      id: string;
      debtor_user_id: string;
      creditor_user_id: string;
      amount_cents: number;
      status: SettlementStatus;
    }>(settlementResult).map((row) => ({
      id: row.id,
      debtorUserId: row.debtor_user_id,
      creditorUserId: row.creditor_user_id,
      amountCents: row.amount_cents,
      status: row.status,
    })),
  );
}

async function getMarketsByIds(ids: string[]): Promise<
  Array<{
    id: string;
    status: MarketStatus;
    closes_at: string;
    creator_user_id: string;
  }>
> {
  if (ids.length === 0) return [];
  const placeholders = ids.map(() => "?").join(", ");
  return all(
    getD1()
      .prepare(
        `SELECT id, status, closes_at, creator_user_id
         FROM markets
         WHERE id IN (${placeholders})`,
      )
      .bind(...ids),
  );
}

async function getMarketsForOffer(offerId: string): Promise<
  Array<{
    id: string;
    status: MarketStatus;
    closes_at: string;
    creator_user_id: string;
  }>
> {
  return all(
    getD1()
      .prepare(
        `SELECT m.id, m.status, m.closes_at, m.creator_user_id
         FROM offer_legs l
         JOIN markets m ON m.id = l.market_id
         WHERE l.offer_id = ?`,
      )
      .bind(offerId),
  );
}

function debtInsertStatement(
  db: D1Database,
  betId: string,
  debtorUserId: string,
  creditorUserId: string,
  amountCents: number,
): D1PreparedStatement {
  return db
    .prepare(
      `INSERT OR IGNORE INTO debts
        (id, bet_id, debtor_user_id, creditor_user_id, amount_cents)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .bind(
      crypto.randomUUID(),
      betId,
      debtorUserId,
      creditorUserId,
      amountCents,
    );
}

function auditStatement(
  db: D1Database,
  actorUserId: string,
  action: string,
  entityType: string,
  entityId: string,
  metadata: Record<string, unknown> = {},
): D1PreparedStatement {
  return db
    .prepare(
      `INSERT INTO audit_events
        (id, actor_user_id, action, entity_type, entity_id, metadata_json)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      crypto.randomUUID(),
      actorUserId,
      action,
      entityType,
      entityId,
      JSON.stringify(metadata),
    );
}

function toLegViews(rowsForOffer: OfferLegRow[]) {
  return rowsForOffer.map((leg) => ({
    marketId: leg.market_id,
    marketQuestion: leg.market_question,
    marketClosesAt: leg.market_closes_at,
    makerSelection: leg.maker_selection,
    makerSelectionLabel:
      leg.maker_selection === "a" ? leg.selection_a : leg.selection_b,
    marketStatus: leg.market_status,
  }));
}

async function first<T>(
  statement: D1PreparedStatement,
): Promise<T | null> {
  return statement.first<T>();
}

async function all<T>(statement: D1PreparedStatement): Promise<T[]> {
  const result = await statement.all<T>();
  return result.results;
}

function rows<T>(result: D1Result<unknown>): T[] {
  return result.results as T[];
}

function groupBy<T, K>(
  items: readonly T[],
  keyFor: (item: T) => K,
): Map<K, T[]> {
  const grouped = new Map<K, T[]>();
  for (const item of items) {
    const key = keyFor(item);
    const bucket = grouped.get(key);
    if (bucket) bucket.push(item);
    else grouped.set(key, [item]);
  }
  return grouped;
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
): Array<{ marketId: string; selection: Selection }> {
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
      selection,
    };
  });
}

function boundedText(
  value: string,
  field: string,
  min: number,
  max: number,
): string {
  const trimmed = value.trim();
  if (trimmed.length < min || trimmed.length > max) {
    throw new AppError(
      400,
      "INVALID_FIELD",
      `${field} must be between ${min} and ${max} characters.`,
    );
  }
  return trimmed;
}

function safeJson(value: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}
