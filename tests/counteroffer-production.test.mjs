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
  "decline authorization and accept-versus-decline races hold against D1",
  { timeout: 45_000 },
  async () => {
    const port = await availablePort();
    const server = startDevServer(port);
    const baseUrl = `http://localhost:${port}`;

    try {
      await waitForServer(baseUrl, server);
      const stamp = `${Date.now()}-${process.pid}`;
      const users = {
        maker: {
          email: `maker-${stamp}@local.sidebet`,
          name: `Maker ${stamp}`,
        },
        challengerA: {
          email: `challenger-a-${stamp}@local.sidebet`,
          name: `Challenger A ${stamp}`,
        },
        challengerB: {
          email: `challenger-b-${stamp}@local.sidebet`,
          name: `Challenger B ${stamp}`,
        },
      };

      const declineOffer = await createOffer(
        baseUrl,
        users.maker,
        `Decline flow ${stamp}`,
      );
      const counterAResponse = await postAction(baseUrl, users.challengerA, {
        type: "create_counteroffer",
        offerId: declineOffer.offer.id,
        makerRiskCents: 900,
        takerRiskCents: 1_300,
      });
      assert.equal(counterAResponse.status, 200);
      const counterA = offerFrom(
        counterAResponse.payload,
        declineOffer.offer.id,
      ).counters.at(-1);
      assert.ok(counterA);

      const proposerDecline = await postAction(
        baseUrl,
        users.challengerA,
        {
          type: "decline_counteroffer",
          counterId: counterA.id,
        },
      );
      assert.equal(proposerDecline.status, 403);
      assert.equal(
        proposerDecline.payload.error?.code,
        "NOT_COUNTER_RECIPIENT",
      );

      const counterBResponse = await postAction(baseUrl, users.challengerB, {
        type: "create_counteroffer",
        offerId: declineOffer.offer.id,
        makerRiskCents: 800,
        takerRiskCents: 1_400,
      });
      assert.equal(counterBResponse.status, 200);
      const counterB = offerFrom(
        counterBResponse.payload,
        declineOffer.offer.id,
      ).counters.find((counter) => counter.id !== counterA.id);
      assert.ok(counterB);

      const recipientDecline = await postAction(baseUrl, users.maker, {
        type: "decline_counteroffer",
        counterId: counterA.id,
      });
      assert.equal(recipientDecline.status, 200);

      const afterDecline = await getState(baseUrl, users.maker);
      const declinedOfferState = offerFrom(
        afterDecline,
        declineOffer.offer.id,
      );
      assert.equal(declinedOfferState.status, "open");
      assert.equal(
        declinedOfferState.counters.find(
          (counter) => counter.id === counterA.id,
        )?.status,
        "superseded",
      );
      assert.equal(
        declinedOfferState.counters.find(
          (counter) => counter.id === counterB.id,
        )?.status,
        "pending",
      );
      assert.equal(
        betsForMarket(afterDecline, declineOffer.market.id).length,
        0,
      );
      assert.equal(
        afterDecline.activity.filter(
          (event) =>
            event.action === "declined_counteroffer" &&
            event.entityId === counterA.id,
        ).length,
        1,
      );

      const repeatedDecline = await postAction(baseUrl, users.maker, {
        type: "decline_counteroffer",
        counterId: counterA.id,
      });
      assert.equal(repeatedDecline.status, 409);
      assert.equal(repeatedDecline.payload.error?.code, "COUNTER_STALE");

      const staleAccept = await postAction(baseUrl, users.maker, {
        type: "accept_offer",
        offerId: declineOffer.offer.id,
        counterId: counterA.id,
      });
      assert.equal(staleAccept.status, 409);
      assert.equal(staleAccept.payload.error?.code, "COUNTER_STALE");

      const staleCounter = await postAction(baseUrl, users.maker, {
        type: "create_counteroffer",
        offerId: declineOffer.offer.id,
        parentCounterId: counterA.id,
        makerRiskCents: 1_000,
        takerRiskCents: 1_000,
      });
      assert.equal(staleCounter.status, 409);
      assert.equal(staleCounter.payload.error?.code, "COUNTER_STALE");

      const raceOffer = await createOffer(
        baseUrl,
        users.maker,
        `Race flow ${stamp}`,
      );
      const raceCounterResponse = await postAction(
        baseUrl,
        users.challengerA,
        {
          type: "create_counteroffer",
          offerId: raceOffer.offer.id,
          makerRiskCents: 950,
          takerRiskCents: 1_250,
        },
      );
      assert.equal(raceCounterResponse.status, 200);
      const raceCounter = offerFrom(
        raceCounterResponse.payload,
        raceOffer.offer.id,
      ).counters.at(-1);
      assert.ok(raceCounter);

      const raceResults = await Promise.all([
        postAction(baseUrl, users.maker, {
          type: "accept_offer",
          offerId: raceOffer.offer.id,
          counterId: raceCounter.id,
        }),
        postAction(baseUrl, users.maker, {
          type: "decline_counteroffer",
          counterId: raceCounter.id,
        }),
      ]);
      assert.equal(
        raceResults.filter((result) => result.status === 200).length,
        1,
      );
      assert.equal(
        raceResults.filter(
          (result) =>
            result.status === 409 &&
            result.payload.error?.code === "COUNTER_STALE",
        ).length,
        1,
      );

      const afterRace = await getState(baseUrl, users.maker);
      const raceOfferState = offerFrom(afterRace, raceOffer.offer.id);
      const raceCounterState = raceOfferState.counters.find(
        (counter) => counter.id === raceCounter.id,
      );
      const raceBets = betsForMarket(afterRace, raceOffer.market.id);
      const raceDeclines = afterRace.activity.filter(
        (event) =>
          event.action === "declined_counteroffer" &&
          event.entityId === raceCounter.id,
      );
      const raceAccepts = afterRace.activity.filter(
        (event) =>
          event.action === "accepted_offer" &&
          event.metadata.acceptedCounterId === raceCounter.id,
      );

      if (raceOfferState.status === "accepted") {
        assert.equal(raceCounterState?.status, "accepted");
        assert.equal(raceBets.length, 1);
        assert.equal(raceAccepts.length, 1);
        assert.equal(raceDeclines.length, 0);
      } else {
        assert.equal(raceOfferState.status, "open");
        assert.equal(raceCounterState?.status, "superseded");
        assert.equal(raceBets.length, 0);
        assert.equal(raceAccepts.length, 0);
        assert.equal(raceDeclines.length, 1);
      }

      const counterRaceOffer = await createOffer(
        baseUrl,
        users.maker,
        `Counter race ${stamp}`,
      );
      const parentCounterResponse = await postAction(
        baseUrl,
        users.challengerA,
        {
          type: "create_counteroffer",
          offerId: counterRaceOffer.offer.id,
          makerRiskCents: 925,
          takerRiskCents: 1_275,
        },
      );
      assert.equal(parentCounterResponse.status, 200);
      const parentCounter = offerFrom(
        parentCounterResponse.payload,
        counterRaceOffer.offer.id,
      ).counters.at(-1);
      assert.ok(parentCounter);

      const counterRaceResults = await Promise.all([
        postAction(baseUrl, users.maker, {
          type: "create_counteroffer",
          offerId: counterRaceOffer.offer.id,
          parentCounterId: parentCounter.id,
          makerRiskCents: 1_050,
          takerRiskCents: 1_150,
        }),
        postAction(baseUrl, users.maker, {
          type: "decline_counteroffer",
          counterId: parentCounter.id,
        }),
      ]);
      assert.equal(
        counterRaceResults.filter((result) => result.status === 200).length,
        1,
      );
      assert.equal(
        counterRaceResults.filter(
          (result) =>
            result.status === 409 &&
            result.payload.error?.code === "COUNTER_STALE",
        ).length,
        1,
      );

      const afterCounterRace = await getState(baseUrl, users.maker);
      const counterRaceOfferState = offerFrom(
        afterCounterRace,
        counterRaceOffer.offer.id,
      );
      const parentCounterState = counterRaceOfferState.counters.find(
        (counter) => counter.id === parentCounter.id,
      );
      const childCounters = counterRaceOfferState.counters.filter(
        (counter) => counter.parentCounterId === parentCounter.id,
      );
      const counterRaceDeclines = afterCounterRace.activity.filter(
        (event) =>
          event.action === "declined_counteroffer" &&
          event.entityId === parentCounter.id,
      );
      assert.equal(counterRaceOfferState.status, "open");
      assert.equal(parentCounterState?.status, "superseded");
      assert.equal(
        betsForMarket(afterCounterRace, counterRaceOffer.market.id).length,
        0,
      );
      if (childCounters.length === 1) {
        assert.equal(childCounters[0].status, "pending");
        assert.equal(counterRaceDeclines.length, 0);
      } else {
        assert.equal(childCounters.length, 0);
        assert.equal(counterRaceDeclines.length, 1);
      }

      const resolutionRaceOffer = await createOffer(
        baseUrl,
        users.maker,
        `Resolution race ${stamp}`,
      );
      const resolutionCounterResponse = await postAction(
        baseUrl,
        users.challengerA,
        {
          type: "create_counteroffer",
          offerId: resolutionRaceOffer.offer.id,
          makerRiskCents: 975,
          takerRiskCents: 1_225,
        },
      );
      assert.equal(resolutionCounterResponse.status, 200);
      const resolutionCounter = offerFrom(
        resolutionCounterResponse.payload,
        resolutionRaceOffer.offer.id,
      ).counters.at(-1);
      assert.ok(resolutionCounter);

      const [acceptDuringResolution, resolutionResult] = await Promise.all([
        postAction(baseUrl, users.maker, {
          type: "accept_offer",
          offerId: resolutionRaceOffer.offer.id,
          counterId: resolutionCounter.id,
        }),
        postAction(baseUrl, users.maker, {
          type: "resolve_market",
          marketId: resolutionRaceOffer.market.id,
          marketRevisionId: resolutionRaceOffer.market.currentRevisionId,
          result: "a",
        }),
      ]);
      assert.equal(resolutionResult.status, 200);
      assert.ok(
        acceptDuringResolution.status === 200 ||
          (acceptDuringResolution.status === 409 &&
            ["COUNTER_STALE", "MARKET_CLOSED", "OFFER_TAKEN"].includes(
              acceptDuringResolution.payload.error?.code,
            )),
      );

      const afterResolutionRace = await getState(baseUrl, users.maker);
      const resolutionRaceOfferState = offerFrom(
        afterResolutionRace,
        resolutionRaceOffer.offer.id,
      );
      const resolutionRaceBets = betsForMarket(
        afterResolutionRace,
        resolutionRaceOffer.market.id,
      );
      if (acceptDuringResolution.status === 200) {
        assert.equal(resolutionRaceOfferState.status, "accepted");
        assert.equal(resolutionRaceBets.length, 1);
      } else {
        assert.equal(resolutionRaceOfferState.status, "expired");
        assert.equal(resolutionRaceBets.length, 0);
      }
    } finally {
      await stopDevServer(server);
    }
  },
);

