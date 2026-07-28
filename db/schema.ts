import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

const now = sql`CURRENT_TIMESTAMP`;

export const users = sqliteTable(
  "users",
  {
    id: text("id").primaryKey(),
    email: text("email").notNull(),
    displayName: text("display_name").notNull(),
    createdAt: text("created_at").notNull().default(now),
  },
  (table) => [uniqueIndex("users_email_unique").on(table.email)],
);

export const markets = sqliteTable(
  "markets",
  {
    id: text("id").primaryKey(),
    question: text("question").notNull(),
    description: text("description").notNull().default(""),
    selectionA: text("selection_a").notNull(),
    selectionB: text("selection_b").notNull(),
    closesAt: text("closes_at").notNull(),
    status: text("status").notNull().default("open"),
    winningSelection: text("winning_selection"),
    creatorUserId: text("creator_user_id")
      .notNull()
      .references(() => users.id),
    createdAt: text("created_at").notNull().default(now),
    resolvedAt: text("resolved_at"),
  },
  (table) => [
    index("markets_status_closes_idx").on(table.status, table.closesAt),
    index("markets_creator_idx").on(table.creatorUserId),
    check(
      "markets_status_check",
      sql`${table.status} IN ('open', 'resolved', 'void')`,
    ),
    check(
      "markets_winning_selection_check",
      sql`${table.winningSelection} IS NULL OR ${table.winningSelection} IN ('a', 'b')`,
    ),
  ],
);

export const offers = sqliteTable(
  "offers",
  {
    id: text("id").primaryKey(),
    makerUserId: text("maker_user_id")
      .notNull()
      .references(() => users.id),
    makerRiskCents: integer("maker_risk_cents").notNull(),
    takerRiskCents: integer("taker_risk_cents").notNull(),
    status: text("status").notNull().default("open"),
    acceptedByUserId: text("accepted_by_user_id").references(() => users.id),
    acceptedCounterId: text("accepted_counter_id"),
    createdAt: text("created_at").notNull().default(now),
    expiresAt: text("expires_at"),
    acceptedAt: text("accepted_at"),
  },
  (table) => [
    index("offers_status_created_idx").on(table.status, table.createdAt),
    index("offers_maker_idx").on(table.makerUserId),
    check(
      "offers_status_check",
      sql`${table.status} IN ('open', 'accepted', 'cancelled', 'expired')`,
    ),
    check("offers_maker_risk_check", sql`${table.makerRiskCents} > 0`),
    check("offers_taker_risk_check", sql`${table.takerRiskCents} > 0`),
  ],
);

export const offerLegs = sqliteTable(
  "offer_legs",
  {
    id: text("id").primaryKey(),
    offerId: text("offer_id")
      .notNull()
      .references(() => offers.id),
    marketId: text("market_id")
      .notNull()
      .references(() => markets.id),
    makerSelection: text("maker_selection").notNull(),
  },
  (table) => [
    uniqueIndex("offer_legs_offer_market_unique").on(
      table.offerId,
      table.marketId,
    ),
    index("offer_legs_market_idx").on(table.marketId),
    check(
      "offer_legs_selection_check",
      sql`${table.makerSelection} IN ('a', 'b')`,
    ),
  ],
);

export const counteroffers = sqliteTable(
  "counteroffers",
  {
    id: text("id").primaryKey(),
    rootOfferId: text("root_offer_id")
      .notNull()
      .references(() => offers.id),
    parentCounterId: text("parent_counter_id"),
    challengerUserId: text("challenger_user_id")
      .notNull()
      .references(() => users.id),
    proposerUserId: text("proposer_user_id")
      .notNull()
      .references(() => users.id),
    recipientUserId: text("recipient_user_id")
      .notNull()
      .references(() => users.id),
    makerRiskCents: integer("maker_risk_cents").notNull(),
    takerRiskCents: integer("taker_risk_cents").notNull(),
    status: text("status").notNull().default("pending"),
    createdAt: text("created_at").notNull().default(now),
  },
  (table) => [
    index("counteroffers_root_created_idx").on(
      table.rootOfferId,
      table.createdAt,
    ),
    index("counteroffers_recipient_idx").on(
      table.recipientUserId,
      table.status,
    ),
    check(
      "counteroffers_status_check",
      sql`${table.status} IN ('pending', 'accepted', 'superseded')`,
    ),
    check(
      "counteroffers_participants_check",
      sql`${table.proposerUserId} <> ${table.recipientUserId}`,
    ),
    check(
      "counteroffers_maker_risk_check",
      sql`${table.makerRiskCents} > 0`,
    ),
    check(
      "counteroffers_taker_risk_check",
      sql`${table.takerRiskCents} > 0`,
    ),
  ],
);

