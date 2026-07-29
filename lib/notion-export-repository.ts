import { ensureSchema, getD1 } from "@/db";
import type {
  BetRevisionStatus,
  BetStatus,
  MarketStatus,
  ParlayPosition,
  Selection,
} from "@/lib/contracts";
import type {
  ExportLegResult,
  MatchedBetExport,
  MatchedBetExportLeg,
  NotionExportState,
} from "@/lib/notion-export";
import {
  ExportAlreadyRunningError,
  type ExportRepository,
  type ExportRunSummary,
} from "@/lib/notion-export-run";

type ExportBetRow = {
  bet_id: string;
  maker_name: string;
  taker_name: string;
  maker_position: ParlayPosition;
  maker_risk_cents: number;
  taker_risk_cents: number;
  status: BetStatus;
  accepted_at: string;
  settled_at: string | null;
  current_revision_id: string;
  active_revision_number: number;
};

type ExportRevisionRow = {
  id: string;
  bet_id: string;
  revision_number: number;
  maker_risk_cents: number;
  taker_risk_cents: number;
  maker_position: ParlayPosition;
  proposer_name: string;
  recipient_name: string;
  status: BetRevisionStatus;
  change_note: string;
  created_at: string;
  responded_at: string | null;
};

type ExportLegRow = {
  bet_revision_id: string;
  market_revision_id: string;
  market_revision_number: number;
  question: string;
  selection_a: string;
  selection_b: string;
  closes_at: string;
  market_status: MarketStatus;
  winning_selection: Selection | null;
  maker_selection: Selection;
};

type ExportStateRow = {
  notion_page_id: string | null;
  payload_hash: string | null;
};

const LEASE_DURATION_MS = 30 * 60 * 1_000;

export class D1ExportRepository implements ExportRepository {
  async beginRun(startedAt: string): Promise<string> {
    await ensureSchema();
    const db = getD1();
    await db
      .prepare(
        `UPDATE notion_export_runs
         SET status = 'failed',
             finished_at = ?,
             error = 'Export lease expired.'
         WHERE status = 'running'
           AND datetime(lease_expires_at) <= datetime(?)`,
      )
      .bind(startedAt, startedAt)
      .run();

    const runId = crypto.randomUUID();
    const leaseExpiresAt = new Date(
      Date.parse(startedAt) + LEASE_DURATION_MS,
    ).toISOString();
    try {
      await db
        .prepare(
          `INSERT INTO notion_export_runs (
             id, status, started_at, lease_expires_at
           ) VALUES (?, 'running', ?, ?)`,
        )
        .bind(runId, startedAt, leaseExpiresAt)
        .run();
      return runId;
    } catch (error) {
      const running = await db
        .prepare(
          `SELECT id FROM notion_export_runs
           WHERE status = 'running'
           LIMIT 1`,
        )
        .first<{ id: string }>();
      if (running) {
        throw new ExportAlreadyRunningError();
      }
      throw error;
    }
  }

  async listMatchedBets(): Promise<MatchedBetExport[]> {
    await ensureSchema();
    const db = getD1();
    const [betsResult, revisionsResult, legsResult] = await db.batch([
      db.prepare(
        `SELECT
           b.id AS bet_id,
           maker.display_name AS maker_name,
           taker.display_name AS taker_name,
           active.maker_risk_cents,
           active.taker_risk_cents,
           active.maker_position,
           b.status,
           b.accepted_at,
           b.settled_at,
           b.current_revision_id,
           active.revision_number AS active_revision_number
         FROM bets b
         JOIN bet_revisions active ON active.id = b.current_revision_id
         JOIN users maker ON maker.id = b.maker_user_id
         JOIN users taker ON taker.id = b.taker_user_id
         ORDER BY datetime(b.accepted_at), b.id`,
      ),
      db.prepare(
        `SELECT
           br.id,
           br.bet_id,
           br.revision_number,
           br.maker_risk_cents,
           br.taker_risk_cents,
           br.maker_position,
           proposer.display_name AS proposer_name,
           recipient.display_name AS recipient_name,
           br.status,
           br.change_note,
           br.created_at,
           br.responded_at
         FROM bet_revisions br
         JOIN users proposer ON proposer.id = br.proposer_user_id
         JOIN users recipient ON recipient.id = br.recipient_user_id
         ORDER BY br.bet_id, br.revision_number`,
      ),
      db.prepare(
        `SELECT
           brl.bet_revision_id,
           brl.market_revision_id,
           mr.revision_number AS market_revision_number,
           mr.question,
           mr.selection_a,
           mr.selection_b,
           mr.closes_at,
           mr.status AS market_status,
           mr.winning_selection,
           brl.maker_selection
         FROM bet_revision_legs brl
         JOIN market_revisions mr ON mr.id = brl.market_revision_id
         ORDER BY brl.bet_revision_id, datetime(mr.closes_at),
                  brl.market_revision_id`,
      ),
    ]);

    const bets = resultRows<ExportBetRow>(betsResult);
    const revisions = resultRows<ExportRevisionRow>(revisionsResult);
    const legs = resultRows<ExportLegRow>(legsResult);
    const revisionsByBet = groupBy(revisions, (row) => row.bet_id);
    const legsByRevision = groupBy(
      legs,
      (row) => row.bet_revision_id,
    );

    return bets.map((bet) => {
      const revisionRows = revisionsByBet.get(bet.bet_id) ?? [];
      const activeLegRows =
        legsByRevision.get(bet.current_revision_id) ?? [];
      return {
        betId: bet.bet_id,
        makerName: bet.maker_name,
        takerName: bet.taker_name,
        makerPosition: bet.maker_position,
        makerRiskCents: bet.maker_risk_cents,
        takerRiskCents: bet.taker_risk_cents,
        status: bet.status,
        acceptedAt: bet.accepted_at,
        settledAt: bet.settled_at,
        activeRevisionNumber: bet.active_revision_number,
        legs: activeLegRows.map(toExportLeg),
        revisions: revisionRows.map((revision) => ({
          revisionNumber: revision.revision_number,
          makerPosition: revision.maker_position,
          makerRiskCents: revision.maker_risk_cents,
          takerRiskCents: revision.taker_risk_cents,
          proposerName: revision.proposer_name,
          recipientName: revision.recipient_name,
          status: revision.status,
          changeNote: revision.change_note,
          createdAt: revision.created_at,
          respondedAt: revision.responded_at,
          legs: (legsByRevision.get(revision.id) ?? []).map(toExportLeg),
        })),
      };
    });
  }

