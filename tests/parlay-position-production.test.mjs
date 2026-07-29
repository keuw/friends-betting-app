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
  "Back and Fade positions persist, settle, counter, and revise against D1",
  { timeout: 60_000 },
  async () => {
    const port = await availablePort();
    const server = startDevServer(port);
    const baseUrl = `http://localhost:${port}`;

    try {
      await waitForServer(baseUrl, server);
      const stamp = `${Date.now()}-${process.pid}`;
      const maker = user("Fade Maker", stamp);
      const taker = user("Fade Taker", stamp);
      const hitMaker = user("Hit Maker", stamp);
      const hitTaker = user("Hit Taker", stamp);
      const editorMaker = user("Editor Maker", stamp);
      const editorTaker = user("Editor Taker", stamp);

      const invalidMarket = await createMarket(
        baseUrl,
        maker,
        `Invalid straight fade ${stamp}`,
      );
      const invalidStraight = await postAction(baseUrl, maker, {
        type: "create_offer",
        makerRiskCents: 1_000,
        takerRiskCents: 1_200,
        makerPosition: "fade",
        legs: [leg(invalidMarket)],
      });
      assert.equal(invalidStraight.status, 400);
      assert.equal(
        invalidStraight.payload.error?.code,
        "FADE_REQUIRES_PARLAY",
      );

      const missMarkets = await createMarkets(
        baseUrl,
        maker,
        `Fade miss ${stamp}`,
      );
      const fadeOffer = await createOffer(
        baseUrl,
        maker,
        missMarkets,
        "fade",
      );
      assert.equal(fadeOffer.makerPosition, "fade");

      const counterResponse = await postAction(baseUrl, taker, {
        type: "create_counteroffer",
        offerId: fadeOffer.id,
        makerRiskCents: 900,
        takerRiskCents: 1_300,
      });
      assert.equal(counterResponse.status, 200);
      const counter = offerFrom(counterResponse.payload, fadeOffer.id)
        .counters.at(-1);
      assert.ok(counter);

      const acceptedCounter = await postAction(baseUrl, maker, {
        type: "accept_offer",
        offerId: fadeOffer.id,
        counterId: counter.id,
      });
      assert.equal(acceptedCounter.status, 200);
      let fadeBet = betForMarkets(acceptedCounter.payload, missMarkets);
      assert.equal(fadeBet.makerPosition, "fade");
      assert.equal(fadeBet.makerRiskCents, 900);
      assert.equal(fadeBet.takerRiskCents, 1_300);
      assert.equal(fadeBet.revisions[0]?.makerPosition, "fade");

      const missResolution = await resolve(
        baseUrl,
        maker,
        missMarkets[0],
        "b",
      );
      assert.equal(missResolution.status, 200);
      fadeBet = betForMarkets(missResolution.payload, missMarkets);
      assert.equal(fadeBet.status, "maker_won");
      assert.equal(
        missResolution.payload.pairBalances.find(
          (balance) =>
            balance.debtorName === taker.name &&
            balance.creditorName === maker.name,
        )?.amountCents,
        1_300,
      );

      const hitMarkets = await createMarkets(
        baseUrl,
        hitMaker,
        `Fade all hit ${stamp}`,
      );
      const allHitOffer = await createOffer(
        baseUrl,
        hitMaker,
        hitMarkets,
        "fade",
      );
      const allHitAcceptance = await postAction(baseUrl, hitTaker, {
        type: "accept_offer",
        offerId: allHitOffer.id,
      });
      assert.equal(allHitAcceptance.status, 200);
      assert.equal(
        (await resolve(baseUrl, hitMaker, hitMarkets[0], "a")).status,
        200,
      );
      const allHitResolution = await resolve(
        baseUrl,
        hitMaker,
        hitMarkets[1],
        "a",
      );
      assert.equal(allHitResolution.status, 200);
      const allHitBet = betForMarkets(allHitResolution.payload, hitMarkets);
      assert.equal(allHitBet.status, "taker_won");
      assert.equal(
        allHitResolution.payload.pairBalances.find(
          (balance) =>
            balance.debtorName === hitMaker.name &&
            balance.creditorName === hitTaker.name,
        )?.amountCents,
        1_000,
      );

      const editMarkets = await createMarkets(
        baseUrl,
        editorMaker,
        `Position revision ${stamp}`,
      );
      const legacyBackOffer = await createOffer(
        baseUrl,
        editorMaker,
        editMarkets,
        undefined,
      );
      assert.equal(legacyBackOffer.makerPosition, "back");
      const editAcceptance = await postAction(baseUrl, editorTaker, {
        type: "accept_offer",
        offerId: legacyBackOffer.id,
      });
      assert.equal(editAcceptance.status, 200);
      const originalBet = betForMarkets(editAcceptance.payload, editMarkets);
      assert.equal(originalBet.makerPosition, "back");

      const revisionResponse = await postAction(baseUrl, editorMaker, {
        type: "propose_bet_revision",
        betId: originalBet.id,
        makerRiskCents: originalBet.makerRiskCents,
        takerRiskCents: originalBet.takerRiskCents,
        makerPosition: "fade",
        changeNote: "Maker takes the house side",
        legs: editMarkets.map(leg),
      });
      assert.equal(revisionResponse.status, 200);
      const pendingRevision = betForMarkets(
        revisionResponse.payload,
        editMarkets,
      ).revisions.find((revision) => revision.status === "pending");
      assert.ok(pendingRevision);
      assert.equal(pendingRevision.makerPosition, "fade");

      const revisionAcceptance = await postAction(baseUrl, editorTaker, {
        type: "respond_bet_revision",
        betRevisionId: pendingRevision.id,
        decision: "accepted",
      });
      assert.equal(revisionAcceptance.status, 200);
      const revisedBet = betForMarkets(
        revisionAcceptance.payload,
        editMarkets,
      );
      assert.equal(revisedBet.makerPosition, "fade");
      assert.deepEqual(
        revisedBet.revisions.map((revision) => revision.makerPosition),
        ["back", "fade"],
      );
      assert.equal(revisedBet.makerRiskCents, originalBet.makerRiskCents);
      assert.equal(revisedBet.takerRiskCents, originalBet.takerRiskCents);
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

async function createMarkets(baseUrl, maker, prefix) {
  return Promise.all([
    createMarket(baseUrl, maker, `${prefix} leg one`),
    createMarket(baseUrl, maker, `${prefix} leg two`),
  ]);
}

async function createMarket(baseUrl, maker, question) {
  const response = await postAction(baseUrl, maker, {
    type: "create_market",
    question,
    description: "Parlay position D1 integration test",
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

async function createOffer(baseUrl, maker, markets, makerPosition) {
  const response = await postAction(baseUrl, maker, {
    type: "create_offer",
    makerRiskCents: 1_000,
    takerRiskCents: 1_200,
    ...(makerPosition ? { makerPosition } : {}),
    legs: markets.map(leg),
  });
  assert.equal(response.status, 200);
  const offer = response.payload.offers.find(
    (candidate) =>
      candidate.status === "open" &&
      markets.every((market) =>
        candidate.legs.some((item) => item.marketId === market.id),
      ),
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

async function resolve(baseUrl, creator, market, result) {
  return postAction(baseUrl, creator, {
    type: "resolve_market",
    marketId: market.id,
    marketRevisionId: market.currentRevisionId,
    result,
  });
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

function identityHeaders(actor, includeContentType = true) {
  return {
    ...(includeContentType ? { "content-type": "application/json" } : {}),
    "oai-authenticated-user-email": actor.email,
    "oai-authenticated-user-full-name": encodeURIComponent(actor.name),
    "oai-authenticated-user-full-name-encoding": "percent-encoded-utf-8",
  };
}

function offerFrom(state, offerId) {
  const offer = state.offers.find((candidate) => candidate.id === offerId);
  assert.ok(offer);
  return offer;
}

function betForMarkets(state, markets) {
  const bet = state.bets.find((candidate) =>
    markets.every((market) =>
      candidate.legs.some((item) => item.marketId === market.id),
    ),
  );
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
        WRANGLER_LOG_PATH: ".wrangler/parlay-position-integration.log",
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
            email: "readiness-position@local.sidebet",
            name: "Readiness Position",
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
