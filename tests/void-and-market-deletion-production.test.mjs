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

test(
  "matched-bet voids and conservative market deletion are race-safe in D1",
  { timeout: 60_000 },
  async () => {
    const port = await availablePort();
    const server = startDevServer(port);
    const baseUrl = `http://localhost:${port}`;

    try {
      await waitForServer(baseUrl, server);
      const stamp = `${Date.now()}-${process.pid}`;
      const maker = user("Void Maker", stamp);
      const taker = user("Void Taker", stamp);
      const observer = user("Void Observer", stamp);

      const unused = await createMarket(
        baseUrl,
        maker,
        `Unused deletion ${stamp}`,
      );
      const observerDelete = await postAction(baseUrl, observer, {
        type: "delete_market",
        marketId: unused.id,
      });
      assert.equal(observerDelete.status, 403);
      assert.equal(observerDelete.payload.error?.code, "NOT_MARKET_ORACLE");

      const ownerView = marketFrom(await getState(baseUrl, maker), unused.id);
      assert.equal(ownerView.offerReferenceCount, 0);
      assert.equal(ownerView.betReferenceCount, 0);
      assert.equal(ownerView.canDelete, true);
      assert.equal(ownerView.deletionBlocker, null);

      const edit = await postAction(baseUrl, maker, {
        type: "edit_market",
        marketId: unused.id,
        baseRevisionId: unused.currentRevisionId,
        question: `${unused.question} edited`,
        description: "Still unused after a second revision",
        selectionA: "Yes",
        selectionB: "No",
        closesAt: "2035-01-02T00:00:00.000Z",
        changeNote: "Exercise multi-revision deletion",
      });
      assert.equal(edit.status, 200);
      const edited = marketFrom(edit.payload, unused.id);
      assert.equal(edited.revisions.length, 2);

      const deletion = await postAction(baseUrl, maker, {
        type: "delete_market",
        marketId: unused.id,
      });
      assert.equal(deletion.status, 200);
      assert.equal(
        deletion.payload.markets.some((market) => market.id === unused.id),
        false,
      );
      const receipt = deletion.payload.activity.find(
        (activity) =>
          activity.action === "deleted_market" &&
          activity.entityId === unused.id,
      );
      assert.ok(receipt);
      assert.equal(receipt.metadata.revisionCount, 2);
      assert.equal(receipt.metadata.question, `${unused.question} edited`);

      const repeatDelete = await postAction(baseUrl, maker, {
        type: "delete_market",
        marketId: unused.id,
      });
      assert.equal(repeatDelete.status, 404);

      const resolvedUnused = await createMarket(
        baseUrl,
        maker,
        `Resolved unused deletion ${stamp}`,
      );
      assert.equal(
        (
          await postAction(baseUrl, maker, {
            type: "resolve_market",
            marketId: resolvedUnused.id,
            marketRevisionId: resolvedUnused.currentRevisionId,
            result: "a",
          })
        ).status,
        200,
      );
      assert.equal(
        (
          await postAction(baseUrl, maker, {
            type: "delete_market",
            marketId: resolvedUnused.id,
          })
        ).status,
        200,
      );

      const offerMarket = await createMarket(
        baseUrl,
        maker,
        `Cancelled offer blocker ${stamp}`,
      );
      const offer = await createOffer(baseUrl, maker, offerMarket);
      assert.equal(
        (
          await postAction(baseUrl, maker, {
            type: "cancel_offer",
            offerId: offer.id,
          })
        ).status,
        200,
      );
      const blockedOfferMarket = marketFrom(
        await getState(baseUrl, maker),
        offerMarket.id,
      );
      assert.equal(blockedOfferMarket.offerReferenceCount, 1);
      assert.equal(blockedOfferMarket.canDelete, false);
      assert.match(blockedOfferMarket.deletionBlocker, /cancelled or expired/);
      const blockedOfferDelete = await postAction(baseUrl, maker, {
        type: "delete_market",
        marketId: offerMarket.id,
      });
      assert.equal(blockedOfferDelete.status, 409);
      assert.equal(
        blockedOfferDelete.payload.error?.code,
        "MARKET_REFERENCED",
      );

      const betMarket = await createMarket(
        baseUrl,
        maker,
        `Mutual void ${stamp}`,
      );
      const matchedOffer = await createOffer(baseUrl, maker, betMarket);
      const acceptance = await postAction(baseUrl, taker, {
        type: "accept_offer",
        offerId: matchedOffer.id,
      });
      assert.equal(acceptance.status, 200);
      const bet = betForMarket(acceptance.payload, betMarket.id);

      const observerRequest = await postAction(baseUrl, observer, {
        type: "request_bet_void",
        betId: bet.id,
        reason: "I should not be allowed to request this.",
      });
      assert.equal(observerRequest.status, 403);
      assert.equal(
        observerRequest.payload.error?.code,
        "NOT_BET_PARTICIPANT",
      );

      const firstRequestResponse = await postAction(baseUrl, maker, {
        type: "request_bet_void",
        betId: bet.id,
        reason: "The original terms were entered incorrectly.",
      });
      assert.equal(firstRequestResponse.status, 200);
      let currentBet = betById(firstRequestResponse.payload, bet.id);
      let voidRequest = currentBet.voidRequests.at(-1);
      assert.ok(voidRequest);
      assert.equal(voidRequest.status, "pending");
      assert.equal(voidRequest.canCancel, true);
      assert.equal(currentBet.canRequestVoid, false);

      const selfAccept = await postAction(baseUrl, maker, {
        type: "respond_bet_void",
        betVoidRequestId: voidRequest.id,
        decision: "accepted",
      });
      assert.equal(selfAccept.status, 403);

      const rejection = await postAction(baseUrl, taker, {
        type: "respond_bet_void",
        betVoidRequestId: voidRequest.id,
        decision: "rejected",
      });
      assert.equal(rejection.status, 200);
      currentBet = betById(rejection.payload, bet.id);
      assert.equal(currentBet.status, "pending");
      assert.equal(currentBet.voidRequests.at(-1)?.status, "rejected");
      assert.equal(currentBet.canRequestVoid, true);

      const cancelledRequestResponse = await postAction(baseUrl, maker, {
        type: "request_bet_void",
        betId: bet.id,
        reason: "We may want to cancel this matched bet.",
      });
      assert.equal(cancelledRequestResponse.status, 200);
      voidRequest = betById(cancelledRequestResponse.payload, bet.id)
        .voidRequests.at(-1);
      assert.ok(voidRequest);
      const cancellation = await postAction(baseUrl, maker, {
        type: "cancel_bet_void",
        betVoidRequestId: voidRequest.id,
      });
      assert.equal(cancellation.status, 200);
      assert.equal(
        betById(cancellation.payload, bet.id).voidRequests.at(-1)?.status,
        "cancelled",
      );

      const acceptedRequestResponse = await postAction(baseUrl, taker, {
        type: "request_bet_void",
        betId: bet.id,
        reason: "Both sides agree to erase this pending obligation.",
      });
      assert.equal(acceptedRequestResponse.status, 200);
      voidRequest = betById(acceptedRequestResponse.payload, bet.id)
        .voidRequests.at(-1);
      assert.ok(voidRequest);
      const acceptedVoid = await postAction(baseUrl, maker, {
        type: "respond_bet_void",
        betVoidRequestId: voidRequest.id,
        decision: "accepted",
      });
      assert.equal(acceptedVoid.status, 200);
      currentBet = betById(acceptedVoid.payload, bet.id);
      assert.equal(currentBet.status, "void");
      assert.equal(currentBet.voidRequests.at(-1)?.status, "accepted");
      assert.equal(currentBet.canRequestVoid, false);
      assert.equal(
        acceptedVoid.payload.pairBalances.some(
          (balance) =>
            balance.debtorName === maker.name ||
            balance.creditorName === maker.name ||
            balance.debtorName === taker.name ||
            balance.creditorName === taker.name,
        ),
        false,
      );
      assert.equal(
        (
          await postAction(baseUrl, maker, {
            type: "respond_bet_void",
            betVoidRequestId: voidRequest.id,
            decision: "accepted",
          })
        ).status,
        200,
      );
      const finalBetRequest = await postAction(baseUrl, maker, {
        type: "request_bet_void",
        betId: bet.id,
        reason: "A final bet cannot accept another request.",
      });
      assert.equal(finalBetRequest.status, 409);
      assert.equal(finalBetRequest.payload.error?.code, "BET_FINAL");

      const blockedBetMarket = marketFrom(
        await getState(baseUrl, maker),
        betMarket.id,
      );
      assert.equal(blockedBetMarket.offerReferenceCount, 1);
      assert.equal(blockedBetMarket.betReferenceCount, 1);
      assert.equal(blockedBetMarket.canDelete, false);

      const raceMarket = await createMarket(
        baseUrl,
        maker,
        `Revision void race ${stamp}`,
      );
      const raceOffer = await createOffer(baseUrl, maker, raceMarket);
      const raceAcceptance = await postAction(baseUrl, taker, {
        type: "accept_offer",
        offerId: raceOffer.id,
      });
      assert.equal(raceAcceptance.status, 200);
      const raceBet = betForMarket(raceAcceptance.payload, raceMarket.id);
      const revisionProposal = await postAction(baseUrl, maker, {
        type: "propose_bet_revision",
        betId: raceBet.id,
        makerRiskCents: 1_100,
        takerRiskCents: 1_300,
        changeNote: "Race a terms change against mutual void",
        legs: [leg(raceMarket)],
      });
      assert.equal(revisionProposal.status, 200);
      const pendingRevision = betById(
        revisionProposal.payload,
        raceBet.id,
      ).revisions.find((revision) => revision.status === "pending");
      assert.ok(pendingRevision);
      const raceVoidResponse = await postAction(baseUrl, maker, {
        type: "request_bet_void",
        betId: raceBet.id,
        reason: "Race this void request against the pending terms.",
      });
      assert.equal(raceVoidResponse.status, 200);
      const raceVoid = betById(raceVoidResponse.payload, raceBet.id)
        .voidRequests.at(-1);
      assert.ok(raceVoid);

      const raceResults = await Promise.all([
        postAction(baseUrl, taker, {
          type: "respond_bet_revision",
          betRevisionId: pendingRevision.id,
          decision: "accepted",
        }),
        postAction(baseUrl, taker, {
          type: "respond_bet_void",
          betVoidRequestId: raceVoid.id,
          decision: "accepted",
        }),
      ]);
      assert.deepEqual(
        raceResults.map((result) => result.status).sort(),
        [200, 409],
      );
      const raceFinal = betById(await getState(baseUrl, maker), raceBet.id);
      const finalVoid = raceFinal.voidRequests.find(
        (request) => request.id === raceVoid.id,
      );
      const finalRevision = raceFinal.revisions.find(
        (revision) => revision.id === pendingRevision.id,
      );
      if (raceFinal.status === "void") {
        assert.equal(finalVoid?.status, "accepted");
        assert.equal(finalRevision?.status, "superseded");
      } else {
        assert.equal(raceFinal.status, "pending");
        assert.equal(finalVoid?.status, "superseded");
        assert.equal(finalRevision?.status, "active");
      }

      const deletionRaceMarket = await createMarket(
        baseUrl,
        maker,
        `Offer deletion race ${stamp}`,
      );
      const deletionRace = await Promise.all([
        postAction(baseUrl, maker, {
          type: "create_offer",
          makerRiskCents: 1_000,
          takerRiskCents: 1_200,
          legs: [leg(deletionRaceMarket)],
        }),
        postAction(baseUrl, maker, {
          type: "delete_market",
          marketId: deletionRaceMarket.id,
        }),
      ]);
      assert.deepEqual(
        deletionRace.map((result) => result.status).sort(),
        [200, 409],
      );
      const deletionRaceState = await getState(baseUrl, maker);
      const remainingRaceMarket = deletionRaceState.markets.find(
        (market) => market.id === deletionRaceMarket.id,
      );
      if (remainingRaceMarket) {
        assert.equal(remainingRaceMarket.offerReferenceCount, 1);
      } else {
        assert.equal(
          deletionRaceState.offers.some((candidate) =>
            candidate.legs.some(
              (candidateLeg) =>
                candidateLeg.marketId === deletionRaceMarket.id,
            ),
          ),
          false,
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
    description: "Mutual void and deletion D1 integration test",
    selectionA: "Yes",
    selectionB: "No",
    closesAt: "2035-01-01T00:00:00.000Z",
  });
  assert.equal(response.status, 200);
  const market = response.payload.markets.find(
    (candidate) => candidate.question === question,
  );
  assert.ok(market);
  return market;
}

async function createOffer(baseUrl, maker, market) {
  const response = await postAction(baseUrl, maker, {
    type: "create_offer",
    makerRiskCents: 1_000,
    takerRiskCents: 1_200,
    legs: [leg(market)],
  });
  assert.equal(response.status, 200);
  const offer = response.payload.offers.find(
    (candidate) =>
      candidate.status === "open" &&
      candidate.legs.some((item) => item.marketId === market.id),
  );
  assert.ok(offer);
  return offer;
}

function leg(market) {
  return {
    marketId: market.id,
    marketRevisionId: market.currentRevisionId,
    selection: "a",
  };
}

async function postAction(baseUrl, actor, body) {
  const response = await fetch(`${baseUrl}/api/actions`, {
    method: "POST",
    headers: identityHeaders(actor),
    body: JSON.stringify(body),
  });
  return {
    status: response.status,
    payload: await response.json(),
  };
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

function marketFrom(state, marketId) {
  const market = state.markets.find((candidate) => candidate.id === marketId);
  assert.ok(market);
  return market;
}

function betForMarket(state, marketId) {
  const bet = state.bets.find((candidate) =>
    candidate.legs.some((item) => item.marketId === marketId),
  );
  assert.ok(bet);
  return bet;
}

function betById(state, betId) {
  const bet = state.bets.find((candidate) => candidate.id === betId);
  assert.ok(bet);
  return bet;
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
        WRANGLER_LOG_PATH: ".wrangler/void-deletion-integration.log",
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
            email: "readiness-void-delete@local.sidebet",
            name: "Readiness Void Delete",
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
