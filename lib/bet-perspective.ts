import type { ParlayPosition } from "./contracts";

type BetSide = "maker" | "taker";

type PerspectiveLeg = {
  makerSelectionLabel: string;
  takerSelectionLabel: string;
};

type OfferPerspectiveInput = {
  makerName: string;
  makerPosition: ParlayPosition;
  legs: ReadonlyArray<PerspectiveLeg>;
};

type MatchedBetPerspectiveInput = OfferPerspectiveInput & {
  takerName: string;
  makerRiskCents: number;
  takerRiskCents: number;
  isParticipant: boolean;
  mySide: BetSide | null;
};

type SideDetails = {
  side: string;
  winRule: string;
};

export type ParticipantBetPerspective = {
  kind: "participant";
  title: "YOUR BET";
  sideLabel: "Your pick" | "Your position";
  side: string;
  winRule: string;
  opponentName: string;
  opponentSide: string;
  riskCents: number;
};

export type ObserverBetPerspective = {
  kind: "observer";
  title: "BET SIDES";
  maker: SideDetails & { name: string };
  taker: SideDetails & { name: string };
};

export type MatchedBetPerspective =
  | ParticipantBetPerspective
  | ObserverBetPerspective;

export function oppositePosition(
  position: ParlayPosition,
): ParlayPosition {
  return position === "back" ? "fade" : "back";
}

export function positionLabel(
  position: ParlayPosition,
): "Back" | "Fade" {
  return position === "back" ? "Back" : "Fade";
}

function sidePosition(
  makerPosition: ParlayPosition,
  side: BetSide,
): ParlayPosition {
  return side === "maker"
    ? makerPosition
    : oppositePosition(makerPosition);
}

function sideSelection(leg: PerspectiveLeg, side: BetSide): string {
  return side === "maker"
    ? leg.makerSelectionLabel
    : leg.takerSelectionLabel;
}

function sideLabel(
  legs: ReadonlyArray<PerspectiveLeg>,
  makerPosition: ParlayPosition,
  side: BetSide,
): string {
  const firstLeg = legs[0];
  if (legs.length === 1 && firstLeg) {
    return sideSelection(firstLeg, side);
  }
  return positionLabel(sidePosition(makerPosition, side));
}

function winningRule(
  subject: string,
  legs: ReadonlyArray<PerspectiveLeg>,
  makerPosition: ParlayPosition,
  side: BetSide,
): string {
  const firstLeg = legs[0];
  if (legs.length === 1 && firstLeg) {
    const selection = sideSelection(firstLeg, side);
    return subject === "You"
      ? `You win if the market resolves to “${selection}”.`
      : `${subject} ${subject === "They" ? "win" : "wins"} if the market resolves to “${selection}”.`;
  }
  return parlayWinningRuleForSubject(
    subject,
    sidePosition(makerPosition, side),
  );
}

function parlayWinningRuleForSubject(
  subject: string,
  position: ParlayPosition,
): string {
  if (subject === "You") {
    return position === "back"
      ? "You win only if every non-void listed pick hits."
      : "You win if any listed pick misses.";
  }
  const wins = subject === "They" ? "win" : "wins";
  return position === "back"
    ? `${subject} ${wins} only if every non-void listed pick hits.`
    : `${subject} ${wins} if any listed pick misses.`;
}

export function offerSideDetails(
  offer: OfferPerspectiveInput,
  acceptorSubject = "You",
): {
  maker: SideDetails;
  acceptor: SideDetails;
} {
  return {
    maker: {
      side: sideLabel(offer.legs, offer.makerPosition, "maker"),
      winRule: winningRule(
        offer.makerName,
        offer.legs,
        offer.makerPosition,
        "maker",
      ),
    },
    acceptor: {
      side: sideLabel(offer.legs, offer.makerPosition, "taker"),
      winRule: winningRule(
        acceptorSubject,
        offer.legs,
        offer.makerPosition,
        "taker",
      ),
    },
  };
}

export function offerAcceptancePerspective(
  offer: OfferPerspectiveInput,
): SideDetails & { actionLabel: string } {
  const acceptor = offerSideDetails(offer).acceptor;
  return {
    ...acceptor,
    actionLabel:
      offer.legs.length === 1
        ? `Accept · ${acceptor.side}`
        : `Accept · ${acceptor.side} this parlay`,
  };
}

export function matchedBetPerspective(
  bet: MatchedBetPerspectiveInput,
): MatchedBetPerspective {
  if (!bet.isParticipant || bet.mySide === null) {
    return {
      kind: "observer",
      title: "BET SIDES",
      maker: {
        name: bet.makerName,
        side: sideLabel(bet.legs, bet.makerPosition, "maker"),
        winRule: winningRule(
          bet.makerName,
          bet.legs,
          bet.makerPosition,
          "maker",
        ),
      },
      taker: {
        name: bet.takerName,
        side: sideLabel(bet.legs, bet.makerPosition, "taker"),
        winRule: winningRule(
          bet.takerName,
          bet.legs,
          bet.makerPosition,
          "taker",
        ),
      },
    };
  }

  const opponentSide = bet.mySide === "maker" ? "taker" : "maker";
  return {
    kind: "participant",
    title: "YOUR BET",
    sideLabel: bet.legs.length === 1 ? "Your pick" : "Your position",
    side: sideLabel(bet.legs, bet.makerPosition, bet.mySide),
    winRule: winningRule("You", bet.legs, bet.makerPosition, bet.mySide),
    opponentName:
      bet.mySide === "maker" ? bet.takerName : bet.makerName,
    opponentSide: sideLabel(
      bet.legs,
      bet.makerPosition,
      opponentSide,
    ),
    riskCents:
      bet.mySide === "maker"
        ? bet.makerRiskCents
        : bet.takerRiskCents,
  };
}

export function parlayWinningRule(
  makerName: string,
  takerName: string,
  makerPosition: ParlayPosition,
): string {
  return `${parlayWinningRuleForSubject(makerName, makerPosition)} ${parlayWinningRuleForSubject(takerName, oppositePosition(makerPosition))}`;
}