async function createOffer(baseUrl, maker, question) {
  const marketResponse = await postAction(baseUrl, maker, {
    type: "create_market",
    question,
    description: "Counteroffer D1 integration test",
    selectionA: "Yes",
    selectionB: "No",
    closesAt: "2030-01-01T00:00:00.000Z",
  });
  assert.equal(marketResponse.status, 200);
  const market = marketResponse.payload.markets.find(
    (candidate) => candidate.question === question,
  );
  assert.ok(market);

  const offerResponse = await postAction(baseUrl, maker, {
    type: "create_offer",
    makerRiskCents: 1_000,
    takerRiskCents: 1_200,
    legs: [
      {
        marketId: market.id,
        marketRevisionId: market.currentRevisionId,
        selection: "a",
      },
    ],
  });
  assert.equal(offerResponse.status, 200);
  const offer = offerResponse.payload.offers.find(
    (candidate) =>
      candidate.status === "open" &&
      candidate.legs.some((leg) => leg.marketId === market.id),
  );
  assert.ok(offer);
  return { market, offer };
}

async function postAction(baseUrl, user, body) {
  const response = await fetch(`${baseUrl}/api/actions`, {
    method: "POST",
    headers: identityHeaders(user),
    body: JSON.stringify(body),
  });
  return {
    status: response.status,
    payload: await response.json(),
  };
}

