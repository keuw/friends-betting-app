import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:net";
import { fileURLToPath } from "node:url";
import test from "node:test";

const root = fileURLToPath(new URL("../", import.meta.url));
const vinextCli = fileURLToPath(
  new URL("../node_modules/vinext/dist/cli.js", import.meta.url),
);
const adminEmail = "phase25-admin@local.sidebet";

test(
  "admins unresolve final revisions and reconcile bets, debts, and payments",
  { timeout: 120_000 },
  async () => {
    const port = await availablePort();
    const server = startDevServer(port);
    const baseUrl = `http://localhost:${port}`;

    try {
      await waitForServer(baseUrl, server);
      const stamp = `${Date.now()}-${process.pid}`;
      const admin = { email: adminEmail, name: "Phase 25 Admin" };
      const observer = user("Unresolve Observer", stamp);

      const accountingMaker = user("Accounting Maker", stamp);
      const accountingTaker = user("Accounting Taker", stamp);
      const accountingMarket = await createMarket(
        baseUrl,
        accountingMaker,
        `Accounting correction ${stamp}`,
      );
      const firstAccountingBet = await createMatchedBet(
        baseUrl,
        accountingMaker,
        accountingTaker,
        [accountingMarket],
      );
      const secondAccountingBet = await createMatchedBet(
        baseUrl,
        accountingMaker,
        accountingTaker,
        [accountingMarket],
        "back",
        [firstAccountingBet.id],
      );
      await createOffer(
        baseUrl,
        accountingMaker,
        [accountingMarket],
      );

      const accountingResolution = await resolve(
        baseUrl,
        accountingMaker,
        accountingMarket,
        "a",
      );
      assert.equal(accountingResolution.status, 200);
      assert.equal(
        betById(accountingResolution.payload, firstAccountingBet.id).status,
        "maker_won",
      );
      assert.equal(
        betById(accountingResolution.payload, secondAccountingBet.id).status,
        "maker_won",
      );
      assert.equal(
        marketById(accountingResolution.payload, accountingMarket.id)
          .activeOfferReferenceCount,
        0,
      );
      const originalBalance = pairBalance(
        accountingResolution.payload,
        accountingTaker.name,
        accountingMaker.name,
      );
      assert.equal(originalBalance?.amountCents, 2_400);

      const creatorReversal = await unresolve(
        baseUrl,
        accountingMaker,
        accountingMarket,
        "The creator should not have reversal authority.",
      );
      assert.equal(creatorReversal.status, 403);
      assert.equal(creatorReversal.payload.error?.code, "ADMIN_REQUIRED");

      const observerState = await getState(baseUrl, observer);
      assert.equal(
        currentRevision(marketById(observerState, accountingMarket.id))
          .canUnresolve,
        false,
      );
      const adminState = await getState(baseUrl, admin);
      assert.equal(
        currentRevision(marketById(adminState, accountingMarket.id))
          .canUnresolve,
        true,
      );

      const confirmedProposal = await postAction(baseUrl, accountingTaker, {
        type: "propose_offline_settlement",
        creditorUserId: originalBalance.creditorUserId,
        amountCents: 1_200,
      });
      assert.equal(confirmedProposal.status, 200);
      const confirmedSettlement = settlementFor(
        confirmedProposal.payload,
        accountingTaker.name,
        accountingMaker.name,
        "pending",
      );
      assert.ok(confirmedSettlement);
      const confirmedResponse = await postAction(baseUrl, accountingMaker, {
        type: "respond_offline_settlement",
        settlementId: confirmedSettlement.id,
        decision: "confirmed",
      });
      assert.equal(confirmedResponse.status, 200);

      const pendingProposal = await postAction(baseUrl, accountingTaker, {
        type: "propose_offline_settlement",
        creditorUserId: originalBalance.creditorUserId,
        amountCents: 600,
      });
      assert.equal(pendingProposal.status, 200);
      const pendingSettlement = settlementFor(
        pendingProposal.payload,
        accountingTaker.name,
        accountingMaker.name,
        "pending",
      );
      assert.ok(pendingSettlement);

      const correctionReason = "The original result came from the wrong source.";
      const accountingUnresolve = await unresolve(
        baseUrl,
        admin,
        accountingMarket,
        correctionReason,
      );
      assert.equal(accountingUnresolve.status, 200);
      const correctedMarket = marketById(
        accountingUnresolve.payload,
        accountingMarket.id,
      );
      assert.equal(correctedMarket.status, "open");
      assert.equal(correctedMarket.winningSelection, null);
      assert.equal(correctedMarket.closesAt, accountingMarket.closesAt);
      assert.equal(currentRevision(correctedMarket).status, "open");
      assert.equal(currentRevision(correctedMarket).canUnresolve, false);
      assert.equal(currentRevision(correctedMarket).canResolve, true);
      assert.equal(
        betById(accountingUnresolve.payload, firstAccountingBet.id).status,
        "pending",
      );
      assert.equal(
        betById(accountingUnresolve.payload, secondAccountingBet.id).status,
        "pending",
      );
      assert.equal(correctedMarket.activeOfferReferenceCount, 0);
      assert.ok(correctedMarket.offerReferenceCount >= 3);
      assert.equal(
        accountingUnresolve.payload.settlements.find(
          (settlement) => settlement.id === confirmedSettlement.id,
        )?.status,
        "confirmed",
      );
      assert.equal(
        accountingUnresolve.payload.settlements.find(
          (settlement) => settlement.id === pendingSettlement.id,
        )?.status,
        "cancelled",
      );
      assert.equal(
        pairBalance(
          accountingUnresolve.payload,
          accountingMaker.name,
          accountingTaker.name,
        )?.amountCents,
        1_200,
      );
      const correctionEvent = accountingUnresolve.payload.activity.find(
        (event) =>
          event.action === "unresolved_market_revision" &&
          event.entityId === accountingMarket.currentRevisionId,
      );
      assert.ok(correctionEvent);
      assert.equal(correctionEvent.actorName, admin.name);
      assert.equal(correctionEvent.metadata.reason, correctionReason);
      assert.equal(correctionEvent.metadata.previousStatus, "resolved");
      assert.equal(correctionEvent.metadata.previousResult, "a");

      const duplicateCorrection = await unresolve(
        baseUrl,
        admin,
        accountingMarket,
        "This stale duplicate must not change anything.",
      );
      assert.equal(duplicateCorrection.status, 409);
      assert.equal(
        duplicateCorrection.payload.error?.code,
        "MARKET_UNRESOLVE_STALE",
      );

      const correctedResolution = await resolve(
        baseUrl,
        accountingMaker,
        accountingMarket,
        "a",
      );
      assert.equal(correctedResolution.status, 200);
      assert.equal(
        pairBalance(
          correctedResolution.payload,
          accountingTaker.name,
          accountingMaker.name,
        )?.amountCents,
        1_200,
      );

      const historicalMaker = user("Historical Maker", stamp);
      const historicalTaker = user("Historical Taker", stamp);
      const historicalMarket = await createMarket(
        baseUrl,
        historicalMaker,
        `Historical correction ${stamp}`,
      );
      const historicalBet = await createMatchedBet(
        baseUrl,
        historicalMaker,
        historicalTaker,
        [historicalMarket],
      );
      const editedHistorical = await postAction(baseUrl, historicalMaker, {
        type: "edit_market",
        marketId: historicalMarket.id,
        baseRevisionId: historicalMarket.currentRevisionId,
        question: `Historical correction clarified ${stamp}`,
        description: historicalMarket.description,
        selectionA: historicalMarket.selectionA,
        selectionB: historicalMarket.selectionB,
        closesAt: "2040-01-01T00:00:00.000Z",
        changeNote: "Clarified the market after the bet matched",
      });
      assert.equal(editedHistorical.status, 200);
      const historicalCurrent = marketById(
        editedHistorical.payload,
        historicalMarket.id,
      );
      assert.notEqual(
        historicalCurrent.currentRevisionId,
        historicalMarket.currentRevisionId,
      );
      const historicalResolution = await postAction(baseUrl, historicalMaker, {
        type: "resolve_market",
        marketId: historicalMarket.id,
        marketRevisionId: historicalMarket.currentRevisionId,
        result: "a",
      });
      assert.equal(historicalResolution.status, 200);
      assert.equal(
        betById(historicalResolution.payload, historicalBet.id).status,
        "maker_won",
      );
      const historicalUnresolve = await postAction(baseUrl, admin, {
        type: "unresolve_market",
        marketId: historicalMarket.id,
        marketRevisionId: historicalMarket.currentRevisionId,
        reason: "The old market revision used an incorrect result.",
      });
      assert.equal(historicalUnresolve.status, 200);
      const historicalAfter = marketById(
        historicalUnresolve.payload,
        historicalMarket.id,
      );
      assert.equal(
        historicalAfter.currentRevisionId,
        historicalCurrent.currentRevisionId,
      );
      assert.equal(historicalAfter.status, "open");
      assert.equal(
        revisionById(historicalAfter, historicalMarket.currentRevisionId)
          .status,
        "open",
      );
      assert.equal(
        betById(historicalUnresolve.payload, historicalBet.id).status,
        "pending",
      );

      const parlayMaker = user("Parlay Correction Maker", stamp);
      const backTaker = user("Parlay Back Taker", stamp);
      const fadeTaker = user("Parlay Fade Taker", stamp);
      const parlayTarget = await createMarket(
        baseUrl,
        parlayMaker,
        `Parlay target ${stamp}`,
      );
      const parlayCompanion = await createMarket(
        baseUrl,
        parlayMaker,
        `Parlay companion ${stamp}`,
      );
      const backBet = await createMatchedBet(
        baseUrl,
        parlayMaker,
        backTaker,
        [parlayTarget, parlayCompanion],
      );
      const fadeBet = await createMatchedBet(
        baseUrl,
        parlayMaker,
        fadeTaker,
        [parlayTarget, parlayCompanion],
        "fade",
      );
      const parlayResolution = await resolve(
        baseUrl,
        parlayMaker,
        parlayTarget,
        "b",
      );
      assert.equal(parlayResolution.status, 200);
      assert.equal(betById(parlayResolution.payload, backBet.id).status, "taker_won");
      assert.equal(betById(parlayResolution.payload, fadeBet.id).status, "maker_won");
      const parlayUnresolve = await unresolve(
        baseUrl,
        admin,
        parlayTarget,
        "The target leg needs another review.",
      );
      assert.equal(parlayUnresolve.status, 200);
      assert.equal(betById(parlayUnresolve.payload, backBet.id).status, "pending");
      assert.equal(betById(parlayUnresolve.payload, fadeBet.id).status, "pending");
      assert.equal(
        pairBalance(parlayUnresolve.payload, parlayMaker.name, backTaker.name),
        undefined,
      );
      assert.equal(
        pairBalance(parlayUnresolve.payload, fadeTaker.name, parlayMaker.name),
        undefined,
      );

      const decisiveMaker = user("Decisive Parlay Maker", stamp);
      const decisiveTaker = user("Decisive Parlay Taker", stamp);
      const decisiveTarget = await createMarket(
        baseUrl,
        decisiveMaker,
        `Decisive target ${stamp}`,
      );
      const decisiveOther = await createMarket(
        baseUrl,
        decisiveMaker,
        `Decisive other ${stamp}`,
      );
      const decisiveBet = await createMatchedBet(
        baseUrl,
        decisiveMaker,
        decisiveTaker,
        [decisiveTarget, decisiveOther],
      );
      assert.equal(
        (await resolve(baseUrl, decisiveMaker, decisiveTarget, "a")).status,
        200,
      );
      const decisiveResolution = await resolve(
        baseUrl,
        decisiveMaker,
        decisiveOther,
        "b",
      );
      assert.equal(decisiveResolution.status, 200);
      assert.equal(
        betById(decisiveResolution.payload, decisiveBet.id).status,
        "taker_won",
      );
      const decisiveUnresolve = await unresolve(
        baseUrl,
        admin,
        decisiveTarget,
        "The first leg needs review but the other leg is decisive.",
      );
      assert.equal(decisiveUnresolve.status, 200);
      assert.equal(
        betById(decisiveUnresolve.payload, decisiveBet.id).status,
        "taker_won",
      );
      assert.equal(
        pairBalance(
          decisiveUnresolve.payload,
          decisiveMaker.name,
          decisiveTaker.name,
        )?.amountCents,
        1_000,
      );

      const mutualMaker = user("Mutual Void Maker", stamp);
      const mutualTaker = user("Mutual Void Taker", stamp);
      const mutualMarket = await createMarket(
        baseUrl,
        mutualMaker,
        `Mutual void protection ${stamp}`,
      );
      const mutualBet = await createMatchedBet(
        baseUrl,
        mutualMaker,
        mutualTaker,
        [mutualMarket],
      );
      const voidRequestResponse = await postAction(baseUrl, mutualMaker, {
        type: "request_bet_void",
        betId: mutualBet.id,
        reason: "Both friends want to cancel this matched bet.",
      });
      assert.equal(voidRequestResponse.status, 200);
      const mutualRequest = betById(
        voidRequestResponse.payload,
        mutualBet.id,
      ).voidRequests.find((request) => request.status === "pending");
      assert.ok(mutualRequest);
      const mutualAcceptance = await postAction(baseUrl, mutualTaker, {
        type: "respond_bet_void",
        betVoidRequestId: mutualRequest.id,
        decision: "accepted",
      });
      assert.equal(mutualAcceptance.status, 200);
      assert.equal(betById(mutualAcceptance.payload, mutualBet.id).status, "void");
      assert.equal(
        (await resolve(baseUrl, mutualMaker, mutualMarket, "a")).status,
        200,
      );
      const mutualUnresolve = await unresolve(
        baseUrl,
        admin,
        mutualMarket,
        "Correct the market without undoing the friends' agreement.",
      );
      assert.equal(mutualUnresolve.status, 200);
      assert.equal(betById(mutualUnresolve.payload, mutualBet.id).status, "void");
      assert.equal(
        betById(mutualUnresolve.payload, mutualBet.id).voidRequests.find(
          (request) => request.id === mutualRequest.id,
        )?.status,
        "accepted",
      );

      const allVoidMaker = user("All Void Maker", stamp);
      const allVoidTaker = user("All Void Taker", stamp);
      const voidTarget = await createMarket(
        baseUrl,
        allVoidMaker,
        `Void target ${stamp}`,
      );
      const voidOther = await createMarket(
        baseUrl,
        allVoidMaker,
        `Void other ${stamp}`,
      );
      const allVoidBet = await createMatchedBet(
        baseUrl,
        allVoidMaker,
        allVoidTaker,
        [voidTarget, voidOther],
      );
      assert.equal((await resolve(baseUrl, allVoidMaker, voidTarget, "void")).status, 200);
      const allVoidResolution = await resolve(
        baseUrl,
        allVoidMaker,
        voidOther,
        "void",
      );
      assert.equal(allVoidResolution.status, 200);
      assert.equal(betById(allVoidResolution.payload, allVoidBet.id).status, "void");
      const allVoidUnresolve = await unresolve(
        baseUrl,
        admin,
        voidTarget,
        "One voided leg should return to unresolved.",
      );
      assert.equal(allVoidUnresolve.status, 200);
      assert.equal(marketById(allVoidUnresolve.payload, voidTarget.id).status, "open");
      assert.equal(betById(allVoidUnresolve.payload, allVoidBet.id).status, "pending");

      const raceMaker = user("Unresolve Race Maker", stamp);
      const raceTaker = user("Unresolve Race Taker", stamp);
      const raceMarket = await createMarket(
        baseUrl,
        raceMaker,
        `Unresolve race ${stamp}`,
      );
      const raceBet = await createMatchedBet(
        baseUrl,
        raceMaker,
        raceTaker,
        [raceMarket],
      );
      assert.equal((await resolve(baseUrl, raceMaker, raceMarket, "a")).status, 200);
      const duplicateRace = await Promise.all([
        unresolve(baseUrl, admin, raceMarket, "First concurrent correction."),
        unresolve(baseUrl, admin, raceMarket, "Second concurrent correction."),
      ]);
      assert.deepEqual(
        duplicateRace.map((response) => response.status).sort(),
        [200, 409],
      );
      assert.equal(
        duplicateRace.find((response) => response.status === 409)?.payload.error
          ?.code,
        "MARKET_UNRESOLVE_STALE",
      );
      const duplicateRaceState = await getState(baseUrl, admin);
      assert.equal(betById(duplicateRaceState, raceBet.id).status, "pending");
      assert.equal(
        revisionById(
          marketById(duplicateRaceState, raceMarket.id),
          raceMarket.currentRevisionId,
        ).resolutionEvents.filter((event) => event.action === "unresolved")
          .length,
        1,
      );

      assert.equal((await resolve(baseUrl, raceMaker, raceMarket, "a")).status, 200);
      const [raceUnresolve, raceResolve] = await Promise.all([
        unresolve(
          baseUrl,
          admin,
          raceMarket,
          "Race a correction against another resolution.",
        ),
        resolve(baseUrl, raceMaker, raceMarket, "a"),
      ]);
      assert.equal(raceUnresolve.status, 200);
      assert.ok([200, 409].includes(raceResolve.status));
      const finalRaceState = await getState(baseUrl, admin);
      const finalRaceMarket = marketById(finalRaceState, raceMarket.id);
      const finalRaceBet = betById(finalRaceState, raceBet.id);
      if (finalRaceMarket.status === "open") {
        assert.equal(finalRaceBet.status, "pending");
        assert.equal(
          pairBalance(finalRaceState, raceTaker.name, raceMaker.name),
          undefined,
        );
      } else {
        assert.equal(finalRaceMarket.status, "resolved");
        assert.equal(finalRaceBet.status, "maker_won");
        assert.equal(
          pairBalance(finalRaceState, raceTaker.name, raceMaker.name)
            ?.amountCents,
          1_200,
        );
      }
    } finally {
      await stopDevServer(server);
    }
  },
);

