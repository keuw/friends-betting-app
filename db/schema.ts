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
    currentRevisionId: text("current_revision_id"),
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

export const marketRevisions = sqliteTable(
  "market_revisions",
  {
    id: text("id").primaryKey(),
    marketId: text("market_id")
      .notNull()
      .references(() => markets.id),
    revisionNumber: integer("revision_number").notNull(),
    question: text("question").notNull(),
    description: text("description").notNull().default(""),
    selectionA: text("selection_a").notNull(),
    selectionB: text("selection_b").notNull(),
    closesAt: text("closes_at").notNull(),
    status: text("status").notNull().default("open"),
    winningSelection: text("winning_selection"),
    editorUserId: text("editor_user_id")
      .notNull()
      .references(() => users.id),
    changeNote: text("change_note").notNull(),
    createdAt: text("created_at").notNull().default(now),
    resolvedAt: text("resolved_at"),
  },
  (table) => [
    uniqueIndex("market_revisions_market_number_unique").on(
      table.marketId,
      table.revisionNumber,
    ),
    index("market_revisions_market_created_idx").on(
      table.marketId,
      table.createdAt,
    ),
    index("market_revisions_status_closes_idx").on(
      table.status,
      table.closesAt,
    ),
    check(
      "market_revisions_status_check",
      sql`${table.status} IN ('open', 'resolved', 'void')`,
    ),
    check(
      "market_revisions_winning_selection_check",
      sql`${table.winningSelection} IS NULL OR ${table.winningSelection} IN ('a', 'b')`,
    ),
    check(
      "market_revisions_number_check",
      sql`${table.revisionNumber} > 0`,
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
    makerPosition: text("maker_position").notNull().default("back"),
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
    check(
      "offers_maker_position_check",
      sql`${table.makerPosition} IN ('back', 'fade')`,
    ),
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
    marketRevisionId: text("market_revision_id").references(
      () => marketRevisions.id,
    ),
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
    currentRevisionId: text("current_revision_id"),
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

export const betRevisions = sqliteTable(
  "bet_revisions",
  {
    id: text("id").primaryKey(),
    betId: text("bet_id")
      .notNull()
      .references(() => bets.id),
    revisionNumber: integer("revision_number").notNull(),
    makerRiskCents: integer("maker_risk_cents").notNull(),
    takerRiskCents: integer("taker_risk_cents").notNull(),
    makerPosition: text("maker_position").notNull().default("back"),
    proposerUserId: text("proposer_user_id")
      .notNull()
      .references(() => users.id),
    recipientUserId: text("recipient_user_id")
      .notNull()
      .references(() => users.id),
    status: text("status").notNull().default("pending"),
    changeNote: text("change_note").notNull(),
    createdAt: text("created_at").notNull().default(now),
    respondedAt: text("responded_at"),
  },
  (table) => [
    uniqueIndex("bet_revisions_bet_number_unique").on(
      table.betId,
      table.revisionNumber,
    ),
    uniqueIndex("bet_revisions_one_pending")
      .on(table.betId)
      .where(sql`${table.status} = 'pending'`),
    uniqueIndex("bet_revisions_one_active")
      .on(table.betId)
      .where(sql`${table.status} = 'active'`),
    index("bet_revisions_bet_created_idx").on(table.betId, table.createdAt),
    check(
      "bet_revisions_status_check",
      sql`${table.status} IN ('active', 'pending', 'rejected', 'cancelled', 'superseded')`,
    ),
    check(
      "bet_revisions_participants_check",
      sql`${table.proposerUserId} <> ${table.recipientUserId}`,
    ),
    check(
      "bet_revisions_maker_risk_check",
      sql`${table.makerRiskCents} > 0`,
    ),
    check(
      "bet_revisions_taker_risk_check",
      sql`${table.takerRiskCents} > 0`,
    ),
    check(
      "bet_revisions_maker_position_check",
      sql`${table.makerPosition} IN ('back', 'fade')`,
    ),
    check(
      "bet_revisions_number_check",
      sql`${table.revisionNumber} > 0`,
    ),
  ],
);

export const betRevisionLegs = sqliteTable(
  "bet_revision_legs",
  {
    id: text("id").primaryKey(),
    betRevisionId: text("bet_revision_id")
      .notNull()
      .references(() => betRevisions.id),
    marketId: text("market_id")
      .notNull()
      .references(() => markets.id),
    marketRevisionId: text("market_revision_id")
      .notNull()
      .references(() => marketRevisions.id),
    makerSelection: text("maker_selection").notNull(),
  },
  (table) => [
    uniqueIndex("bet_revision_legs_revision_market_unique").on(
      table.betRevisionId,
      table.marketId,
    ),
    index("bet_revision_legs_market_revision_idx").on(table.marketRevisionId),
    check(
      "bet_revision_legs_selection_check",
      sql`${table.makerSelection} IN ('a', 'b')`,
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

export const notionBetExports = sqliteTable(
  "notion_bet_exports",
  {
    betId: text("bet_id")
      .primaryKey()
      .references(() => bets.id),
    notionPageId: text("notion_page_id"),
    payloadHash: text("payload_hash"),
    lastExportedAt: text("last_exported_at"),
    lastError: text("last_error"),
    updatedAt: text("updated_at").notNull().default(now),
  },
  (table) => [
    uniqueIndex("notion_bet_exports_page_unique")
      .on(table.notionPageId)
      .where(sql`${table.notionPageId} IS NOT NULL`),
  ],
);

export const notionExportRuns = sqliteTable(
  "notion_export_runs",
  {
    id: text("id").primaryKey(),
    status: text("status").notNull().default("running"),
    startedAt: text("started_at").notNull().default(now),
    finishedAt: text("finished_at"),
    leaseExpiresAt: text("lease_expires_at").notNull(),
    scannedCount: integer("scanned_count").notNull().default(0),
    createdCount: integer("created_count").notNull().default(0),
    updatedCount: integer("updated_count").notNull().default(0),
    unchangedCount: integer("unchanged_count").notNull().default(0),
    failedCount: integer("failed_count").notNull().default(0),
    error: text("error"),
  },
  (table) => [
    uniqueIndex("notion_export_runs_one_running")
      .on(table.status)
      .where(sql`${table.status} = 'running'`),
    index("notion_export_runs_started_idx").on(table.startedAt),
    check(
      "notion_export_runs_status_check",
      sql`${table.status} IN ('running', 'succeeded', 'partial', 'failed')`,
    ),
  ],
);
