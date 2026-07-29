import { getChatGPTUser } from "@/app/chatgpt-auth";
import { ensureSchema, getD1 } from "@/db";
import { AppError } from "@/lib/action-parser";
import {
  canAmendBet,
  derivePairBalances,
  gradeParlay,
  type DebtEntry,
  type LegResult,
  type OfflineSettlementEntry,
} from "@/lib/domain";
import type {
  AppAction,
  AppState,
  BetRevisionStatus,
  BetStatus,
  MarketStatus,
  OfferStatus,
  ParlayPosition,
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
  current_revision_id: string;
  revision_number: number;
  offer_reference_count: number;
  active_offer_reference_count: number;
  removable_offer_reference_count: number;
  bet_reference_count: number;
  created_at: string;
};

type MarketRevisionRow = {
  id: string;
  market_id: string;
  revision_number: number;
  question: string;
  description: string;
  selection_a: string;
  selection_b: string;
  closes_at: string;
  status: MarketStatus;
  winning_selection: Selection | null;
  editor_user_id: string;
  editor_name: string;
  change_note: string;
  created_at: string;
  resolved_at: string | null;
};

type OfferRow = {
  id: string;
  maker_user_id: string;
  maker_name: string;
  maker_risk_cents: number;
  taker_risk_cents: number;
  maker_position: ParlayPosition;
  status: OfferStatus;
  created_at: string;
  accepted_at: string | null;
};

type OfferLegRow = {
  offer_id: string;
  market_id: string;
  market_revision_id: string;
  market_revision_number: number;
  market_question: string;
  market_description: string;
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
  maker_position: ParlayPosition;
  current_revision_id: string;
  status: BetStatus;
  accepted_at: string;
  settled_at: string | null;
};

type BetRevisionRow = {
  id: string;
  bet_id: string;
  revision_number: number;
  maker_risk_cents: number;
  taker_risk_cents: number;
  maker_position: ParlayPosition;
  proposer_user_id: string;
  proposer_name: string;
  recipient_user_id: string;
  recipient_name: string;
  status: BetRevisionStatus;
  change_note: string;
  created_at: string;
  responded_at: string | null;
};

type BetRevisionLegRow = Omit<OfferLegRow, "offer_id"> & {
  bet_revision_id: string;
};

type BetVoidRequestRow = {
  id: string;
  bet_id: string;
  base_revision_id: string;
  base_revision_number: number;
  requester_user_id: string;
  requester_name: string;
  recipient_user_id: string;
  recipient_name: string;
  reason: string;
  status:
    | "pending"
    | "accepted"
    | "rejected"
    | "cancelled"
    | "superseded";
  created_at: string;
  responded_at: string | null;
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
  maker_position: ParlayPosition;
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
  bet_revision_id: string;
  maker_user_id: string;
  taker_user_id: string;
  maker_risk_cents: number;
  taker_risk_cents: number;
  maker_position: ParlayPosition;
  maker_selection: Selection;
  market_status: MarketStatus;
  winning_selection: Selection | null;
};

const MAX_LEGS = 8;