function user(prefix, stamp) {
  const slug = prefix.toLowerCase().replaceAll(" ", "-");
  return {
    email: `${slug}-${stamp}@local.sidebet`,
    name: `${prefix} ${stamp}`,
  };
}

async function createMarket(baseUrl, creator, question) {
  const response = await postAction(baseUrl, creator, {
    type: "create_market",
    question,
    description: "Admin market-unresolve integration test",
    selectionA: "Yes",
    selectionB: "No",
    closesAt: "2039-01-01T00:00:00.000Z",
  });
  assert.equal(response.status, 200);
  const market = response.payload.markets.find(
    (candidate) => candidate.question === question,
  );
  assert.ok(market);
  return market;
}

async function createOffer(baseUrl, maker, markets, makerPosition = "back") {
  const response = await postAction(baseUrl, maker, {
    type: "create_offer",
    makerRiskCents: 1_000,
    takerRiskCents: 1_200,
    makerPosition,
    legs: markets.map(leg),
  });
  assert.equal(response.status, 200);
  const offer = response.payload.offers.find(
    (candidate) =>
      candidate.status === "open" &&
      candidate.makerName === maker.name &&
      candidate.makerPosition === makerPosition &&
      markets.every((market) =>
        candidate.legs.some((item) => item.marketId === market.id),
      ),
  );
  assert.ok(offer);
  return offer;
}

