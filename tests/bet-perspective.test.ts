import assert from "node:assert/strict";
import test from "node:test";
import {
  matchedBetPerspective,
  offerAcceptancePerspective,
  offerSideDetails,
} from "../lib/bet-perspective";

const straightLeg = {
  makerSelectionLabel: "Lakers win",
  takerSelectionLabel: "Celtics win",
};

const parlayLegs = [
  {
    makerSelectionLabel: "Lakers win",
    takerSelectionLabel: "Celtics win",
  },
  {
    makerSelectionLabel: "Over 215.5",
    takerSelectionLabel: "Under 215.5",
  },
];

test("straight offers name the exact outcome an accepting friend takes", () => {
  const sides = offerSideDetails({
    makerName: "Alice",
    makerPosition: "back",
    legs: [straightLeg],
  });
  const accepting = offerAcceptancePerspective({
    makerName: "Alice",
    makerPosition: "back",
    legs: [straightLeg],
  });

  assert.deepEqual(sides, {
    maker: {
      side: "Lakers win",
      winRule: "Alice wins if the market resolves to “Lakers win”.",
    },
    acceptor: {
      side: "Celtics win",
      winRule: "You win if the market resolves to “Celtics win”.",
    },
  });
  assert.deepEqual(accepting, {
    side: "Celtics win",
    winRule: "You win if the market resolves to “Celtics win”.",
    actionLabel: "Accept · Celtics win",
  });
  assert.equal(
    offerSideDetails(
      {
        makerName: "Alice",
        makerPosition: "back",
        legs: [straightLeg],
      },
      "They",
    ).acceptor.winRule,
    "They win if the market resolves to “Celtics win”.",
  );
});

test("parlay offers describe Back and Fade as complementary positions", () => {
  const backOffer = offerAcceptancePerspective({
    makerName: "Alice",
    makerPosition: "back",
    legs: parlayLegs,
  });
  const fadeOffer = offerAcceptancePerspective({
    makerName: "Alice",
    makerPosition: "fade",
    legs: parlayLegs,
  });

  assert.deepEqual(backOffer, {
    side: "Fade",
    winRule: "You win if any listed pick misses.",
    actionLabel: "Accept · Fade this parlay",
  });
  assert.deepEqual(fadeOffer, {
    side: "Back",
    winRule: "You win only if every non-void listed pick hits.",
    actionLabel: "Accept · Back this parlay",
  });
});

test("matched straight bets personalize maker and taker outcomes", () => {
  const maker = matchedBetPerspective({
    makerName: "Alice",
    takerName: "Bob",
    makerPosition: "back",
    makerRiskCents: 1_000,
    takerRiskCents: 1_500,
    isParticipant: true,
    mySide: "maker",
    legs: [straightLeg],
  });
  const taker = matchedBetPerspective({
    makerName: "Alice",
    takerName: "Bob",
    makerPosition: "back",
    makerRiskCents: 1_000,
    takerRiskCents: 1_500,
    isParticipant: true,
    mySide: "taker",
    legs: [straightLeg],
  });

  assert.equal(maker.kind, "participant");
  assert.equal(maker.sideLabel, "Your pick");
  assert.equal(maker.side, "Lakers win");
  assert.equal(maker.winRule, "You win if the market resolves to “Lakers win”.");
  assert.equal(maker.opponentSide, "Celtics win");
  assert.equal(maker.riskCents, 1_000);

  assert.equal(taker.kind, "participant");
  assert.equal(taker.side, "Celtics win");
  assert.equal(taker.winRule, "You win if the market resolves to “Celtics win”.");
  assert.equal(taker.opponentSide, "Lakers win");
  assert.equal(taker.riskCents, 1_500);
});

test("matched parlays personalize Back and Fade winning rules", () => {
  const maker = matchedBetPerspective({
    makerName: "Alice",
    takerName: "Bob",
    makerPosition: "fade",
    makerRiskCents: 1_000,
    takerRiskCents: 1_500,
    isParticipant: true,
    mySide: "maker",
    legs: parlayLegs,
  });
  const taker = matchedBetPerspective({
    makerName: "Alice",
    takerName: "Bob",
    makerPosition: "fade",
    makerRiskCents: 1_000,
    takerRiskCents: 1_500,
    isParticipant: true,
    mySide: "taker",
    legs: parlayLegs,
  });

  assert.equal(maker.kind, "participant");
  assert.equal(taker.kind, "participant");
  assert.equal(maker.sideLabel, "Your position");
  assert.equal(maker.side, "Fade");
  assert.equal(maker.winRule, "You win if any listed pick misses.");
  assert.equal(taker.side, "Back");
  assert.equal(
    taker.winRule,
    "You win only if every non-void listed pick hits.",
  );
});

test("matched-bet observers receive neutral named sides", () => {
  const observer = matchedBetPerspective({
    makerName: "Alice",
    takerName: "Bob",
    makerPosition: "back",
    makerRiskCents: 1_000,
    takerRiskCents: 1_500,
    isParticipant: false,
    mySide: null,
    legs: parlayLegs,
  });

  assert.deepEqual(observer, {
    kind: "observer",
    title: "BET SIDES",
    maker: {
      name: "Alice",
      side: "Back",
      winRule: "Alice wins only if every non-void listed pick hits.",
    },
    taker: {
      name: "Bob",
      side: "Fade",
      winRule: "Bob wins if any listed pick misses.",
    },
  });
});
