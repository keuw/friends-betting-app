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
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    resolved_at TEXT
  )`,
  `CREATE INDEX IF NOT EXISTS markets_status_closes_idx ON markets(status, closes_at)`,
  `CREATE INDEX IF NOT EXISTS markets_creator_idx ON markets(creator_user_id)`,
  `CREATE TABLE IF NOT EXISTS offers (
    id TEXT PRIMARY KEY NOT NULL,
    maker_user_id TEXT NOT NULL REFERENCES users(id),
    maker_risk_cents INTEGER NOT NULL CHECK (maker_risk_cents > 0),
    taker_risk_cents INTEGER NOT NULL CHECK (taker_risk_cents > 0),
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
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'maker_won', 'taker_won', 'void')),
    accepted_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    settled_at TEXT,
    CHECK (maker_user_id <> taker_user_id)
  )`,
  `CREATE INDEX IF NOT EXISTS bets_maker_idx ON bets(maker_user_id, accepted_at)`,
  `CREATE INDEX IF NOT EXISTS bets_taker_idx ON bets(taker_user_id, accepted_at)`,
  `CREATE INDEX IF NOT EXISTS bets_status_idx ON bets(status)`,
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
] as const;