async function createMatchedBet(
  baseUrl,
  maker,
  taker,
  markets,
  makerPosition = "back",
  excludedBetIds = [],
) {
  const offer = await createOffer(
    baseUrl,
    maker,
    markets,
    makerPosition,
  );
  const response = await postAction(baseUrl, taker, {
    type: "accept_offer",
    offerId: offer.id,
  });
  assert.equal(response.status, 200);
  const bet = response.payload.bets.find(
    (candidate) =>
      !excludedBetIds.includes(candidate.id) &&
      candidate.makerName === maker.name &&
      candidate.takerName === taker.name &&
      candidate.makerPosition === makerPosition &&
      markets.every((market) =>
        candidate.legs.some((item) => item.marketId === market.id),
      ),
  );
  assert.ok(bet);
  return bet;
}

function leg(market) {
  return {
    marketId: market.id,
    marketRevisionId: market.currentRevisionId,
    selection: "a",
  };
}

function resolve(baseUrl, actor, market, result) {
  return postAction(baseUrl, actor, {
    type: "resolve_market",
    marketId: market.id,
    marketRevisionId: market.currentRevisionId,
    result,
  });
}

function unresolve(baseUrl, actor, market, reason) {
  return postAction(baseUrl, actor, {
    type: "unresolve_market",
    marketId: market.id,
    marketRevisionId: market.currentRevisionId,
    reason,
  });
}

