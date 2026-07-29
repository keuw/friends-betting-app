import { env } from "cloudflare:workers";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "./schema";

let schemaReady: Promise<void> | null = null;

export function getD1(): D1Database {
  if (!env.DB) {
    throw new Error(
      "Cloudflare D1 binding `DB` is unavailable. Set `d1` to `DB` in .openai/hosting.json.",
    );
  }
  return env.DB;
}

export function getDb() {
  return drizzle(getD1(), { schema });
}

export function ensureSchema(): Promise<void> {
  schemaReady ??= initializeSchema();
  return schemaReady;
}

async function initializeSchema(): Promise<void> {
  const db = getD1();
  await db.batch(
    SCHEMA_STATEMENTS.map((statement) => db.prepare(statement)),
  );
  await ensureColumn(
    db,
    "markets",
    "current_revision_id",
    "ALTER TABLE markets ADD COLUMN current_revision_id TEXT",
  );
  await ensureColumn(
    db,
    "offer_legs",
    "market_revision_id",
    "ALTER TABLE offer_legs ADD COLUMN market_revision_id TEXT REFERENCES market_revisions(id)",
  );
  await ensureColumn(
    db,
    "bets",
    "current_revision_id",
    "ALTER TABLE bets ADD COLUMN current_revision_id TEXT",
  );
  await ensureColumn(
    db,
    "offers",
    "maker_position",
    "ALTER TABLE offers ADD COLUMN maker_position TEXT NOT NULL DEFAULT 'back' CHECK (maker_position IN ('back', 'fade'))",
  );
  await ensureColumn(
    db,
    "bet_revisions",
    "maker_position",
    "ALTER TABLE bet_revisions ADD COLUMN maker_position TEXT NOT NULL DEFAULT 'back' CHECK (maker_position IN ('back', 'fade'))",
  );
  await db.batch(
    REVISION_BACKFILL_STATEMENTS.map((statement) => db.prepare(statement)),
  );
}

async function ensureColumn(
  db: D1Database,
  table: "markets" | "offer_legs" | "bets" | "offers" | "bet_revisions",
  column: string,
  alterStatement: string,
): Promise<void> {
  const result = await db.prepare(`PRAGMA table_info(${table})`).all<{
    name: string;
  }>();
  if (!result.results.some((item) => item.name === column)) {
    await db.prepare(alterStatement).run();
  }
}

