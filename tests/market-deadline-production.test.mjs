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
  "deadline extensions and closed-market reopening preserve offer history in D1",
  { timeout: 60_000 },
  async () => {
    const port = await availablePort();
    const server = startDevServer(port);
    const baseUrl = `http://localhost:${port}`;

    try {
      await waitForServer(baseUrl, server);
      const stamp = `${Date.now()}-${process.pid}`;
      const maker = user("Deadline Maker", stamp);
      const taker = user("Deadline Taker", stamp);
      const observer = user("Deadline Observer", stamp);

      const originalClose = "2031-01-01T00:00:00.000Z";
      const extendedClose = "2032-01-01T00:00:00.000Z";
      const market = await createMarket(
        baseUrl,
        maker,
        `Pure extension ${stamp}`,
        originalClose,
      );
      const offer = await createOffer(baseUrl, maker, [leg(market)]);
      const counterResponse = await postAction(baseUrl, taker, {
        type: "create_counteroffer",
        offerId: offer.id,
        makerRiskCents: 900,
        takerRiskCents: 1_300,
      });
      assert.equal(counterResponse.status, 200);

      const extension = await editMarket(baseUrl, maker, market, {
        closesAt: extendedClose,
        changeNote: "The event moved to the following season",
      });
      assert.equal(extension.status, 200);
      const extendedMarket = marketFrom(extension.payload, market.id);
      assert.equal(extendedMarket.revisionNumber, 2);
      assert.equal(extendedMarket.closesAt, extendedClose);

      const extendedOffer = offerFrom(extension.payload, offer.id);
      const extendedLeg = offerLeg(extendedOffer, market.id);
      assert.equal(extendedLeg.marketRevisionId, extendedMarket.currentRevisionId);
      assert.equal(extendedLeg.marketRevisionNumber, 2);
      assert.equal(extendedLeg.marketClosesAt, extendedClose);
      assert.equal(extendedLeg.originalMarketRevisionId, market.currentRevisionId);
      assert.equal(extendedLeg.originalMarketRevisionNumber, 1);
      assert.equal(extendedLeg.originalMarketClosesAt, originalClose);
      assert.equal(extendedOffer.expiresAt, extendedClose);
      assert.equal(extendedOffer.counters.at(-1)?.status, "pending");
      assert.equal(
        extension.payload.activity.some(
          (event) =>
            event.action === "extended_market_deadline" &&
            event.entityId === extendedMarket.currentRevisionId &&
            event.metadata.affectedOfferCount === 1,
        ),
        true,
      );

      const termOffer = await createOffer(baseUrl, maker, [
        leg(extendedMarket),
      ]);
      const changedTerms = await editMarket(
        baseUrl,
        maker,
        extendedMarket,
        {
          question: `${extendedMarket.question} clarified`,
          closesAt: "2033-01-01T00:00:00.000Z",
          changeNote: "Clarified the question without changing old offers",
        },
      );
      assert.equal(changedTerms.status, 200);
      const termEditedMarket = marketFrom(changedTerms.payload, market.id);
      const frozenTermOffer = offerFrom(changedTerms.payload, termOffer.id);
      const frozenTermLeg = offerLeg(frozenTermOffer, market.id);
      assert.equal(
        frozenTermLeg.marketRevisionId,
        extendedMarket.currentRevisionId,
      );
      assert.equal(
        frozenTermLeg.originalMarketRevisionId,
        extendedMarket.currentRevisionId,
      );
      assert.equal(frozenTermOffer.expiresAt, extendedClose);

      const shortened = await editMarket(
        baseUrl,
        maker,
        termEditedMarket,
        {
          closesAt: "2032-06-01T00:00:00.000Z",
          changeNote: "This deadline must not become earlier",
        },
      );
      assert.equal(shortened.status, 400);
      assert.equal(
        shortened.payload.error?.code,
        "DEADLINE_CANNOT_SHORTEN",
      );

      const parlayMarketA = await createMarket(
        baseUrl,
        maker,
        `Parlay later leg ${stamp}`,
        "2035-01-01T00:00:00.000Z",
      );
      const parlayMarketB = await createMarket(
        baseUrl,
        maker,
        `Parlay early leg ${stamp}`,
        "2034-01-01T00:00:00.000Z",
      );
      const parlayOffer = await createOffer(baseUrl, maker, [
        leg(parlayMarketA),
        leg(parlayMarketB),
      ]);
      assert.equal(parlayOffer.expiresAt, parlayMarketB.closesAt);

      const parlayExtension = await editMarket(
        baseUrl,
        maker,
        parlayMarketB,
        {
          closesAt: "2036-01-01T00:00:00.000Z",
          changeNote: "Move the early parlay leg past the other leg",
        },
      );
      assert.equal(parlayExtension.status, 200);
      const extendedParlay = offerFrom(
        parlayExtension.payload,
        parlayOffer.id,
      );
      assert.equal(extendedParlay.expiresAt, parlayMarketA.closesAt);
      assert.equal(
        offerLeg(extendedParlay, parlayMarketA.id).marketRevisionId,
        parlayMarketA.currentRevisionId,
      );
      assert.equal(
        offerLeg(extendedParlay, parlayMarketB.id)
          .originalMarketRevisionId,
        parlayMarketB.currentRevisionId,
      );

      const closeSoon = new Date(Date.now() + 2_000).toISOString();
      const closedMarket = await createMarket(
        baseUrl,
        maker,
        `Closed reopen ${stamp}`,
        closeSoon,
      );
      const expiringOffer = await createOffer(baseUrl, maker, [
        leg(closedMarket),
      ]);
      await waitPast(closeSoon);
      const expiredState = await getState(baseUrl, maker);
      assert.equal(offerFrom(expiredState, expiringOffer.id).status, "expired");

      const unauthorizedReopen = await postAction(baseUrl, observer, {
        type: "reopen_market",
        marketId: closedMarket.id,
        baseRevisionId: closedMarket.currentRevisionId,
        closesAt: new Date(Date.now() + 3_600_000).toISOString(),
        changeNote: "An observer cannot reopen this market",
      });
      assert.equal(unauthorizedReopen.status, 403);
      assert.equal(
        unauthorizedReopen.payload.error?.code,
        "NOT_MARKET_ORACLE",
      );

      const reopenedClose = new Date(Date.now() + 7_200_000).toISOString();
      const reopenedResponse = await postAction(baseUrl, maker, {
        type: "reopen_market",
        marketId: closedMarket.id,
        baseRevisionId: closedMarket.currentRevisionId,
        closesAt: reopenedClose,
        changeNote: "The event was rescheduled for later today",
      });
      assert.equal(reopenedResponse.status, 200);
      const reopenedMarket = marketFrom(
        reopenedResponse.payload,
        closedMarket.id,
      );
      assert.equal(reopenedMarket.revisionNumber, 2);
      assert.equal(reopenedMarket.question, closedMarket.question);
      assert.equal(reopenedMarket.description, closedMarket.description);
      assert.equal(reopenedMarket.selectionA, closedMarket.selectionA);
      assert.equal(reopenedMarket.selectionB, closedMarket.selectionB);
      assert.equal(reopenedMarket.closesAt, reopenedClose);
      const stillExpired = offerFrom(
        reopenedResponse.payload,
        expiringOffer.id,
      );
      assert.equal(stillExpired.status, "expired");
      assert.equal(
        offerLeg(stillExpired, closedMarket.id).marketRevisionId,
        closedMarket.currentRevisionId,
      );
      assert.equal(
        reopenedResponse.payload.activity.some(
          (event) =>
            event.action === "reopened_market" &&
            event.entityId === reopenedMarket.currentRevisionId,
        ),
        true,
      );

      const freshOffer = await createOffer(baseUrl, maker, [
        leg(reopenedMarket),
      ]);
      assert.equal(
        offerLeg(freshOffer, reopenedMarket.id).marketRevisionId,
        reopenedMarket.currentRevisionId,
      );

      const staleReopen = await postAction(baseUrl, maker, {
        type: "reopen_market",
        marketId: closedMarket.id,
        baseRevisionId: closedMarket.currentRevisionId,
        closesAt: new Date(Date.now() + 10_800_000).toISOString(),
        changeNote: "A stale reopen request must lose",
      });
      assert.equal(staleReopen.status, 409);
      assert.equal(staleReopen.payload.error?.code, "MARKET_CHANGED");

      const resolvedMarket = await createMarket(
        baseUrl,
        maker,
        `Resolved final ${stamp}`,
        "2037-01-01T00:00:00.000Z",
      );
      const resolved = await postAction(baseUrl, maker, {
        type: "resolve_market",
        marketId: resolvedMarket.id,
        marketRevisionId: resolvedMarket.currentRevisionId,
        result: "a",
      });
      assert.equal(resolved.status, 200);
      const reopenResolved = await postAction(baseUrl, maker, {
        type: "reopen_market",
        marketId: resolvedMarket.id,
        baseRevisionId: resolvedMarket.currentRevisionId,
        closesAt: "2038-01-01T00:00:00.000Z",
        changeNote: "A resolved market must remain final",
      });
      assert.equal(reopenResolved.status, 409);
      assert.equal(reopenResolved.payload.error?.code, "MARKET_FINAL");

      const raceMarket = await createMarket(
        baseUrl,
        maker,
        `Accept extension race ${stamp}`,
        "2039-01-01T00:00:00.000Z",
      );
      const raceOffer = await createOffer(baseUrl, maker, [leg(raceMarket)]);
      const [raceExtension, raceAcceptance] = await Promise.all([
        editMarket(baseUrl, maker, raceMarket, {
          closesAt: "2040-01-01T00:00:00.000Z",
          changeNote: "Race deadline extension against acceptance",
        }),
        postAction(baseUrl, taker, {
          type: "accept_offer",
          offerId: raceOffer.id,
        }),
      ]);
      assert.equal(raceExtension.status, 200);
      assert.equal(raceAcceptance.status, 200);
      const raceState = await getState(baseUrl, maker);
      const raceBet = raceState.bets.find((bet) =>
        bet.legs.some((candidate) => candidate.marketId === raceMarket.id),
      );
      assert.ok(raceBet);
      assert.ok(
        [
          raceMarket.currentRevisionId,
          marketFrom(raceState, raceMarket.id).currentRevisionId,
        ].includes(offerLeg(raceBet, raceMarket.id).marketRevisionId),
      );
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

async function createMarket(baseUrl, creator, question, closesAt) {
  const response = await postAction(baseUrl, creator, {
    type: "create_market",
    question,
    description: "Deadline extension and reopen integration test",
    selectionA: "Yes",
    selectionB: "No",
    closesAt,
  });
  assert.equal(response.status, 200);
  const market = response.payload.markets.find(
    (candidate) => candidate.question === question,
  );
  assert.ok(market);
  return market;
}

async function editMarket(baseUrl, creator, market, overrides) {
  return postAction(baseUrl, creator, {
    type: "edit_market",
    marketId: market.id,
    baseRevisionId: market.currentRevisionId,
    question: overrides.question ?? market.question,
    description: overrides.description ?? market.description,
    selectionA: overrides.selectionA ?? market.selectionA,
    selectionB: overrides.selectionB ?? market.selectionB,
    closesAt: overrides.closesAt ?? market.closesAt,
    changeNote: overrides.changeNote,
  });
}

async function createOffer(baseUrl, maker, legs) {
  const response = await postAction(baseUrl, maker, {
    type: "create_offer",
    makerRiskCents: 1_000,
    takerRiskCents: 1_200,
    legs,
  });
  assert.equal(response.status, 200);
  const marketIds = new Set(legs.map((item) => item.marketId));
  const offer = response.payload.offers.find(
    (candidate) =>
      candidate.status === "open" &&
      candidate.legs.length === legs.length &&
      candidate.legs.every((candidateLeg) =>
        marketIds.has(candidateLeg.marketId),
      ),
  );
  assert.ok(offer);
  return offer;
}

function leg(market, selection = "a") {
  return {
    marketId: market.id,
    marketRevisionId: market.currentRevisionId,
    selection,
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

function offerFrom(state, offerId) {
  const offer = state.offers.find((candidate) => candidate.id === offerId);
  assert.ok(offer);
  return offer;
}

function offerLeg(offerOrBet, marketId) {
  const matchingLeg = offerOrBet.legs.find(
    (candidate) => candidate.marketId === marketId,
  );
  assert.ok(matchingLeg);
  return matchingLeg;
}

async function waitPast(timestamp) {
  const waitMs = Math.max(0, new Date(timestamp).getTime() - Date.now() + 150);
  await new Promise((resolve) => setTimeout(resolve, waitMs));
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
        WRANGLER_LOG_PATH: ".wrangler/market-deadline-integration.log",
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
            email: "readiness-market-deadline@local.sidebet",
            name: "Readiness Market Deadline",
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