async function postAction(baseUrl, actor, body) {
  const response = await fetch(`${baseUrl}/api/actions`, {
    method: "POST",
    headers: identityHeaders(actor),
    body: JSON.stringify(body),
  });
  return { status: response.status, payload: await response.json() };
}

async function getState(baseUrl, actor) {
  const response = await fetch(`${baseUrl}/api/state`, {
    headers: identityHeaders(actor, false),
  });
  assert.equal(response.status, 200);
  return response.json();
}

function identityHeaders(actor, includeContentType = true) {
  return {
    ...(includeContentType ? { "content-type": "application/json" } : {}),
    "oai-authenticated-user-email": actor.email,
    "oai-authenticated-user-full-name": encodeURIComponent(actor.name),
    "oai-authenticated-user-full-name-encoding": "percent-encoded-utf-8",
  };
}

function marketById(state, marketId) {
  const market = state.markets.find((candidate) => candidate.id === marketId);
  assert.ok(market);
  return market;
}

function revisionById(market, revisionId) {
  const revision = market.revisions.find(
    (candidate) => candidate.id === revisionId,
  );
  assert.ok(revision);
  return revision;
}

function currentRevision(market) {
  const revision = market.revisions.find((candidate) => candidate.isCurrent);
  assert.ok(revision);
  return revision;
}