  async getExportState(
    betId: string,
  ): Promise<NotionExportState | null> {
    await ensureSchema();
    const row = await getD1()
      .prepare(
        `SELECT notion_page_id, payload_hash
         FROM notion_bet_exports
         WHERE bet_id = ?`,
      )
      .bind(betId)
      .first<ExportStateRow>();
    return row
      ? {
          notionPageId: row.notion_page_id,
          payloadHash: row.payload_hash,
        }
      : null;
  }

  async recordSuccess({
    betId,
    notionPageId,
    payloadHash,
    exportedAt,
  }: Parameters<ExportRepository["recordSuccess"]>[0]): Promise<void> {
    await getD1()
      .prepare(
        `INSERT INTO notion_bet_exports (
           bet_id, notion_page_id, payload_hash, last_exported_at,
           last_error, updated_at
         ) VALUES (?, ?, ?, ?, NULL, ?)
         ON CONFLICT(bet_id) DO UPDATE SET
           notion_page_id = excluded.notion_page_id,
           payload_hash = excluded.payload_hash,
           last_exported_at = excluded.last_exported_at,
           last_error = NULL,
           updated_at = excluded.updated_at`,
      )
      .bind(
        betId,
        notionPageId,
        payloadHash,
        exportedAt,
        exportedAt,
      )
      .run();
  }

  async recordFailure({
    betId,
    error,
    failedAt,
  }: Parameters<ExportRepository["recordFailure"]>[0]): Promise<void> {
    await getD1()
      .prepare(
        `INSERT INTO notion_bet_exports (
           bet_id, last_error, updated_at
         ) VALUES (?, ?, ?)
         ON CONFLICT(bet_id) DO UPDATE SET
           last_error = excluded.last_error,
           updated_at = excluded.updated_at`,
      )
      .bind(betId, error.slice(0, 300), failedAt)
      .run();
  }

  async finishRun({
    runId,
    status,
    scanned,
    created,
    updated,
    unchanged,
    failed,
    finishedAt,
  }: ExportRunSummary & { finishedAt: string }): Promise<void> {
    await getD1()
      .prepare(
        `UPDATE notion_export_runs
         SET status = ?,
             finished_at = ?,
             scanned_count = ?,
             created_count = ?,
             updated_count = ?,
             unchanged_count = ?,
             failed_count = ?,
             error = CASE
               WHEN ? = 'failed' THEN 'Matched-bet export failed.'
               ELSE NULL
             END
         WHERE id = ? AND status = 'running'`,
      )
      .bind(
        status,
        finishedAt,
        scanned,
        created,
        updated,
        unchanged,
        failed,
        status,
        runId,
      )
      .run();
  }
}

function toExportLeg(row: ExportLegRow): MatchedBetExportLeg {
  return {
    marketRevisionId: row.market_revision_id,
    marketRevisionNumber: row.market_revision_number,
    question: row.question,
    makerSelection: row.maker_selection,
    makerSelectionLabel:
      row.maker_selection === "a" ? row.selection_a : row.selection_b,
    closesAt: row.closes_at,
    result: toLegResult(row),
  };
}

function toLegResult(row: ExportLegRow): ExportLegResult {
  if (row.market_status === "void") {
    return "void";
  }
  if (row.market_status !== "resolved" || !row.winning_selection) {
    return "pending";
  }
  return row.winning_selection === row.maker_selection ? "won" : "lost";
}

function resultRows<T>(result: D1Result<unknown>): T[] {
  return (result.results ?? []) as T[];
}

function groupBy<T>(
  values: T[],
  key: (value: T) => string,
): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const value of values) {
    const itemKey = key(value);
    const current = groups.get(itemKey);
    if (current) {
      current.push(value);
    } else {
      groups.set(itemKey, [value]);
    }
  }
  return groups;
}
