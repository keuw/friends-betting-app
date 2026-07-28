export type Selection = "a" | "b";
export type MarketStatus = "open" | "resolved" | "void";
export type OfferStatus = "open" | "accepted" | "cancelled" | "expired";
export type BetStatus = "pending" | "maker_won" | "taker_won" | "void";
export type SettlementStatus =
  | "pending"
  | "confirmed"
  | "rejected"
  | "cancelled";

export type Viewer = {
  id: string;
  displayName: string;
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
  createdAt: string;
};

export type OfferLegView = {
  marketId: string;
  marketQuestion: string;
  marketClosesAt: string;
  makerSelection: Selection;
  makerSelectionLabel: string;
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
  makerRiskCents: number;
  takerRiskCents: number;
  status: OfferStatus;
  createdAt: string;
  acceptedAt: string | null;
  isMine: boolean;
  legs: OfferLegView[];
  counters: CounterofferView[];
};

export type BetView = {
  id: string;
  makerName: string;
  takerName: string;
  makerRiskCents: number;
  takerRiskCents: number;
  status: BetStatus;
  acceptedAt: string;
  settledAt: string | null;
  isParticipant: boolean;
  mySide: "maker" | "taker" | null;
  legs: OfferLegView[];
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
  makerRiskCents: number;
  takerRiskCents: number;
  legs: Array<{ marketId: string; selection: Selection }>;
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

export type CancelOfferAction = {
  type: "cancel_offer";
  offerId: string;
};

export type ResolveMarketAction = {
  type: "resolve_market";
  marketId: string;
  result: Selection | "void";
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
  | CreateOfferAction
  | CreateCounterofferAction
  | AcceptOfferAction
  | CancelOfferAction
  | ResolveMarketAction
  | ProposeOfflineSettlementAction
  | RespondOfflineSettlementAction;