function betById(state, betId) {
  const bet = state.bets.find((candidate) => candidate.id === betId);
  assert.ok(bet);
  return bet;
}

function pairBalance(state, debtorName, creditorName) {
  return state.pairBalances.find(
    (balance) =>
      balance.debtorName === debtorName &&
      balance.creditorName === creditorName,
  );
}

function settlementFor(state, debtorName, creditorName, status) {
  return state.settlements.find(
    (settlement) =>
      settlement.debtorName === debtorName &&
      settlement.creditorName === creditorName &&
      settlement.status === status,
  );
}

async function availablePort() {
  const server = createServer();
  server.unref();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const { port } = address;
  await new Promise((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
  return port;
}

function startDevServer(port) {
  const child = spawn(
    process.execPath,
    [vinextCli, "dev", "--port", String(port)],
    {
      cwd: root,
      detached: process.platform !== "win32",
      env: {
        ...process.env,
        ADMIN_EMAILS: adminEmail,
        WRANGLER_LOG_PATH: ".wrangler/admin-unresolve-integration.log",
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  child.output = "";
  for (const stream of [child.stdout, child.stderr]) {
    stream.setEncoding("utf8");
    stream.on("data", (chunk) => {
      child.output = `${child.output}${chunk}`.slice(-8_000);
    });
  }
  return child;
}

async function waitForServer(baseUrl, server) {
  const deadline = Date.now() + 30_000;
  let lastAttempt = "No request completed.";
  while (Date.now() < deadline) {
    if (server.exitCode !== null) {
      throw new Error(`Vinext exited before startup:\n${server.output}`);
    }
    try {
      const response = await fetch(`${baseUrl}/api/state`, {
        headers: identityHeaders(
          {
            email: "readiness-unresolve@local.sidebet",
            name: "Readiness Unresolve",
          },
          false,
        ),
      });
      if (response.ok) return;
      lastAttempt = `HTTP ${response.status}: ${(await response.text()).slice(0, 500)}`;
    } catch (error) {
      lastAttempt = error instanceof Error ? error.message : String(error);
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(
    `Timed out waiting for Vinext. Last attempt: ${lastAttempt}\n${server.output}`,
  );
}

async function stopDevServer(server) {
  if (server.exitCode !== null) return;
  try {
    if (process.platform === "win32") server.kill("SIGINT");
    else process.kill(-server.pid, "SIGINT");
  } catch {
    server.kill("SIGINT");
  }
  await Promise.race([
    once(server, "exit"),
    new Promise((resolve) => setTimeout(resolve, 5_000)),
  ]);
  if (server.exitCode === null) {
    try {
      if (process.platform === "win32") server.kill("SIGKILL");
      else process.kill(-server.pid, "SIGKILL");
    } catch {
      server.kill("SIGKILL");
    }
  }
}
