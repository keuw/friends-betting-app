export type Selection = "a" | "b";
export type ParlayPosition = "back" | "fade";
export type MarketStatus = "open" | "resolved" | "void";
export type OfferStatus = "open" | "accepted" | "cancelled" | "expired";
export type BetStatus = "pending" | "maker_won" | "taker_won" | "void";
export type BetRevisionStatus =
  | "active"
  | "pending"
  | "rejected"
  | "cancelled"
  | "superseded";
export type BetVoidRequestStatus =
  | "pending"
  | "accepted"
  | "rejected"
  | "cancelled"
  | "superseded";
export type SettlementStatus =
  | "pending"
  | "confirmed"
  | "rejected"
  | "cancelled";

export type Viewer = {
  id: string;
  displayName: string;
  isAdmin: boolean;
};

export type MarketView = {
  id: string;
  question: string;
  description: string;
  selectionA: string;
  selectionB: string;
  closesAt: string;
  status: MarketStatus;
  winningSelection: Selection | null;
  creatorName: string;
  createdByMe: boolean;
  canManage: boolean;
  createdAt: string;
  currentRevisionId: string;
  revisionNumber: number;
  offerReferenceCount: number;
  activeOfferReferenceCount: number;
  extendableOfferReferenceCount: number;
  removableOfferReferenceCount: number;
  betReferenceCount: number;
  canDelete: boolean;
  deletionBlocker: string | null;
  revisions: MarketRevisionView[];
};

export type MarketRevisionView = {
  id: string;
  revisionNumber: number;
  question: string;
  description: string;
  selectionA: string;
  selectionB: string;
  closesAt: string;
  status: MarketStatus;
  winningSelection: Selection | null;
  editorName: string;
  changeNote: string;
  createdAt: string;
  resolvedAt: string | null;
  isCurrent: boolean;
  canResolve: boolean;
  canUnresolve: boolean;
  resolutionEvents: MarketResolutionEventView[];
};

export type MarketResolutionEventView = {
  id: string;
  actorName: string;
  action: "resolved" | "unresolved";
  result: Selection | "void" | null;
  reason: string | null;
  createdAt: string;
};

export type OfferLegView = {
  marketId: string;
  marketRevisionId: string;
  marketRevisionNumber: number;
  originalMarketRevisionId: string;
  originalMarketRevisionNumber: number;
  marketQuestion: string;
  marketDescription: string;
  marketClosesAt: string;
  originalMarketClosesAt: string;
  makerSelection: Selection;
  makerSelectionLabel: string;
  takerSelectionLabel: string;
  marketStatus: MarketStatus;
};

export type CounterofferView = {
  id: string;
  parentCounterId: string | null;
  challengerName: string;
  proposerName: string;
  recipientName: string;
  makerRiskCents: number;
  takerRiskCents: number;
  status: "pending" | "accepted" | "superseded";
  createdAt: string;
  canRespond: boolean;
};

export type OfferView = {
  id: string;
  makerName: string;
  makerPosition: ParlayPosition;
  makerRiskCents: number;
  takerRiskCents: number;
  status: OfferStatus;
  createdAt: string;
  acceptedAt: string | null;
  expiresAt: string | null;
  isMine: boolean;
  legs: OfferLegView[];
  counters: CounterofferView[];
};

export type BetView = {
  id: string;
  makerName: string;
  takerName: string;
  makerPosition: ParlayPosition;
  makerRiskCents: number;
  takerRiskCents: number;
  status: BetStatus;
  acceptedAt: string;
  settledAt: string | null;
  isParticipant: boolean;
  mySide: "maker" | "taker" | null;
  myPosition: ParlayPosition | null;
  currentRevisionId: string;
  canProposeRevision: boolean;
  canRequestVoid: boolean;
  legs: OfferLegView[];
  revisions: BetRevisionView[];
  voidRequests: BetVoidRequestView[];
};

export type BetRevisionView = {
  id: string;
  revisionNumber: number;
  makerPosition: ParlayPosition;
  makerRiskCents: number;
  takerRiskCents: number;
  proposerName: string;
  recipientName: string;
  status: BetRevisionStatus;
  changeNote: string;
  createdAt: string;
  respondedAt: string | null;
  canRespond: boolean;
  canCancel: boolean;
  legs: OfferLegView[];
};

export type BetVoidRequestView = {
  id: string;
  baseRevisionId: string;
  baseRevisionNumber: number;
  requesterName: string;
  recipientName: string;
  reason: string;
  status: BetVoidRequestStatus;
  createdAt: string;
  respondedAt: string | null;
  canRespond: boolean;
  canCancel: boolean;
};