const SCHEMA_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY NOT NULL,
    email TEXT NOT NULL UNIQUE,
    display_name TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE TABLE IF NOT EXISTS markets (
    id TEXT PRIMARY KEY NOT NULL,
    question TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    selection_a TEXT NOT NULL,
    selection_b TEXT NOT NULL,
    closes_at TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved', 'void')),
    winning_selection TEXT CHECK (winning_selection IS NULL OR winning_selection IN ('a', 'b')),
    creator_user_id TEXT NOT NULL REFERENCES users(id),
    current_revision_id TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    resolved_at TEXT
  )`,
  `CREATE INDEX IF NOT EXISTS markets_status_closes_idx ON markets(status, closes_at)`,
  `CREATE INDEX IF NOT EXISTS markets_creator_idx ON markets(creator_user_id)`,
  `CREATE TABLE IF NOT EXISTS market_revisions (
    id TEXT PRIMARY KEY NOT NULL,
    market_id TEXT NOT NULL REFERENCES markets(id),
    revision_number INTEGER NOT NULL CHECK (revision_number > 0),
    question TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    selection_a TEXT NOT NULL,
    selection_b TEXT NOT NULL,
    closes_at TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved', 'void')),
    winning_selection TEXT CHECK (winning_selection IS NULL OR winning_selection IN ('a', 'b')),
    editor_user_id TEXT NOT NULL REFERENCES users(id),
    change_note TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    resolved_at TEXT,
    UNIQUE(market_id, revision_number)
  )`,
  `CREATE INDEX IF NOT EXISTS market_revisions_market_created_idx ON market_revisions(market_id, created_at)`,
  `CREATE INDEX IF NOT EXISTS market_revisions_status_closes_idx ON market_revisions(status, closes_at)`,
  `CREATE TABLE IF NOT EXISTS offers (
    id TEXT PRIMARY KEY NOT NULL,
    maker_user_id TEXT NOT NULL REFERENCES users(id),
    maker_risk_cents INTEGER NOT NULL CHECK (maker_risk_cents > 0),
    taker_risk_cents INTEGER NOT NULL CHECK (taker_risk_cents > 0),
    maker_position TEXT NOT NULL DEFAULT 'back' CHECK (maker_position IN ('back', 'fade')),
    status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'accepted', 'cancelled', 'expired')),
    accepted_by_user_id TEXT REFERENCES users(id),
    accepted_counter_id TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    expires_at TEXT,
    accepted_at TEXT
  )`,
  `CREATE INDEX IF NOT EXISTS offers_status_created_idx ON offers(status, created_at)`,
  `CREATE INDEX IF NOT EXISTS offers_maker_idx ON offers(maker_user_id)`,
  `CREATE TABLE IF NOT EXISTS offer_legs (
    id TEXT PRIMARY KEY NOT NULL,
    offer_id TEXT NOT NULL REFERENCES offers(id),
    market_id TEXT NOT NULL REFERENCES markets(id),
    market_revision_id TEXT REFERENCES market_revisions(id),
    maker_selection TEXT NOT NULL CHECK (maker_selection IN ('a', 'b')),
    UNIQUE(offer_id, market_id)
  )`,
  `CREATE INDEX IF NOT EXISTS offer_legs_market_idx ON offer_legs(market_id)`,
  `CREATE TABLE IF NOT EXISTS counteroffers (
    id TEXT PRIMARY KEY NOT NULL,
    root_offer_id TEXT NOT NULL REFERENCES offers(id),
    parent_counter_id TEXT,
    challenger_user_id TEXT NOT NULL REFERENCES users(id),
    proposer_user_id TEXT NOT NULL REFERENCES users(id),
    recipient_user_id TEXT NOT NULL REFERENCES users(id),
    maker_risk_cents INTEGER NOT NULL CHECK (maker_risk_cents > 0),
    taker_risk_cents INTEGER NOT NULL CHECK (taker_risk_cents > 0),
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'superseded')),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CHECK (proposer_user_id <> recipient_user_id)
  )`,
  `CREATE INDEX IF NOT EXISTS counteroffers_root_created_idx ON counteroffers(root_offer_id, created_at)`,
  `CREATE INDEX IF NOT EXISTS counteroffers_recipient_idx ON counteroffers(recipient_user_id, status)`,
  `CREATE TABLE IF NOT EXISTS bets (
    id TEXT PRIMARY KEY NOT NULL,
    offer_id TEXT NOT NULL UNIQUE REFERENCES offers(id),
    maker_user_id TEXT NOT NULL REFERENCES users(id),
    taker_user_id TEXT NOT NULL REFERENCES users(id),
    maker_risk_cents INTEGER NOT NULL,
    taker_risk_cents INTEGER NOT NULL,
    accepted_counter_id TEXT,
    current_revision_id TEXT,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'maker_won', 'taker_won', 'void')),
    accepted_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    settled_at TEXT,
    CHECK (maker_user_id <> taker_user_id)
  )`,
  `CREATE INDEX IF NOT EXISTS bets_maker_idx ON bets(maker_user_id, accepted_at)`,
  `CREATE INDEX IF NOT EXISTS bets_taker_idx ON bets(taker_user_id, accepted_at)`,
  `CREATE INDEX IF NOT EXISTS bets_status_idx ON bets(status)`,
  `CREATE TABLE IF NOT EXISTS bet_revisions (
    id TEXT PRIMARY KEY NOT NULL,
    bet_id TEXT NOT NULL REFERENCES bets(id),
    revision_number INTEGER NOT NULL CHECK (revision_number > 0),
    maker_risk_cents INTEGER NOT NULL CHECK (maker_risk_cents > 0),
    taker_risk_cents INTEGER NOT NULL CHECK (taker_risk_cents > 0),
    maker_position TEXT NOT NULL DEFAULT 'back' CHECK (maker_position IN ('back', 'fade')),
    proposer_user_id TEXT NOT NULL REFERENCES users(id),
    recipient_user_id TEXT NOT NULL REFERENCES users(id),
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('active', 'pending', 'rejected', 'cancelled', 'superseded')),
    change_note TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    responded_at TEXT,
    CHECK (proposer_user_id <> recipient_user_id),
    UNIQUE(bet_id, revision_number)
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS bet_revisions_one_pending ON bet_revisions(bet_id) WHERE status = 'pending'`,
  `CREATE UNIQUE INDEX IF NOT EXISTS bet_revisions_one_active ON bet_revisions(bet_id) WHERE status = 'active'`,
  `CREATE INDEX IF NOT EXISTS bet_revisions_bet_created_idx ON bet_revisions(bet_id, created_at)`,
  `CREATE TABLE IF NOT EXISTS bet_revision_legs (
    id TEXT PRIMARY KEY NOT NULL,
    bet_revision_id TEXT NOT NULL REFERENCES bet_revisions(id),
    market_id TEXT NOT NULL REFERENCES markets(id),
    market_revision_id TEXT NOT NULL REFERENCES market_revisions(id),
    maker_selection TEXT NOT NULL CHECK (maker_selection IN ('a', 'b')),
    UNIQUE(bet_revision_id, market_id)
  )`,
  `CREATE INDEX IF NOT EXISTS bet_revision_legs_market_revision_idx ON bet_revision_legs(market_revision_id)`,
  `CREATE TABLE IF NOT EXISTS debts (
    id TEXT PRIMARY KEY NOT NULL,
    bet_id TEXT NOT NULL UNIQUE REFERENCES bets(id),
    debtor_user_id TEXT NOT NULL REFERENCES users(id),
    creditor_user_id TEXT NOT NULL REFERENCES users(id),
    amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CHECK (debtor_user_id <> creditor_user_id)
  )`,
  `CREATE INDEX IF NOT EXISTS debts_debtor_creditor_idx ON debts(debtor_user_id, creditor_user_id)`,
  `CREATE TABLE IF NOT EXISTS offline_settlements (
    id TEXT PRIMARY KEY NOT NULL,
    debtor_user_id TEXT NOT NULL REFERENCES users(id),
    creditor_user_id TEXT NOT NULL REFERENCES users(id),
    amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'confirmed', 'rejected', 'cancelled')),
    proposed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    responded_at TEXT,
    CHECK (debtor_user_id <> creditor_user_id)
  )`,
  `CREATE INDEX IF NOT EXISTS settlements_pair_status_idx ON offline_settlements(debtor_user_id, creditor_user_id, status)`,
  `CREATE TABLE IF NOT EXISTS audit_events (
    id TEXT PRIMARY KEY NOT NULL,
    actor_user_id TEXT NOT NULL REFERENCES users(id),
    action TEXT NOT NULL,
    entity_type TEXT NOT NULL,
    entity_id TEXT NOT NULL,
    metadata_json TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE INDEX IF NOT EXISTS audit_entity_idx ON audit_events(entity_type, entity_id)`,
  `CREATE INDEX IF NOT EXISTS audit_created_idx ON audit_events(created_at)`,
  `CREATE TABLE IF NOT EXISTS notion_bet_exports (
    bet_id TEXT PRIMARY KEY NOT NULL REFERENCES bets(id),
    notion_page_id TEXT,
    payload_hash TEXT,
    last_exported_at TEXT,
    last_error TEXT,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS notion_bet_exports_page_unique ON notion_bet_exports(notion_page_id) WHERE notion_page_id IS NOT NULL`,
  `CREATE TABLE IF NOT EXISTS notion_export_runs (
    id TEXT PRIMARY KEY NOT NULL,
    status TEXT NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'succeeded', 'partial', 'failed')),
    started_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    finished_at TEXT,
    lease_expires_at TEXT NOT NULL,
    scanned_count INTEGER NOT NULL DEFAULT 0,
    created_count INTEGER NOT NULL DEFAULT 0,
    updated_count INTEGER NOT NULL DEFAULT 0,
    unchanged_count INTEGER NOT NULL DEFAULT 0,
    failed_count INTEGER NOT NULL DEFAULT 0,
    error TEXT
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS notion_export_runs_one_running ON notion_export_runs(status) WHERE status = 'running'`,
  `CREATE INDEX IF NOT EXISTS notion_export_runs_started_idx ON notion_export_runs(started_at)`,
] as const;

const REVISION_BACKFILL_STATEMENTS = [
  `INSERT OR IGNORE INTO market_revisions (
     id, market_id, revision_number, question, description, selection_a,
     selection_b, closes_at, status, winning_selection, editor_user_id,
     change_note, created_at, resolved_at
   )
   SELECT
     'market-revision:' || id, id, 1, question, description, selection_a,
     selection_b, closes_at, status, winning_selection, creator_user_id,
     'Original market terms', created_at, resolved_at
   FROM markets`,
  `UPDATE markets
   SET current_revision_id = 'market-revision:' || id
   WHERE current_revision_id IS NULL`,
  `UPDATE offer_legs
   SET market_revision_id = (
     SELECT current_revision_id FROM markets
     WHERE markets.id = offer_legs.market_id
   )
   WHERE market_revision_id IS NULL`,
  `INSERT OR IGNORE INTO bet_revisions (
     id, bet_id, revision_number, maker_risk_cents, taker_risk_cents,
     maker_position, proposer_user_id, recipient_user_id, status, change_note,
     created_at, responded_at
   )
   SELECT
     'bet-revision:' || id, id, 1, maker_risk_cents, taker_risk_cents,
     'back', maker_user_id, taker_user_id, 'active',
     'Original matched terms', accepted_at, accepted_at
   FROM bets`,
  `UPDATE bets
   SET current_revision_id = 'bet-revision:' || id
   WHERE current_revision_id IS NULL`,
  `INSERT OR IGNORE INTO bet_revision_legs (
     id, bet_revision_id, market_id, market_revision_id, maker_selection
   )
   SELECT
     'bet-revision-leg:' || bets.id || ':' || offer_legs.market_id,
     'bet-revision:' || bets.id,
     offer_legs.market_id,
     offer_legs.market_revision_id,
     offer_legs.maker_selection
   FROM bets
   JOIN offer_legs ON offer_legs.offer_id = bets.offer_id`,
] as const;