export { AppError, parseAppAction } from "@/lib/action-parser";

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
    marketRevisionsResult,
    offersResult,
    legsResult,
    countersResult,
    betsResult,
    betRevisionsResult,
    betRevisionLegsResult,
    betVoidRequestsResult,
    debtsResult,
    settlementsResult,
    activityResult,
  ] = await db.batch([
    db.prepare(`SELECT id, email, display_name FROM users`),
    db.prepare(
      `SELECT m.*, u.display_name AS creator_name,
              mr.revision_number,
              (
                SELECT COUNT(DISTINCT ol.offer_id)
                FROM offer_legs ol
                WHERE ol.market_id = m.id
              ) AS offer_reference_count,
              (
                SELECT COUNT(DISTINCT ol.offer_id)
                FROM offer_legs ol
                JOIN offers o ON o.id = ol.offer_id
                WHERE ol.market_id = m.id
                  AND o.status = 'open'
              ) AS active_offer_reference_count,
              (
                SELECT COUNT(DISTINCT ol.offer_id)
                FROM offer_legs ol
                JOIN offers o ON o.id = ol.offer_id
                WHERE ol.market_id = m.id
                  AND o.status IN ('cancelled', 'expired')
                  AND NOT EXISTS (
                    SELECT 1 FROM bets b WHERE b.offer_id = o.id
                  )
              ) AS removable_offer_reference_count,
              (
                SELECT COUNT(DISTINCT br.bet_id)
                FROM bet_revision_legs brl
                JOIN bet_revisions br ON br.id = brl.bet_revision_id
                WHERE brl.market_id = m.id
              ) AS bet_reference_count
       FROM markets m
       JOIN users u ON u.id = m.creator_user_id
       JOIN market_revisions mr ON mr.id = m.current_revision_id
       ORDER BY
         CASE m.status WHEN 'open' THEN 0 WHEN 'resolved' THEN 1 ELSE 2 END,
         datetime(m.closes_at) DESC,
         datetime(m.created_at) DESC`,
    ),
    db.prepare(
      `SELECT mr.*, editor.display_name AS editor_name
       FROM market_revisions mr
       JOIN users editor ON editor.id = mr.editor_user_id
       ORDER BY mr.market_id, mr.revision_number DESC`,
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
      `SELECT l.offer_id, l.market_id, l.market_revision_id,
              l.maker_selection, mr.revision_number AS market_revision_number,
              mr.question AS market_question,
              mr.description AS market_description,
              mr.selection_a, mr.selection_b,
              mr.closes_at AS market_closes_at, mr.status AS market_status
       FROM offer_legs l
       JOIN market_revisions mr ON mr.id = l.market_revision_id
       ORDER BY l.offer_id, mr.closes_at`,
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
      `SELECT b.id, b.offer_id, b.maker_user_id, b.taker_user_id,
              b.current_revision_id, b.status, b.accepted_at, b.settled_at,
              br.maker_risk_cents, br.taker_risk_cents, br.maker_position,
              maker.display_name AS maker_name,
              taker.display_name AS taker_name
       FROM bets b
       JOIN bet_revisions br ON br.id = b.current_revision_id
       JOIN users maker ON maker.id = b.maker_user_id
       JOIN users taker ON taker.id = b.taker_user_id
       ORDER BY datetime(b.accepted_at) DESC
       LIMIT 100`,
    ),
    db.prepare(
      `SELECT br.*,
              proposer.display_name AS proposer_name,
              recipient.display_name AS recipient_name
       FROM bet_revisions br
       JOIN users proposer ON proposer.id = br.proposer_user_id
       JOIN users recipient ON recipient.id = br.recipient_user_id
       ORDER BY br.bet_id, br.revision_number ASC`,
    ),
    db.prepare(
      `SELECT brl.bet_revision_id, brl.market_id, brl.market_revision_id,
              brl.maker_selection,
              mr.revision_number AS market_revision_number,
              mr.question AS market_question,
              mr.description AS market_description,
              mr.selection_a, mr.selection_b,
              mr.closes_at AS market_closes_at, mr.status AS market_status
       FROM bet_revision_legs brl
       JOIN market_revisions mr ON mr.id = brl.market_revision_id
       ORDER BY brl.bet_revision_id, mr.closes_at`,
    ),
    db.prepare(
      `SELECT vr.*, base.revision_number AS base_revision_number,
              requester.display_name AS requester_name,
              recipient.display_name AS recipient_name
       FROM bet_void_requests vr
       JOIN bet_revisions base ON base.id = vr.base_revision_id
       JOIN users requester ON requester.id = vr.requester_user_id
       JOIN users recipient ON recipient.id = vr.recipient_user_id
       ORDER BY vr.bet_id, datetime(vr.created_at) ASC`,
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
  const marketRevisionRows = rows<MarketRevisionRow>(marketRevisionsResult);
  const offerRows = rows<OfferRow>(offersResult);
  const legRows = rows<OfferLegRow>(legsResult);
  const counterRows = rows<CounterRow>(countersResult);
  const betRows = rows<BetRow>(betsResult);
  const betRevisionRows = rows<BetRevisionRow>(betRevisionsResult);
  const betRevisionLegRows = rows<BetRevisionLegRow>(betRevisionLegsResult);
  const betVoidRequestRows = rows<BetVoidRequestRow>(
    betVoidRequestsResult,
  );
  const debtRows = rows<DebtRow>(debtsResult);
  const settlementRows = rows<SettlementRow>(settlementsResult);

  const legsByOffer = groupBy(legRows, (row) => row.offer_id);
  const countersByOffer = groupBy(counterRows, (row) => row.root_offer_id);
  const revisionsByMarket = groupBy(
    marketRevisionRows,
    (row) => row.market_id,
  );
  const revisionsByBet = groupBy(betRevisionRows, (row) => row.bet_id);
  const legsByBetRevision = groupBy(
    betRevisionLegRows,
    (row) => row.bet_revision_id,
  );
  const voidRequestsByBet = groupBy(
    betVoidRequestRows,
    (row) => row.bet_id,
  );

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
    markets: marketRows.map((market) => {
      const createdByMe = market.creator_user_id === user.id;
      const protectedOfferReferenceCount =
        market.offer_reference_count -
        market.removable_offer_reference_count;
      const canDelete =
        createdByMe &&
        protectedOfferReferenceCount === 0 &&
        market.bet_reference_count === 0;
      const deletionBlocker = !createdByMe
        ? null
        : protectedOfferReferenceCount > 0 &&
            market.bet_reference_count > 0
          ? `Referenced by ${protectedOfferReferenceCount} active or protected offer(s) and ${market.bet_reference_count} matched bet(s).`
          : protectedOfferReferenceCount > 0
            ? `Referenced by ${protectedOfferReferenceCount} active or protected offer(s).`
            : market.bet_reference_count > 0
              ? `Referenced by ${market.bet_reference_count} matched bet(s).`
              : null;
      return {
        id: market.id,
        question: market.question,
        description: market.description,
        selectionA: market.selection_a,
        selectionB: market.selection_b,
        closesAt: market.closes_at,
        status: market.status,
        winningSelection: market.winning_selection,
        creatorName: market.creator_name,
        createdByMe,
        createdAt: market.created_at,
        currentRevisionId: market.current_revision_id,
        revisionNumber: market.revision_number,
        offerReferenceCount: market.offer_reference_count,
        activeOfferReferenceCount: market.active_offer_reference_count,
        removableOfferReferenceCount:
          market.removable_offer_reference_count,
        betReferenceCount: market.bet_reference_count,
        canDelete,
        deletionBlocker,
        revisions: (revisionsByMarket.get(market.id) ?? []).map((revision) => ({
        id: revision.id,
        revisionNumber: revision.revision_number,
        question: revision.question,
        description: revision.description,
        selectionA: revision.selection_a,
        selectionB: revision.selection_b,
        closesAt: revision.closes_at,
        status: revision.status,
        winningSelection: revision.winning_selection,
        editorName: revision.editor_name,
        changeNote: revision.change_note,
        createdAt: revision.created_at,
        resolvedAt: revision.resolved_at,
        isCurrent: revision.id === market.current_revision_id,
        canResolve:
          market.creator_user_id === user.id && revision.status === "open",
        })),
      };
    }),
    offers: offerRows.map((offer) => ({
      id: offer.id,
      makerName: offer.maker_name,
      makerPosition: offer.maker_position,
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
    bets: betRows.map((bet) => {
      const activeLegRows =
        legsByBetRevision.get(bet.current_revision_id) ?? [];
      const isParticipant =
        bet.maker_user_id === user.id || bet.taker_user_id === user.id;
      const voidRequests = voidRequestsByBet.get(bet.id) ?? [];
      const hasPendingVoidRequest = voidRequests.some(
        (request) => request.status === "pending",
      );
      return {
        id: bet.id,
        makerName: bet.maker_name,
        takerName: bet.taker_name,
        makerPosition: bet.maker_position,
        makerRiskCents: bet.maker_risk_cents,
        takerRiskCents: bet.taker_risk_cents,
        status: bet.status,
        acceptedAt: bet.accepted_at,
        settledAt: bet.settled_at,
        isParticipant,
        mySide:
          bet.maker_user_id === user.id
            ? ("maker" as const)
            : bet.taker_user_id === user.id
              ? ("taker" as const)
              : null,
        myPosition:
          bet.maker_user_id === user.id
            ? bet.maker_position
            : bet.taker_user_id === user.id
              ? oppositePosition(bet.maker_position)
              : null,
        currentRevisionId: bet.current_revision_id,
        canProposeRevision:
          isParticipant &&
          canAmendBet(
            bet.status,
            activeLegRows.map((leg) => ({
              status: leg.market_status,
              closesAt: leg.market_closes_at,
            })),
          ),
        canRequestVoid:
          isParticipant && bet.status === "pending" && !hasPendingVoidRequest,
        legs: toLegViews(activeLegRows),
        revisions: (revisionsByBet.get(bet.id) ?? []).map((revision) => ({
          id: revision.id,
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
          canRespond:
            revision.status === "pending" &&
            revision.recipient_user_id === user.id,
          canCancel:
            revision.status === "pending" &&
            revision.proposer_user_id === user.id,
          legs: toLegViews(legsByBetRevision.get(revision.id) ?? []),
        })),
        voidRequests: voidRequests.map((request) => ({
          id: request.id,
          baseRevisionId: request.base_revision_id,
          baseRevisionNumber: request.base_revision_number,
          requesterName: request.requester_name,
          recipientName: request.recipient_name,
          reason: request.reason,
          status: request.status,
          createdAt: request.created_at,
          respondedAt: request.responded_at,
          canRespond:
            request.status === "pending" &&
            request.recipient_user_id === user.id,
          canCancel:
            request.status === "pending" &&
            request.requester_user_id === user.id,
        })),
      };
    }),
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

export async function performAction(
  user: AppUser,
  action: AppAction,
): Promise<void> {
  await ensureSchema();

  switch (action.type) {
    case "create_market":
      await createMarket(user, action);
      return;
    case "edit_market":
      await editMarket(user, action);
      return;
    case "delete_market":
      await deleteMarket(user, action.marketId);
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
    case "decline_counteroffer":
      await declineCounteroffer(user, action.counterId);
      return;
    case "cancel_offer":
      await cancelOffer(user, action.offerId);
      return;
    case "resolve_market":
      await resolveMarket(
        user,
        action.marketId,
        action.marketRevisionId,
        action.result,
      );
      return;
    case "propose_bet_revision":
      await proposeBetRevision(user, action);
      return;
    case "respond_bet_revision":
      await respondBetRevision(
        user,
        action.betRevisionId,
        action.decision,
      );
      return;
    case "cancel_bet_revision":
      await cancelBetRevision(user, action.betRevisionId);
      return;
    case "request_bet_void":
      await requestBetVoid(user, action.betId, action.reason);
      return;
    case "respond_bet_void":
      await respondBetVoid(
        user,
        action.betVoidRequestId,
        action.decision,
      );
      return;
    case "cancel_bet_void":
      await cancelBetVoid(user, action.betVoidRequestId);
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
  const revisionId = crypto.randomUUID();
  const db = getD1();
  await db.batch([
    db
      .prepare(
        `INSERT INTO markets
          (id, question, description, selection_a, selection_b, closes_at,
           creator_user_id, current_revision_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        id,
        question,
        description,
        selectionA,
        selectionB,
        closesAt.toISOString(),
        user.id,
        revisionId,
      ),
    db
      .prepare(
        `INSERT INTO market_revisions
          (id, market_id, revision_number, question, description, selection_a,
           selection_b, closes_at, editor_user_id, change_note)
         VALUES (?, ?, 1, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        revisionId,
        id,
        question,
        description,
        selectionA,
        selectionB,
        closesAt.toISOString(),
        user.id,
        "Original market terms",
      ),
    auditStatement(db, user.id, "created_market", "market", id, {
      question,
      marketRevisionId: revisionId,
    }),
  ]);
}

async function editMarket(
  user: AppUser,
  action: Extract<AppAction, { type: "edit_market" }>,
): Promise<void> {
  const question = boundedText(action.question, "Question", 5, 160);
  const description = boundedText(action.description, "Description", 0, 500);
  const selectionA = boundedText(action.selectionA, "Selection A", 1, 60);
  const selectionB = boundedText(action.selectionB, "Selection B", 1, 60);
  const changeNote = boundedText(action.changeNote, "Change note", 3, 200);
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

  const db = getD1();
  const current = await first<{
    creator_user_id: string;
    current_revision_id: string;
    revision_number: number;
    revision_status: MarketStatus;
    revision_closes_at: string;
  }>(
    db
      .prepare(
        `SELECT m.creator_user_id, m.current_revision_id,
                mr.revision_number, mr.status AS revision_status,
                mr.closes_at AS revision_closes_at
         FROM markets m
         JOIN market_revisions mr ON mr.id = m.current_revision_id
         WHERE m.id = ?`,
      )
      .bind(action.marketId),
  );
  if (!current) {
    throw new AppError(404, "MARKET_NOT_FOUND", "Market not found.");
  }
  if (current.creator_user_id !== user.id) {
    throw new AppError(
      403,
      "NOT_MARKET_ORACLE",
      "Only the market creator can edit it.",
    );
  }
  if (
    current.current_revision_id !== action.baseRevisionId ||
    current.revision_status !== "open" ||
    new Date(current.revision_closes_at).getTime() <= Date.now()
  ) {
    throw new AppError(
      409,
      "MARKET_CHANGED",
      "This market changed or closed while you were editing. Review the latest terms.",
    );
  }

  const revisionId = crypto.randomUUID();
  let results: D1Result<unknown>[];
  try {
    results = await db.batch([
      db
        .prepare(
          `INSERT INTO market_revisions
            (id, market_id, revision_number, question, description,
             selection_a, selection_b, closes_at, editor_user_id, change_note)
           SELECT ?, m.id, mr.revision_number + 1, ?, ?, ?, ?, ?, ?, ?
           FROM markets m
           JOIN market_revisions mr ON mr.id = m.current_revision_id
           WHERE m.id = ?
             AND m.current_revision_id = ?
             AND mr.status = 'open'
             AND datetime(mr.closes_at) > CURRENT_TIMESTAMP`,
        )
        .bind(
          revisionId,
          question,
          description,
          selectionA,
          selectionB,
          closesAt.toISOString(),
          user.id,
          changeNote,
          action.marketId,
          action.baseRevisionId,
        ),
      db
        .prepare(
          `UPDATE markets
           SET question = ?, description = ?, selection_a = ?,
               selection_b = ?, closes_at = ?, status = 'open',
               winning_selection = NULL, resolved_at = NULL,
               current_revision_id = ?
           WHERE id = ?
             AND current_revision_id = ?
             AND EXISTS (
               SELECT 1
               FROM market_revisions
               WHERE id = ? AND market_id = markets.id
             )`,
        )
        .bind(
          question,
          description,
          selectionA,
          selectionB,
          closesAt.toISOString(),
          revisionId,
          action.marketId,
          action.baseRevisionId,
          revisionId,
        ),
    ]);
  } catch (error) {
    const message = String(error).toLowerCase();
    if (
      message.includes("unique") ||
      message.includes("foreign key") ||
      message.includes("constraint failed")
    ) {
      throw new AppError(
        409,
        "MARKET_CHANGED",
        "Another market revision was saved first. Review the latest terms.",
      );
    }
    throw error;
  }
  if (results[0].meta.changes !== 1 || results[1].meta.changes !== 1) {
    throw new AppError(
      409,
      "MARKET_CHANGED",
      "This market changed or closed while you were editing. Review the latest terms.",
    );
  }

  await auditStatement(
    db,
    user.id,
    "edited_market",
    "market_revision",
    revisionId,
    {
      marketId: action.marketId,
      previousRevisionId: action.baseRevisionId,
      revisionNumber: current.revision_number + 1,
      changeNote,
    },
  ).run();
}

async function deleteMarket(
  user: AppUser,
  marketId: string,
): Promise<void> {
  const db = getD1();
  const market = await first<{
    id: string;
    creator_user_id: string;
    offer_reference_count: number;
    removable_offer_reference_count: number;
    bet_reference_count: number;
  }>(
    db
      .prepare(
        `SELECT m.id, m.creator_user_id,
                (
                  SELECT COUNT(DISTINCT ol.offer_id)
                  FROM offer_legs ol
                  WHERE ol.market_id = m.id
                ) AS offer_reference_count,
                (
                  SELECT COUNT(DISTINCT ol.offer_id)
                  FROM offer_legs ol
                  JOIN offers o ON o.id = ol.offer_id
                  WHERE ol.market_id = m.id
                    AND o.status IN ('cancelled', 'expired')
                    AND NOT EXISTS (
                      SELECT 1 FROM bets b WHERE b.offer_id = o.id
                    )
                ) AS removable_offer_reference_count,
                (
                  SELECT COUNT(DISTINCT br.bet_id)
                  FROM bet_revision_legs brl
                  JOIN bet_revisions br ON br.id = brl.bet_revision_id
                  WHERE brl.market_id = m.id
                ) AS bet_reference_count
         FROM markets m
         WHERE m.id = ?`,
      )
      .bind(marketId),
  );
  if (!market) {
    throw new AppError(404, "MARKET_NOT_FOUND", "Market not found.");
  }
  if (market.creator_user_id !== user.id) {
    throw new AppError(
      403,
      "NOT_MARKET_CREATOR",
      "Only the market creator can delete it.",
    );
  }
  if (
    market.offer_reference_count !==
      market.removable_offer_reference_count ||
    market.bet_reference_count > 0
  ) {
    throw new AppError(
      409,
      "MARKET_IN_USE",
      "This market has an active offer or matched-bet history and cannot be deleted.",
    );
  }

  const deletionOperationId = crypto.randomUUID();
  const results = await db.batch([
    db
      .prepare(
        `INSERT INTO audit_events
          (id, actor_user_id, action, entity_type, entity_id, metadata_json)
         SELECT ?, ?, 'deleted_market', 'market', m.id,
                json_object(
                  'question', m.question,
                  'deletionOperationId', ?,
                  'revisionCount', (
                    SELECT COUNT(*)
                    FROM market_revisions mr
                    WHERE mr.market_id = m.id
                  ),
                  'removedInactiveOfferCount', (
                    SELECT COUNT(DISTINCT ol.offer_id)
                    FROM offer_legs ol
                    JOIN offers o ON o.id = ol.offer_id
                    WHERE ol.market_id = m.id
                      AND o.status IN ('cancelled', 'expired')
                      AND NOT EXISTS (
                        SELECT 1 FROM bets b WHERE b.offer_id = o.id
                      )
                  )
                )
         FROM markets m
         WHERE m.id = ?
           AND m.creator_user_id = ?
           AND NOT EXISTS (
             SELECT 1
             FROM offer_legs ol
             JOIN offers o ON o.id = ol.offer_id
             WHERE ol.market_id = m.id
               AND (
                 o.status NOT IN ('cancelled', 'expired')
                 OR EXISTS (
                   SELECT 1 FROM bets b WHERE b.offer_id = o.id
                 )
               )
           )
           AND NOT EXISTS (
             SELECT 1
             FROM bet_revision_legs brl
             WHERE brl.market_id = m.id
           )`,
      )
      .bind(
        deletionOperationId,
        user.id,
        deletionOperationId,
        marketId,
        user.id,
      ),
    db
      .prepare(
        `INSERT INTO audit_events
          (id, actor_user_id, action, entity_type, entity_id, metadata_json)
         SELECT ? || ':' || o.id, ?, 'deleted_inactive_offer', 'offer', o.id,
                json_object(
                  'deletionOperationId', ?,
                  'triggeringMarketId', ?,
                  'status', o.status,
                  'makerRiskCents', o.maker_risk_cents,
                  'takerRiskCents', o.taker_risk_cents,
                  'makerPosition', o.maker_position,
                  'legCount', (
                    SELECT COUNT(*) FROM offer_legs all_legs
                    WHERE all_legs.offer_id = o.id
                  ),
                  'counterofferCount', (
                    SELECT COUNT(*) FROM counteroffers c
                    WHERE c.root_offer_id = o.id
                  )
                )
         FROM offers o
         JOIN offer_legs trigger_leg ON trigger_leg.offer_id = o.id
         WHERE trigger_leg.market_id = ?
           AND o.status IN ('cancelled', 'expired')
           AND NOT EXISTS (
             SELECT 1 FROM bets b WHERE b.offer_id = o.id
           )
           AND EXISTS (
             SELECT 1 FROM audit_events gate
             WHERE gate.id = ?
               AND gate.action = 'deleted_market'
               AND gate.entity_id = ?
           )`,
      )
      .bind(
        deletionOperationId,
        user.id,
        deletionOperationId,
        marketId,
        marketId,
        deletionOperationId,
        marketId,
      ),
    db
      .prepare(
        `DELETE FROM counteroffers
         WHERE root_offer_id IN (
           SELECT tombstone.entity_id
           FROM audit_events tombstone
           WHERE tombstone.action = 'deleted_inactive_offer'
             AND json_extract(
               tombstone.metadata_json,
               '$.deletionOperationId'
             ) = ?
         )
           AND EXISTS (
             SELECT 1 FROM audit_events gate
             WHERE gate.id = ? AND gate.action = 'deleted_market'
           )`,
      )
      .bind(deletionOperationId, deletionOperationId),
    db
      .prepare(
        `DELETE FROM offer_legs
         WHERE offer_id IN (
           SELECT tombstone.entity_id
           FROM audit_events tombstone
           WHERE tombstone.action = 'deleted_inactive_offer'
             AND json_extract(
               tombstone.metadata_json,
               '$.deletionOperationId'
             ) = ?
         )
           AND EXISTS (
             SELECT 1 FROM audit_events gate
             WHERE gate.id = ? AND gate.action = 'deleted_market'
           )`,
      )
      .bind(deletionOperationId, deletionOperationId),
    db
      .prepare(
        `DELETE FROM offers
         WHERE id IN (
           SELECT tombstone.entity_id
           FROM audit_events tombstone
           WHERE tombstone.action = 'deleted_inactive_offer'
             AND json_extract(
               tombstone.metadata_json,
               '$.deletionOperationId'
             ) = ?
         )
           AND status IN ('cancelled', 'expired')
           AND NOT EXISTS (
             SELECT 1 FROM bets b WHERE b.offer_id = offers.id
           )
           AND NOT EXISTS (
             SELECT 1 FROM offer_legs ol WHERE ol.offer_id = offers.id
           )
           AND EXISTS (
             SELECT 1 FROM audit_events gate
             WHERE gate.id = ? AND gate.action = 'deleted_market'
           )`,
      )
      .bind(deletionOperationId, deletionOperationId),
    db
      .prepare(
        `DELETE FROM market_revisions
         WHERE market_id = ?
           AND EXISTS (
             SELECT 1 FROM audit_events gate
             WHERE gate.id = ?
               AND gate.action = 'deleted_market'
               AND gate.entity_id = market_revisions.market_id
           )
           AND NOT EXISTS (
             SELECT 1
             FROM offer_legs ol
             WHERE ol.market_id = market_revisions.market_id
           )
           AND NOT EXISTS (
             SELECT 1
             FROM bet_revision_legs brl
             WHERE brl.market_id = market_revisions.market_id
           )`,
      )
      .bind(marketId, deletionOperationId),
    db
      .prepare(
        `DELETE FROM markets
         WHERE id = ?
           AND creator_user_id = ?
           AND EXISTS (
             SELECT 1 FROM audit_events gate
             WHERE gate.id = ?
               AND gate.action = 'deleted_market'
               AND gate.entity_id = markets.id
           )
           AND NOT EXISTS (
             SELECT 1 FROM market_revisions mr WHERE mr.market_id = markets.id
           )
           AND NOT EXISTS (
             SELECT 1 FROM offer_legs ol WHERE ol.market_id = markets.id
           )
           AND NOT EXISTS (
             SELECT 1
             FROM bet_revision_legs brl
             WHERE brl.market_id = markets.id
           )`,
      )
      .bind(marketId, user.id, deletionOperationId),
  ]);
  if (
    results[0].meta.changes !== 1 ||
    results[6].meta.changes !== 1
  ) {
    throw new AppError(
      409,
      "MARKET_CHANGED",
      "This market changed or gained a reference before deletion.",
    );
  }
}

async function createOffer(
  user: AppUser,
  action: Extract<AppAction, { type: "create_offer" }>,
): Promise<void> {
  if (action.makerPosition === "fade" && action.legs.length < 2) {
    throw new AppError(
      400,
      "FADE_REQUIRES_PARLAY",
      "Choose at least two legs to fade a parlay.",
    );
  }
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

  const marketRows = await getMarketRevisionsForLegs(action.legs);
  if (marketRows.length !== uniqueMarketIds.size) {
    throw new AppError(404, "MARKET_NOT_FOUND", "A selected market is missing.");
  }

  const nowMs = Date.now();
  for (const market of marketRows) {
    if (
      market.status !== "open" ||
      market.current_revision_id !== market.market_revision_id ||
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
          (id, maker_user_id, maker_risk_cents, taker_risk_cents,
           maker_position, expires_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        offerId,
        user.id,
        action.makerRiskCents,
        action.takerRiskCents,
        action.makerPosition,
        expiresAt,
      ),
  ];
  for (const leg of action.legs) {
    statements.push(
      db
        .prepare(
          `INSERT INTO offer_legs
            (id, offer_id, market_id, market_revision_id, maker_selection)
           VALUES (?, ?, ?, ?, ?)`,
        )
        .bind(
          crypto.randomUUID(),
          offerId,
          leg.marketId,
          leg.marketRevisionId,
          leg.selection,
        ),
    );
  }
  statements.push(
    auditStatement(db, user.id, "created_offer", "offer", offerId, {
      makerRiskCents: action.makerRiskCents,
      takerRiskCents: action.takerRiskCents,
      makerPosition: action.makerPosition,
      legCount: action.legs.length,
    }),
  );
  try {
    await db.batch(statements);
  } catch (error) {
    const message = String(error).toLowerCase();
    if (
      message.includes("foreign key") ||
      message.includes("constraint failed")
    ) {
      throw new AppError(
        409,
        "MARKET_CHANGED",
        "A selected market changed or was deleted before the offer was posted.",
      );
    }
    throw error;
  }
}

async function createCounteroffer(
  user: AppUser,
  action: Extract<AppAction, { type: "create_counteroffer" }>,
): Promise<void> {
  const db = getD1();
  const root = await first<RootOfferRow>(
    db
      .prepare(
        `SELECT id, maker_user_id, maker_risk_cents, taker_risk_cents,
                maker_position, status
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
  const createStatement = parent
    ? db
        .prepare(
          `INSERT INTO counteroffers
            (id, root_offer_id, parent_counter_id, challenger_user_id,
             proposer_user_id, recipient_user_id, maker_risk_cents,
             taker_risk_cents)
           SELECT ?, c.root_offer_id, c.id, c.challenger_user_id,
                  ?, ?, ?, ?
           FROM counteroffers c
           JOIN offers o ON o.id = c.root_offer_id
           WHERE c.id = ?
             AND c.root_offer_id = ?
             AND c.status = 'pending'
             AND c.recipient_user_id = ?
             AND o.status = 'open'
             AND EXISTS (
               SELECT 1 FROM offer_legs l WHERE l.offer_id = o.id
             )
             AND NOT EXISTS (
               SELECT 1
               FROM offer_legs l
               JOIN market_revisions mr ON mr.id = l.market_revision_id
               WHERE l.offer_id = o.id
                 AND (
                   mr.status <> 'open'
                   OR datetime(mr.closes_at) <= CURRENT_TIMESTAMP
                 )
             )`,
        )
        .bind(
          counterId,
          user.id,
          recipientUserId,
          action.makerRiskCents,
          action.takerRiskCents,
          parent.id,
          root.id,
          user.id,
        )
    : db
        .prepare(
          `INSERT INTO counteroffers
            (id, root_offer_id, parent_counter_id, challenger_user_id,
             proposer_user_id, recipient_user_id, maker_risk_cents,
             taker_risk_cents)
           SELECT ?, o.id, NULL, ?, ?, o.maker_user_id, ?, ?
           FROM offers o
           WHERE o.id = ?
             AND o.status = 'open'
             AND o.maker_user_id <> ?
             AND EXISTS (
               SELECT 1 FROM offer_legs l WHERE l.offer_id = o.id
             )
             AND NOT EXISTS (
               SELECT 1
               FROM offer_legs l
               JOIN market_revisions mr ON mr.id = l.market_revision_id
               WHERE l.offer_id = o.id
                 AND (
                   mr.status <> 'open'
                   OR datetime(mr.closes_at) <= CURRENT_TIMESTAMP
                 )
             )`,
        )
        .bind(
          counterId,
          challengerUserId,
          user.id,
          action.makerRiskCents,
          action.takerRiskCents,
          root.id,
          user.id,
        );
  const statements: D1PreparedStatement[] = [createStatement];
  if (parent) {
    statements.push(
      db
        .prepare(
          `UPDATE counteroffers
           SET status = 'superseded'
           WHERE id = ?
             AND status = 'pending'
             AND EXISTS (
               SELECT 1 FROM counteroffers child WHERE child.id = ?
             )`,
        )
        .bind(parent.id, counterId),
    );
  }
  statements.push(
    conditionalAuditStatement(
      db,
      user.id,
      "created_counteroffer",
      "counteroffer",
      counterId,
      "counteroffers",
      {
        offerId: root.id,
        makerRiskCents: action.makerRiskCents,
        takerRiskCents: action.takerRiskCents,
      },
    ),
  );
  const results = await db.batch(statements);
  if (results[0].meta.changes !== 1) {
    throw new AppError(
      409,
      parent ? "COUNTER_STALE" : "OFFER_TAKEN",
      parent
        ? "That counteroffer is no longer active."
        : "This offer is no longer open.",
    );
  }
}

async function acceptOffer(
  user: AppUser,
  action: Extract<AppAction, { type: "accept_offer" }>,
): Promise<void> {
  const db = getD1();
  const root = await first<RootOfferRow>(
    db
      .prepare(
        `SELECT id, maker_user_id, maker_risk_cents, taker_risk_cents,
                maker_position, status
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
  const betRevisionId = crypto.randomUUID();
  try {
    const results = await db.batch([
      db
        .prepare(
          `INSERT INTO bets
            (id, offer_id, maker_user_id, taker_user_id, maker_risk_cents,
             taker_risk_cents, accepted_counter_id, current_revision_id)
           SELECT ?, o.id, o.maker_user_id, ?, ?, ?, ?, ?
           FROM offers o
           WHERE o.id = ?
             AND o.status = 'open'
             AND (
               ? IS NULL OR EXISTS (
                 SELECT 1
                 FROM counteroffers c
                 WHERE c.id = ?
                   AND c.root_offer_id = o.id
                   AND c.status = 'pending'
                   AND c.recipient_user_id = ?
               )
             )
             AND EXISTS (
               SELECT 1 FROM offer_legs l WHERE l.offer_id = o.id
             )
             AND NOT EXISTS (
               SELECT 1
               FROM offer_legs l
               JOIN market_revisions mr ON mr.id = l.market_revision_id
               WHERE l.offer_id = o.id
                 AND (
                   mr.status <> 'open'
                   OR datetime(mr.closes_at) <= CURRENT_TIMESTAMP
                 )
             )`,
        )
        .bind(
          betId,
          takerUserId,
          makerRiskCents,
          takerRiskCents,
          acceptedCounterId,
          betRevisionId,
          root.id,
          acceptedCounterId,
          acceptedCounterId,
          user.id,
        ),
      db
        .prepare(
          `INSERT INTO bet_revisions
            (id, bet_id, revision_number, maker_risk_cents, taker_risk_cents,
             maker_position, proposer_user_id, recipient_user_id, status,
             change_note, responded_at)
           SELECT ?, b.id, 1, b.maker_risk_cents, b.taker_risk_cents,
                  o.maker_position, b.maker_user_id, b.taker_user_id, 'active',
                  'Original matched terms', CURRENT_TIMESTAMP
           FROM bets b
           JOIN offers o ON o.id = b.offer_id
           WHERE b.id = ?`,
        )
        .bind(betRevisionId, betId),
      db
        .prepare(
          `INSERT INTO bet_revision_legs
            (id, bet_revision_id, market_id, market_revision_id,
             maker_selection)
           SELECT ? || ':' || l.market_id, ?, l.market_id,
                  l.market_revision_id, l.maker_selection
           FROM offer_legs l
           JOIN bets b ON b.offer_id = l.offer_id
           WHERE b.id = ?`,
        )
        .bind(`bet-revision-leg:${betId}`, betRevisionId, betId),
      db
        .prepare(
          `UPDATE offers
           SET status = 'accepted',
               accepted_by_user_id = ?,
               accepted_counter_id = ?,
               accepted_at = CURRENT_TIMESTAMP
           WHERE id = ?
             AND status = 'open'
             AND EXISTS (
               SELECT 1
               FROM bets b
               WHERE b.id = ? AND b.offer_id = offers.id
             )`,
        )
        .bind(takerUserId, acceptedCounterId, root.id, betId),
      db
        .prepare(
          `UPDATE counteroffers
           SET status = CASE WHEN id = ? THEN 'accepted' ELSE 'superseded' END
           WHERE root_offer_id = ?
             AND status = 'pending'
             AND EXISTS (
               SELECT 1 FROM bets b WHERE b.id = ?
             )`,
        )
        .bind(acceptedCounterId ?? "", root.id, betId),
      conditionalAuditStatement(
        db,
        user.id,
        "accepted_offer",
        "bet",
        betId,
        "bets",
        {
          offerId: root.id,
          acceptedCounterId,
          makerPosition: root.maker_position,
        },
      ),
    ]);
    if (results[0].meta.changes !== 1) {
      throw new AppError(
        409,
        action.counterId ? "COUNTER_STALE" : "OFFER_TAKEN",
        action.counterId
          ? "That counteroffer is no longer active."
          : "Another friend got there first.",
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

}

async function declineCounteroffer(
  user: AppUser,
  counterId: string,
): Promise<void> {
  const db = getD1();
  const counter = await first<CounterDetailRow>(
    db
      .prepare(
        `SELECT *
         FROM counteroffers
         WHERE id = ?`,
      )
      .bind(counterId),
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
      "Only the recipient can decline these terms.",
    );
  }

  const results = await db.batch([
    conditionalAuditStatement(
      db,
      user.id,
      "declined_counteroffer",
      "counteroffer",
      counter.id,
      "counteroffers",
      { offerId: counter.root_offer_id },
      `status = 'pending' AND recipient_user_id = ?`,
      [user.id],
    ),
    db
      .prepare(
        `UPDATE counteroffers
         SET status = 'superseded'
         WHERE id = ?
           AND status = 'pending'
           AND recipient_user_id = ?`,
      )
      .bind(counter.id, user.id),
  ]);
  if (results[1].meta.changes !== 1) {
    throw new AppError(
      409,
      "COUNTER_STALE",
      "That counteroffer is no longer active.",
    );
  }
}

async function cancelOffer(user: AppUser, offerId: string): Promise<void> {
  const db = getD1();
  const offer = await first<RootOfferRow>(
    db
      .prepare(
        `SELECT id, maker_user_id, maker_risk_cents, taker_risk_cents,
                maker_position, status
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
  marketRevisionId: string,
  result: Selection | "void",
): Promise<void> {
  const db = getD1();
  const market = await first<{
    id: string;
    creator_user_id: string;
    current_revision_id: string;
    revision_status: MarketStatus;
  }>(
    db
      .prepare(
        `SELECT m.id, m.creator_user_id, m.current_revision_id,
                mr.status AS revision_status
         FROM markets m
         JOIN market_revisions mr ON mr.market_id = m.id
         WHERE m.id = ? AND mr.id = ?`,
      )
      .bind(marketId, marketRevisionId),
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
  if (market.revision_status !== "open") {
    throw new AppError(
      409,
      "MARKET_RESOLVED",
      "This market revision is already final.",
    );
  }

  const update = await db
    .prepare(
      `UPDATE market_revisions
       SET status = ?,
           winning_selection = ?,
           resolved_at = CURRENT_TIMESTAMP
       WHERE id = ? AND market_id = ? AND status = 'open'`,
    )
    .bind(
      result === "void" ? "void" : "resolved",
      result === "void" ? null : result,
      marketRevisionId,
      market.id,
    )
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
        `UPDATE markets
         SET status = ?,
             winning_selection = ?,
             resolved_at = CURRENT_TIMESTAMP
         WHERE id = ? AND current_revision_id = ?`,
      )
      .bind(
        result === "void" ? "void" : "resolved",
        result === "void" ? null : result,
        market.id,
        marketRevisionId,
      ),
    db
      .prepare(
        `UPDATE offers
         SET status = 'expired'
         WHERE status = 'open'
           AND id IN (
             SELECT offer_id
             FROM offer_legs
             WHERE market_revision_id = ?
           )`,
      )
      .bind(marketRevisionId),
    db
      .prepare(
        `UPDATE counteroffers
         SET status = 'superseded'
         WHERE status = 'pending'
           AND root_offer_id IN (
             SELECT offer_id
             FROM offer_legs
             WHERE market_revision_id = ?
           )`,
      )
      .bind(marketRevisionId),
    auditStatement(
      db,
      user.id,
      "resolved_market_revision",
      "market_revision",
      marketRevisionId,
      {
        marketId: market.id,
        result,
      },
    ),
  ]);

  await settlePendingBets();
}

async function proposeBetRevision(
  user: AppUser,
  action: Extract<AppAction, { type: "propose_bet_revision" }>,
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
  const changeNote = boundedText(action.changeNote, "Change note", 3, 200);
  const db = getD1();
  const bet = await first<{
    id: string;
    maker_user_id: string;
    taker_user_id: string;
    status: BetStatus;
    current_revision_id: string;
    current_maker_position: ParlayPosition;
  }>(
    db
      .prepare(
        `SELECT b.id, b.maker_user_id, b.taker_user_id, b.status,
                b.current_revision_id,
                br.maker_position AS current_maker_position
         FROM bets b
         JOIN bet_revisions br ON br.id = b.current_revision_id
         WHERE b.id = ?`,
      )
      .bind(action.betId),
  );
  if (!bet) {
    throw new AppError(404, "BET_NOT_FOUND", "Matched bet not found.");
  }
  if (bet.maker_user_id !== user.id && bet.taker_user_id !== user.id) {
    throw new AppError(
      403,
      "NOT_BET_PARTICIPANT",
      "Only the two participants can propose a change.",
    );
  }
  if (bet.status !== "pending") {
    throw new AppError(
      409,
      "BET_FINAL",
      "Settled bets cannot be changed.",
    );
  }
  const proposedMakerPosition =
    action.makerPosition ?? bet.current_maker_position;
  if (proposedMakerPosition === "fade" && action.legs.length < 2) {
    throw new AppError(
      400,
      "FADE_REQUIRES_PARLAY",
      "Choose at least two legs to fade a parlay.",
    );
  }

  const [currentWindows, proposedMarkets] = await Promise.all([
    getBetRevisionWindows(bet.current_revision_id),
    getMarketRevisionsForLegs(action.legs),
  ]);
  if (proposedMarkets.length !== action.legs.length) {
    throw new AppError(
      404,
      "MARKET_NOT_FOUND",
      "A selected market revision is missing.",
    );
  }
  if (
    !canAmendBet(bet.status, currentWindows) ||
    !canAmendBet(
      bet.status,
      proposedMarkets.map((market) => ({
        status: market.status,
        closesAt: market.closes_at,
      })),
    ) ||
    proposedMarkets.some(
      (market) =>
        market.current_revision_id !== market.market_revision_id,
    )
  ) {
    throw new AppError(
      409,
      "BET_REVISION_STALE",
      "Every current and proposed leg must still be open before its deadline.",
    );
  }

  const existing = await first<{ id: string }>(
    db
      .prepare(
        `SELECT id
         FROM bet_revisions
         WHERE bet_id = ? AND status = 'pending'
         LIMIT 1`,
      )
      .bind(bet.id),
  );
  if (existing) {
    throw new AppError(
      409,
      "BET_REVISION_PENDING",
      "This bet already has a change awaiting a response.",
    );
  }
  const nextRevision = await first<{ revision_number: number }>(
    db
      .prepare(
        `SELECT COALESCE(MAX(revision_number), 0) + 1 AS revision_number
         FROM bet_revisions
         WHERE bet_id = ?`,
      )
      .bind(bet.id),
  );
  const revisionId = crypto.randomUUID();
  const recipientUserId =
    user.id === bet.maker_user_id
      ? bet.taker_user_id
      : bet.maker_user_id;
  const statements: D1PreparedStatement[] = [
    db
      .prepare(
        `INSERT INTO bet_revisions
          (id, bet_id, revision_number, maker_risk_cents, taker_risk_cents,
           maker_position, proposer_user_id, recipient_user_id, change_note)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        revisionId,
        bet.id,
        nextRevision?.revision_number ?? 1,
        action.makerRiskCents,
        action.takerRiskCents,
        proposedMakerPosition,
        user.id,
        recipientUserId,
        changeNote,
      ),
  ];
  for (const leg of action.legs) {
    statements.push(
      db
        .prepare(
          `INSERT INTO bet_revision_legs
            (id, bet_revision_id, market_id, market_revision_id,
             maker_selection)
           VALUES (?, ?, ?, ?, ?)`,
        )
        .bind(
          crypto.randomUUID(),
          revisionId,
          leg.marketId,
          leg.marketRevisionId,
          leg.selection,
        ),
    );
  }
  try {
    await db.batch(statements);
  } catch (error) {
    if (String(error).toLowerCase().includes("unique")) {
      throw new AppError(
        409,
        "BET_REVISION_PENDING",
        "Another change proposal was submitted first.",
      );
    }
    throw error;
  }

  await auditStatement(
    db,
    user.id,
    "proposed_bet_revision",
    "bet_revision",
    revisionId,
    {
      betId: bet.id,
      revisionNumber: nextRevision?.revision_number ?? 1,
      changeNote,
      previousMakerPosition: bet.current_maker_position,
      makerPosition: proposedMakerPosition,
    },
  ).run();
}

async function respondBetRevision(
  user: AppUser,
  betRevisionId: string,
  decision: "accepted" | "rejected",
): Promise<void> {
  const db = getD1();
  const revision = await first<{
    id: string;
    bet_id: string;
    recipient_user_id: string;
    status: BetRevisionStatus;
    bet_status: BetStatus;
    current_revision_id: string;
    maker_position: ParlayPosition;
    current_maker_position: ParlayPosition;
  }>(
    db
      .prepare(
        `SELECT br.id, br.bet_id, br.recipient_user_id, br.status,
                br.maker_position, b.status AS bet_status,
                b.current_revision_id,
                current.maker_position AS current_maker_position
         FROM bet_revisions br
         JOIN bets b ON b.id = br.bet_id
         JOIN bet_revisions current ON current.id = b.current_revision_id
         WHERE br.id = ?`,
      )
      .bind(betRevisionId),
  );
  if (!revision) {
    throw new AppError(
      404,
      "BET_REVISION_NOT_FOUND",
      "Bet revision not found.",
    );
  }
  if (revision.recipient_user_id !== user.id) {
    throw new AppError(
      403,
      "NOT_REVISION_RECIPIENT",
      "Only the other participant can respond.",
    );
  }
  if (
    (decision === "accepted" &&
      revision.status === "active" &&
      revision.current_revision_id === revision.id) ||
    (decision === "rejected" && revision.status === "rejected")
  ) {
    return;
  }
  if (revision.status !== "pending") {
    throw new AppError(
      409,
      "BET_REVISION_FINAL",
      "This proposal already has a response.",
    );
  }
  if (decision === "rejected") {
    const result = await db
      .prepare(
        `UPDATE bet_revisions
         SET status = 'rejected', responded_at = CURRENT_TIMESTAMP
         WHERE id = ? AND status = 'pending' AND recipient_user_id = ?`,
      )
      .bind(revision.id, user.id)
      .run();
    if (result.meta.changes !== 1) {
      throw new AppError(
        409,
        "BET_REVISION_FINAL",
        "Another response was recorded first.",
      );
    }
    await auditStatement(
      db,
      user.id,
      "rejected_bet_revision",
      "bet_revision",
      revision.id,
      { betId: revision.bet_id },
    ).run();
    return;
  }

  const [currentWindows, proposedWindows] = await Promise.all([
    getBetRevisionWindows(revision.current_revision_id),
    getBetRevisionWindows(revision.id),
  ]);
  if (
    !canAmendBet(revision.bet_status, currentWindows) ||
    !canAmendBet(revision.bet_status, proposedWindows)
  ) {
    throw new AppError(
      409,
      "BET_REVISION_STALE",
      "A leg closed or resolved before this change was accepted.",
    );
  }

  const results = await db.batch([
    db
      .prepare(
        `UPDATE bets
         SET current_revision_id = ?,
             maker_risk_cents = (
               SELECT maker_risk_cents FROM bet_revisions WHERE id = ?
             ),
             taker_risk_cents = (
               SELECT taker_risk_cents FROM bet_revisions WHERE id = ?
             )
         WHERE id = ?
           AND status = 'pending'
           AND current_revision_id = ?
           AND EXISTS (
             SELECT 1
             FROM bet_revisions proposal
             WHERE proposal.id = ?
               AND proposal.bet_id = bets.id
               AND proposal.status = 'pending'
               AND proposal.recipient_user_id = ?
               AND EXISTS (
                 SELECT 1 FROM bet_revision_legs proposed
                 WHERE proposed.bet_revision_id = proposal.id
               )
               AND NOT EXISTS (
                 SELECT 1
                 FROM bet_revision_legs current_leg
                 JOIN market_revisions current_market
                   ON current_market.id = current_leg.market_revision_id
                 WHERE current_leg.bet_revision_id = bets.current_revision_id
                   AND (
                     current_market.status <> 'open'
                     OR datetime(current_market.closes_at) <= CURRENT_TIMESTAMP
                   )
               )
               AND NOT EXISTS (
                 SELECT 1
                 FROM bet_revision_legs proposed_leg
                 JOIN market_revisions proposed_market
                   ON proposed_market.id = proposed_leg.market_revision_id
                 WHERE proposed_leg.bet_revision_id = proposal.id
                   AND (
                     proposed_market.status <> 'open'
                     OR datetime(proposed_market.closes_at) <= CURRENT_TIMESTAMP
                   )
               )
           )`,
      )
      .bind(
        revision.id,
        revision.id,
        revision.id,
        revision.bet_id,
        revision.current_revision_id,
        revision.id,
        user.id,
      ),
    db
      .prepare(
        `UPDATE bet_revisions
         SET status = 'superseded', responded_at = CURRENT_TIMESTAMP
         WHERE id = ?
           AND status = 'active'
           AND EXISTS (
             SELECT 1
             FROM bets b
             JOIN bet_revisions proposal
               ON proposal.id = b.current_revision_id
             WHERE b.id = bet_revisions.bet_id
               AND b.status = 'pending'
               AND b.current_revision_id = ?
               AND proposal.status = 'pending'
           )`,
      )
      .bind(revision.current_revision_id, revision.id),
    db
      .prepare(
        `UPDATE bet_revisions
         SET status = 'active', responded_at = CURRENT_TIMESTAMP
         WHERE id = ?
           AND status = 'pending'
           AND recipient_user_id = ?
           AND EXISTS (
             SELECT 1
             FROM bets b
             WHERE b.id = bet_revisions.bet_id
               AND b.status = 'pending'
               AND b.current_revision_id = bet_revisions.id
           )`,
      )
      .bind(revision.id, user.id),
    db
      .prepare(
        `UPDATE bet_void_requests
         SET status = 'superseded', responded_at = CURRENT_TIMESTAMP
         WHERE bet_id = ?
           AND status = 'pending'
           AND EXISTS (
             SELECT 1
             FROM bets b
             WHERE b.id = bet_void_requests.bet_id
               AND b.status = 'pending'
               AND b.current_revision_id = ?
           )`,
      )
      .bind(revision.bet_id, revision.id),
  ]);
  if (
    results[0].meta.changes !== 1 ||
    results[1].meta.changes !== 1 ||
    results[2].meta.changes !== 1
  ) {
    throw new AppError(
      409,
      "BET_REVISION_STALE",
      "The bet or one of its legs changed before this response.",
    );
  }

  await auditStatement(
    db,
    user.id,
    "accepted_bet_revision",
    "bet_revision",
    revision.id,
    {
      betId: revision.bet_id,
      previousMakerPosition: revision.current_maker_position,
      makerPosition: revision.maker_position,
    },
  ).run();
}

async function cancelBetRevision(
  user: AppUser,
  betRevisionId: string,
): Promise<void> {
  const db = getD1();
  const result = await db
    .prepare(
      `UPDATE bet_revisions
       SET status = 'cancelled', responded_at = CURRENT_TIMESTAMP
       WHERE id = ? AND status = 'pending' AND proposer_user_id = ?`,
    )
    .bind(betRevisionId, user.id)
    .run();
  if (result.meta.changes !== 1) {
    const revision = await first<{
      proposer_user_id: string;
      status: BetRevisionStatus;
    }>(
      db
        .prepare(
          `SELECT proposer_user_id, status
           FROM bet_revisions
           WHERE id = ?`,
        )
        .bind(betRevisionId),
    );
    if (!revision) {
      throw new AppError(
        404,
        "BET_REVISION_NOT_FOUND",
        "Bet revision not found.",
      );
    }
    if (revision.proposer_user_id !== user.id) {
      throw new AppError(
        403,
        "NOT_REVISION_PROPOSER",
        "Only the proposer can cancel this change.",
      );
    }
    if (revision.status === "cancelled") return;
    throw new AppError(
      409,
      "BET_REVISION_FINAL",
      "This proposal already has a response.",
    );
  }

  await auditStatement(
    db,
    user.id,
    "cancelled_bet_revision",
    "bet_revision",
    betRevisionId,
  ).run();
}

async function requestBetVoid(
  user: AppUser,
  betId: string,
  rawReason: string,
): Promise<void> {
  const reason = boundedText(rawReason, "Reason", 3, 200);
  await settlePendingBets();

  const db = getD1();
  const bet = await first<{
    id: string;
    maker_user_id: string;
    taker_user_id: string;
    current_revision_id: string;
    status: BetStatus;
  }>(
    db
      .prepare(
        `SELECT id, maker_user_id, taker_user_id, current_revision_id, status
         FROM bets
         WHERE id = ?`,
      )
      .bind(betId),
  );
  if (!bet) {
    throw new AppError(404, "BET_NOT_FOUND", "Matched bet not found.");
  }
  if (bet.maker_user_id !== user.id && bet.taker_user_id !== user.id) {
    throw new AppError(
      403,
      "NOT_BET_PARTICIPANT",
      "Only the two participants can request a void.",
    );
  }
  if (bet.status !== "pending") {
    throw new AppError(
      409,
      "BET_FINAL",
      "Only pending matched bets can be voided by agreement.",
    );
  }

  const requestId = crypto.randomUUID();
  const recipientUserId =
    user.id === bet.maker_user_id
      ? bet.taker_user_id
      : bet.maker_user_id;
  let results: D1Result<unknown>[];
  try {
    results = await db.batch([
      db
        .prepare(
          `INSERT INTO bet_void_requests
            (id, bet_id, base_revision_id, requester_user_id,
             recipient_user_id, reason)
           SELECT ?, b.id, b.current_revision_id, ?, ?, ?
           FROM bets b
           WHERE b.id = ?
             AND b.status = 'pending'
             AND b.current_revision_id = ?
             AND NOT EXISTS (
               SELECT 1
               FROM bet_void_requests existing
               WHERE existing.bet_id = b.id
                 AND existing.status = 'pending'
             )`,
        )
        .bind(
          requestId,
          user.id,
          recipientUserId,
          reason,
          bet.id,
          bet.current_revision_id,
        ),
      db
        .prepare(
          `INSERT INTO audit_events
            (id, actor_user_id, action, entity_type, entity_id, metadata_json)
           SELECT ?, ?, 'requested_bet_void', 'bet_void_request', vr.id,
                  json_object(
                    'betId', vr.bet_id,
                    'baseRevisionId', vr.base_revision_id,
                    'reason', vr.reason
                  )
           FROM bet_void_requests vr
           WHERE vr.id = ? AND vr.status = 'pending'`,
        )
        .bind(crypto.randomUUID(), user.id, requestId),
    ]);
  } catch (error) {
    if (String(error).toLowerCase().includes("unique")) {
      throw new AppError(
        409,
        "BET_VOID_PENDING",
        "This bet already has a void request awaiting a response.",
      );
    }
    throw error;
  }
  if (results[0].meta.changes !== 1) {
    const latest = await first<{ status: BetStatus }>(
      db.prepare(`SELECT status FROM bets WHERE id = ?`).bind(bet.id),
    );
    if (!latest || latest.status !== "pending") {
      throw new AppError(
        409,
        "BET_FINAL",
        "The bet settled before the void request was created.",
      );
    }
    throw new AppError(
      409,
      "BET_VOID_PENDING",
      "This bet already has a void request awaiting a response.",
    );
  }
}

async function respondBetVoid(
  user: AppUser,
  betVoidRequestId: string,
  decision: "accepted" | "rejected",
): Promise<void> {
  const db = getD1();
  const request = await first<{
    id: string;
    bet_id: string;
    base_revision_id: string;
    recipient_user_id: string;
    status: BetVoidRequestRow["status"];
    bet_status: BetStatus;
    current_revision_id: string;
  }>(
    db
      .prepare(
        `SELECT vr.id, vr.bet_id, vr.base_revision_id,
                vr.recipient_user_id, vr.status,
                b.status AS bet_status, b.current_revision_id
         FROM bet_void_requests vr
         JOIN bets b ON b.id = vr.bet_id
         WHERE vr.id = ?`,
      )
      .bind(betVoidRequestId),
  );
  if (!request) {
    throw new AppError(
      404,
      "BET_VOID_NOT_FOUND",
      "Void request not found.",
    );
  }
  if (request.recipient_user_id !== user.id) {
    throw new AppError(
      403,
      "NOT_VOID_RECIPIENT",
      "Only the other participant can respond.",
    );
  }
  if (request.status === decision) return;
  if (request.status !== "pending") {
    throw new AppError(
      409,
      "BET_VOID_FINAL",
      "This void request already has a response.",
    );
  }

  if (decision === "rejected") {
    const results = await db.batch([
      db
        .prepare(
          `UPDATE bet_void_requests
           SET status = 'rejected', responded_at = CURRENT_TIMESTAMP
           WHERE id = ?
             AND status = 'pending'
             AND recipient_user_id = ?`,
        )
        .bind(request.id, user.id),
      db
        .prepare(
          `INSERT INTO audit_events
            (id, actor_user_id, action, entity_type, entity_id, metadata_json)
           SELECT ?, ?, 'rejected_bet_void', 'bet_void_request', vr.id,
                  json_object('betId', vr.bet_id)
           FROM bet_void_requests vr
           WHERE vr.id = ?
             AND vr.status = 'rejected'
             AND NOT EXISTS (
               SELECT 1
               FROM audit_events existing
               WHERE existing.action = 'rejected_bet_void'
                 AND existing.entity_type = 'bet_void_request'
                 AND existing.entity_id = vr.id
             )`,
        )
        .bind(crypto.randomUUID(), user.id, request.id),
    ]);
    if (results[0].meta.changes !== 1) {
      throw new AppError(
        409,
        "BET_VOID_FINAL",
        "Another response was recorded first.",
      );
    }
    return;
  }

  const results = await db.batch([
    db
      .prepare(
        `UPDATE bet_void_requests
         SET status = 'accepted', responded_at = CURRENT_TIMESTAMP
         WHERE id = ?
           AND status = 'pending'
           AND recipient_user_id = ?
           AND EXISTS (
             SELECT 1
             FROM bets b
             WHERE b.id = bet_void_requests.bet_id
               AND b.status = 'pending'
               AND b.current_revision_id = bet_void_requests.base_revision_id
           )`,
      )
      .bind(request.id, user.id),
    db
      .prepare(
        `UPDATE bets
         SET status = 'void', settled_at = CURRENT_TIMESTAMP
         WHERE id = ?
           AND status = 'pending'
           AND current_revision_id = ?
           AND EXISTS (
             SELECT 1
             FROM bet_void_requests vr
             WHERE vr.id = ?
               AND vr.bet_id = bets.id
               AND vr.status = 'accepted'
           )`,
      )
      .bind(request.bet_id, request.base_revision_id, request.id),
    db
      .prepare(
        `UPDATE bet_revisions
         SET status = 'superseded', responded_at = CURRENT_TIMESTAMP
         WHERE bet_id = ?
           AND status = 'pending'
           AND EXISTS (
             SELECT 1
             FROM bets b
             WHERE b.id = bet_revisions.bet_id
               AND b.status = 'void'
           )`,
      )
      .bind(request.bet_id),
    db
      .prepare(
        `INSERT INTO audit_events
          (id, actor_user_id, action, entity_type, entity_id, metadata_json)
         SELECT ?, ?, 'accepted_bet_void', 'bet_void_request', vr.id,
                json_object(
                  'betId', vr.bet_id,
                  'baseRevisionId', vr.base_revision_id,
                  'reason', vr.reason
                )
         FROM bet_void_requests vr
         JOIN bets b ON b.id = vr.bet_id
         WHERE vr.id = ?
           AND vr.status = 'accepted'
           AND b.status = 'void'
           AND NOT EXISTS (
             SELECT 1
             FROM audit_events existing
             WHERE existing.action = 'accepted_bet_void'
               AND existing.entity_type = 'bet_void_request'
               AND existing.entity_id = vr.id
           )`,
      )
      .bind(crypto.randomUUID(), user.id, request.id),
  ]);
  if (
    results[0].meta.changes !== 1 ||
    results[1].meta.changes !== 1
  ) {
    await db
      .prepare(
        `UPDATE bet_void_requests
         SET status = 'superseded', responded_at = CURRENT_TIMESTAMP
         WHERE id = ?
           AND status = 'pending'
           AND EXISTS (
             SELECT 1
             FROM bets b
             WHERE b.id = bet_void_requests.bet_id
               AND (
                 b.status <> 'pending'
                 OR b.current_revision_id <> bet_void_requests.base_revision_id
               )
           )`,
      )
      .bind(request.id)
      .run();
    throw new AppError(
      409,
      "BET_VOID_STALE",
      "The bet settled or its terms changed before this void was accepted.",
    );
  }
}

async function cancelBetVoid(
  user: AppUser,
  betVoidRequestId: string,
): Promise<void> {
  const db = getD1();
  const update = await db
    .prepare(
      `UPDATE bet_void_requests
       SET status = 'cancelled', responded_at = CURRENT_TIMESTAMP
       WHERE id = ?
         AND status = 'pending'
         AND requester_user_id = ?`,
    )
    .bind(betVoidRequestId, user.id)
    .run();
  if (update.meta.changes === 1) {
    await db
      .prepare(
        `INSERT INTO audit_events
          (id, actor_user_id, action, entity_type, entity_id, metadata_json)
         SELECT ?, ?, 'cancelled_bet_void', 'bet_void_request', vr.id,
                json_object('betId', vr.bet_id)
         FROM bet_void_requests vr
         WHERE vr.id = ?
           AND vr.status = 'cancelled'
           AND NOT EXISTS (
             SELECT 1
             FROM audit_events existing
             WHERE existing.action = 'cancelled_bet_void'
               AND existing.entity_type = 'bet_void_request'
               AND existing.entity_id = vr.id
           )`,
      )
      .bind(crypto.randomUUID(), user.id, betVoidRequestId)
      .run();
    return;
  }

  const request = await first<{
    requester_user_id: string;
    status: BetVoidRequestRow["status"];
  }>(
    db
      .prepare(
        `SELECT requester_user_id, status
         FROM bet_void_requests
         WHERE id = ?`,
      )
      .bind(betVoidRequestId),
  );
  if (!request) {
    throw new AppError(
      404,
      "BET_VOID_NOT_FOUND",
      "Void request not found.",
    );
  }
  if (request.requester_user_id !== user.id) {
    throw new AppError(
      403,
      "NOT_VOID_REQUESTER",
      "Only the requester can cancel this void request.",
    );
  }
  if (request.status === "cancelled") return;
  throw new AppError(
    409,
    "BET_VOID_FINAL",
    "This void request already has a response.",
  );
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
      `SELECT b.id AS bet_id, br.id AS bet_revision_id,
              b.maker_user_id, b.taker_user_id,
              br.maker_risk_cents, br.taker_risk_cents, br.maker_position,
              l.maker_selection, mr.status AS market_status,
              mr.winning_selection
       FROM bets b
       JOIN bet_revisions br ON br.id = b.current_revision_id
       JOIN bet_revision_legs l ON l.bet_revision_id = br.id
       JOIN market_revisions mr ON mr.id = l.market_revision_id
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
      legs[0].maker_position,
    );
    if (result === "pending") continue;

    const bet = legs[0];
    statements.push(
      db
        .prepare(
          `UPDATE bets
           SET status = ?, settled_at = CURRENT_TIMESTAMP
           WHERE id = ?
             AND status = 'pending'
             AND current_revision_id = ?`,
        )
        .bind(result, betId, bet.bet_revision_id),
    );
    if (result === "maker_won") {
      statements.push(
        debtInsertStatement(
          db,
          betId,
          bet.taker_user_id,
          bet.maker_user_id,
          bet.taker_risk_cents,
          result,
          bet.bet_revision_id,
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
          result,
          bet.bet_revision_id,
        ),
      );
    }
    statements.push(
      db
        .prepare(
          `UPDATE bet_void_requests
           SET status = 'superseded', responded_at = CURRENT_TIMESTAMP
           WHERE bet_id = ?
             AND status = 'pending'
             AND EXISTS (
               SELECT 1
               FROM bets b
               WHERE b.id = bet_void_requests.bet_id
                 AND b.status <> 'pending'
             )`,
        )
        .bind(betId),
    );
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

async function getMarketRevisionsForLegs(
  legs: ReadonlyArray<{
    marketId: string;
    marketRevisionId: string;
  }>,
): Promise<
  Array<{
    market_id: string;
    market_revision_id: string;
    current_revision_id: string;
    status: MarketStatus;
    closes_at: string;
    creator_user_id: string;
  }>
> {
  if (legs.length === 0) return [];
  const revisionIds = legs.map((leg) => leg.marketRevisionId);
  const placeholders = revisionIds.map(() => "?").join(", ");
  const revisionRows = await all<{
    market_id: string;
    market_revision_id: string;
    current_revision_id: string;
    status: MarketStatus;
    closes_at: string;
    creator_user_id: string;
  }>(
    getD1()
      .prepare(
        `SELECT m.id AS market_id, mr.id AS market_revision_id,
                m.current_revision_id, mr.status, mr.closes_at,
                m.creator_user_id
         FROM market_revisions mr
         JOIN markets m ON m.id = mr.market_id
         WHERE mr.id IN (${placeholders})`,
      )
      .bind(...revisionIds),
  );
  return legs.flatMap((leg) => {
    const match = revisionRows.find(
      (row) =>
        row.market_id === leg.marketId &&
        row.market_revision_id === leg.marketRevisionId,
    );
    return match ? [match] : [];
  });
}

async function getMarketsForOffer(offerId: string): Promise<
  Array<{
    market_id: string;
    market_revision_id: string;
    status: MarketStatus;
    closes_at: string;
    creator_user_id: string;
  }>
> {
  return all(
    getD1()
      .prepare(
        `SELECT m.id AS market_id, mr.id AS market_revision_id,
                mr.status, mr.closes_at, m.creator_user_id
         FROM offer_legs l
         JOIN markets m ON m.id = l.market_id
         JOIN market_revisions mr ON mr.id = l.market_revision_id
         WHERE l.offer_id = ?`,
      )
      .bind(offerId),
  );
}

async function getBetRevisionWindows(
  betRevisionId: string,
): Promise<Array<{ status: MarketStatus; closesAt: string }>> {
  const rowsForRevision = await all<{
    status: MarketStatus;
    closes_at: string;
  }>(
    getD1()
      .prepare(
        `SELECT mr.status, mr.closes_at
         FROM bet_revision_legs brl
         JOIN market_revisions mr ON mr.id = brl.market_revision_id
         WHERE brl.bet_revision_id = ?`,
      )
      .bind(betRevisionId),
  );
  return rowsForRevision.map((row) => ({
    status: row.status,
    closesAt: row.closes_at,
  }));
}

function debtInsertStatement(
  db: D1Database,
  betId: string,
  debtorUserId: string,
  creditorUserId: string,
  amountCents: number,
  result: Exclude<BetStatus, "pending" | "void">,
  betRevisionId: string,
): D1PreparedStatement {
  return db
    .prepare(
      `INSERT OR IGNORE INTO debts
        (id, bet_id, debtor_user_id, creditor_user_id, amount_cents)
       SELECT ?, ?, ?, ?, ?
       FROM bets
       WHERE id = ?
         AND status = ?
         AND current_revision_id = ?`,
    )
    .bind(
      crypto.randomUUID(),
      betId,
      debtorUserId,
      creditorUserId,
      amountCents,
      betId,
      result,
      betRevisionId,
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

function conditionalAuditStatement(
  db: D1Database,
  actorUserId: string,
  action: string,
  entityType: string,
  entityId: string,
  entityTable: "counteroffers" | "bets",
  metadata: Record<string, unknown> = {},
  extraPredicate = "1 = 1",
  extraBindings: unknown[] = [],
): D1PreparedStatement {
  return db
    .prepare(
      `INSERT INTO audit_events
        (id, actor_user_id, action, entity_type, entity_id, metadata_json)
       SELECT ?, ?, ?, ?, ?, ?
       FROM ${entityTable}
       WHERE id = ? AND ${extraPredicate}`,
    )
    .bind(
      crypto.randomUUID(),
      actorUserId,
      action,
      entityType,
      entityId,
      JSON.stringify(metadata),
      entityId,
      ...extraBindings,
    );
}

function toLegViews(
  revisionLegs: ReadonlyArray<OfferLegRow | BetRevisionLegRow>,
) {
  return revisionLegs.map((leg) => ({
    marketId: leg.market_id,
    marketRevisionId: leg.market_revision_id,
    marketRevisionNumber: leg.market_revision_number,
    marketQuestion: leg.market_question,
    marketDescription: leg.market_description,
    marketClosesAt: leg.market_closes_at,
    makerSelection: leg.maker_selection,
    makerSelectionLabel:
      leg.maker_selection === "a" ? leg.selection_a : leg.selection_b,
    takerSelectionLabel:
      leg.maker_selection === "a" ? leg.selection_b : leg.selection_a,
    marketStatus: leg.market_status,
  }));
}

function oppositePosition(position: ParlayPosition): ParlayPosition {
  return position === "back" ? "fade" : "back";
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