async function getState(baseUrl, user) {
  const response = await fetch(`${baseUrl}/api/state`, {
    headers: identityHeaders(user, false),
  });
  assert.equal(response.status, 200);
  return response.json();
}

function identityHeaders(user, includeContentType = true) {
  return {
    ...(includeContentType ? { "content-type": "application/json" } : {}),
    "oai-authenticated-user-email": user.email,
    "oai-authenticated-user-full-name": encodeURIComponent(user.name),
    "oai-authenticated-user-full-name-encoding": "percent-encoded-utf-8",
  };
}

function offerFrom(state, offerId) {
  const offer = state.offers.find((candidate) => candidate.id === offerId);
  assert.ok(offer);
  return offer;
}

function betsForMarket(state, marketId) {
  return state.bets.filter((bet) =>
    bet.legs.some((leg) => leg.marketId === marketId),
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
        WRANGLER_LOG_PATH: ".wrangler/counteroffer-integration.log",
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
        headers: identityHeaders({
          email: "readiness@local.sidebet",
          name: "Readiness",
        }),
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
    if (process.platform === "win32") {
      server.kill("SIGINT");
    } else {
      process.kill(-server.pid, "SIGINT");
    }
  } catch {
    server.kill("SIGINT");
  }
  await Promise.race([
    once(server, "exit"),
    new Promise((resolve) => setTimeout(resolve, 5_000)),
  ]);
  if (server.exitCode === null) {
    try {
      if (process.platform === "win32") {
        server.kill("SIGKILL");
      } else {
        process.kill(-server.pid, "SIGKILL");
      }
    } catch {
      server.kill("SIGKILL");
    }
  }
}