export const bets = sqliteTable(
  "bets",
  {
    id: text("id").primaryKey(),
    offerId: text("offer_id")
      .notNull()
      .references(() => offers.id),
    makerUserId: text("maker_user_id")
      .notNull()
      .references(() => users.id),
    takerUserId: text("taker_user_id")
      .notNull()
      .references(() => users.id),
    makerRiskCents: integer("maker_risk_cents").notNull(),
    takerRiskCents: integer("taker_risk_cents").notNull(),
    acceptedCounterId: text("accepted_counter_id"),
    status: text("status").notNull().default("pending"),
    acceptedAt: text("accepted_at").notNull().default(now),
    settledAt: text("settled_at"),
  },
  (table) => [
    uniqueIndex("bets_offer_unique").on(table.offerId),
    index("bets_maker_idx").on(table.makerUserId, table.acceptedAt),
    index("bets_taker_idx").on(table.takerUserId, table.acceptedAt),
    index("bets_status_idx").on(table.status),
    check(
      "bets_status_check",
      sql`${table.status} IN ('pending', 'maker_won', 'taker_won', 'void')`,
    ),
    check(
      "bets_participants_check",
      sql`${table.makerUserId} <> ${table.takerUserId}`,
    ),
  ],
);

export const debts = sqliteTable(
  "debts",
  {
    id: text("id").primaryKey(),
    betId: text("bet_id")
      .notNull()
      .references(() => bets.id),
    debtorUserId: text("debtor_user_id")
      .notNull()
      .references(() => users.id),
    creditorUserId: text("creditor_user_id")
      .notNull()
      .references(() => users.id),
    amountCents: integer("amount_cents").notNull(),
    createdAt: text("created_at").notNull().default(now),
  },
  (table) => [
    uniqueIndex("debts_bet_unique").on(table.betId),
    index("debts_debtor_creditor_idx").on(
      table.debtorUserId,
      table.creditorUserId,
    ),
    check("debts_amount_check", sql`${table.amountCents} > 0`),
    check(
      "debts_participants_check",
      sql`${table.debtorUserId} <> ${table.creditorUserId}`,
    ),
  ],
);

export const offlineSettlements = sqliteTable(
  "offline_settlements",
  {
    id: text("id").primaryKey(),
    debtorUserId: text("debtor_user_id")
      .notNull()
      .references(() => users.id),
    creditorUserId: text("creditor_user_id")
      .notNull()
      .references(() => users.id),
    amountCents: integer("amount_cents").notNull(),
    status: text("status").notNull().default("pending"),
    proposedAt: text("proposed_at").notNull().default(now),
    respondedAt: text("responded_at"),
  },
  (table) => [
    index("settlements_pair_status_idx").on(
      table.debtorUserId,
      table.creditorUserId,
      table.status,
    ),
    check(
      "settlements_status_check",
      sql`${table.status} IN ('pending', 'confirmed', 'rejected', 'cancelled')`,
    ),
    check("settlements_amount_check", sql`${table.amountCents} > 0`),
    check(
      "settlements_participants_check",
      sql`${table.debtorUserId} <> ${table.creditorUserId}`,
    ),
  ],
);

export const auditEvents = sqliteTable(
  "audit_events",
  {
    id: text("id").primaryKey(),
    actorUserId: text("actor_user_id")
      .notNull()
      .references(() => users.id),
    action: text("action").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id").notNull(),
    metadataJson: text("metadata_json").notNull().default("{}"),
    createdAt: text("created_at").notNull().default(now),
  },
  (table) => [
    index("audit_entity_idx").on(table.entityType, table.entityId),
    index("audit_created_idx").on(table.createdAt),
  ],
);