export type PairBalanceView = {
  debtorUserId: string;
  debtorName: string;
  creditorUserId: string;
  creditorName: string;
  amountCents: number;
  involvesMe: boolean;
  iOwe: boolean;
  owedToMe: boolean;
};

export type OfflineSettlementView = {
  id: string;
  debtorName: string;
  creditorName: string;
  amountCents: number;
  status: SettlementStatus;
  proposedAt: string;
  respondedAt: string | null;
  canRespond: boolean;
  isMine: boolean;
};

export type ActivityView = {
  id: string;
  actorName: string;
  action: string;
  entityType: string;
  entityId: string;
  metadata: Record<string, unknown>;
  createdAt: string;
};

export type AppState = {
  viewer: Viewer;
  markets: MarketView[];
  offers: OfferView[];
  bets: BetView[];
  pairBalances: PairBalanceView[];
  settlements: OfflineSettlementView[];
  activity: ActivityView[];
};

export type CreateMarketAction = {
  type: "create_market";
  question: string;
  description: string;
  selectionA: string;
  selectionB: string;
  closesAt: string;
};

export type CreateOfferAction = {
  type: "create_offer";
  makerPosition: ParlayPosition;
  makerRiskCents: number;
  takerRiskCents: number;
  legs: Array<{
    marketId: string;
    marketRevisionId: string;
    selection: Selection;
  }>;
};

export type EditMarketAction = {
  type: "edit_market";
  marketId: string;
  baseRevisionId: string;
  question: string;
  description: string;
  selectionA: string;
  selectionB: string;
  closesAt: string;
  changeNote: string;
};

export type ReopenMarketAction = {
  type: "reopen_market";
  marketId: string;
  baseRevisionId: string;
  closesAt: string;
  changeNote: string;
};

export type DeleteMarketAction = {
  type: "delete_market";
  marketId: string;
};

export type CreateCounterofferAction = {
  type: "create_counteroffer";
  offerId: string;
  parentCounterId?: string;
  makerRiskCents: number;
  takerRiskCents: number;
};

export type AcceptOfferAction = {
  type: "accept_offer";
  offerId: string;
  counterId?: string;
};

export type DeclineCounterofferAction = {
  type: "decline_counteroffer";
  counterId: string;
};

export type CancelOfferAction = {
  type: "cancel_offer";
  offerId: string;
};

export type ResolveMarketAction = {
  type: "resolve_market";
  marketId: string;
  marketRevisionId: string;
  result: Selection | "void";
};

export type UnresolveMarketAction = {
  type: "unresolve_market";
  marketId: string;
  marketRevisionId: string;
  reason: string;
};

export type ProposeBetRevisionAction = {
  type: "propose_bet_revision";
  betId: string;
  makerPosition?: ParlayPosition;
  makerRiskCents: number;
  takerRiskCents: number;
  changeNote: string;
  legs: Array<{
    marketId: string;
    marketRevisionId: string;
    selection: Selection;
  }>;
};

export type RespondBetRevisionAction = {
  type: "respond_bet_revision";
  betRevisionId: string;
  decision: "accepted" | "rejected";
};

export type CancelBetRevisionAction = {
  type: "cancel_bet_revision";
  betRevisionId: string;
};

export type RequestBetVoidAction = {
  type: "request_bet_void";
  betId: string;
  reason: string;
};

export type RespondBetVoidAction = {
  type: "respond_bet_void";
  betVoidRequestId: string;
  decision: "accepted" | "rejected";
};

export type CancelBetVoidAction = {
  type: "cancel_bet_void";
  betVoidRequestId: string;
};

export type ProposeOfflineSettlementAction = {
  type: "propose_offline_settlement";
  creditorUserId: string;
  amountCents: number;
};

export type RespondOfflineSettlementAction = {
  type: "respond_offline_settlement";
  settlementId: string;
  decision: "confirmed" | "rejected";
};

export type AppAction =
  | CreateMarketAction
  | EditMarketAction
  | ReopenMarketAction
  | DeleteMarketAction
  | CreateOfferAction
  | CreateCounterofferAction
  | AcceptOfferAction
  | DeclineCounterofferAction
  | CancelOfferAction
  | ResolveMarketAction
  | UnresolveMarketAction
  | ProposeBetRevisionAction
  | RespondBetRevisionAction
  | CancelBetRevisionAction
  | RequestBetVoidAction
  | RespondBetVoidAction
  | CancelBetVoidAction
  | ProposeOfflineSettlementAction
  | RespondOfflineSettlementAction;
