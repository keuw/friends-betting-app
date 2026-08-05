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
const adminEmail = "phase24-admin@local.sidebet";

test(
  "configured admins manage friends' markets without inheriting ownership",
  { timeout: 60_000 },
  async () => {
    const port = await availablePort();
    const server = startDevServer(port);
    const baseUrl = `http://localhost:${port}`;

    try {
      await waitForServer(baseUrl, server);
      const stamp = `${Date.now()}-${process.pid}`;
      const creator = user("Admin Test Creator", stamp);
      const admin = { email: adminEmail, name: "Phase 24 Admin" };
      const observer = user("Admin Test Observer", stamp);
      const lookalike = {
        email: `${adminEmail}.evil`,
        name: "Admin Email Lookalike",
      };

      const openMarket = await createMarket(
        baseUrl,
        creator,
        `Admin edit ${stamp}`,
        "2035-01-01T00:00:00.000Z",
      );

      const adminState = await getState(baseUrl, admin);
      const adminMarket = marketFrom(adminState, openMarket.id);
      assert.equal(adminState.viewer.isAdmin, true);
      assert.equal(adminMarket.createdByMe, false);
      assert.equal(adminMarket.canManage, true);
      assert.equal(adminMarket.canDelete, false);
      assert.equal(currentRevision(adminMarket).canResolve, true);

      const observerState = await getState(baseUrl, observer);
      const observerMarket = marketFrom(observerState, openMarket.id);
      assert.equal(observerState.viewer.isAdmin, false);
      assert.equal(observerMarket.canManage, false);
      assert.equal(currentRevision(observerMarket).canResolve, false);

      const lookalikeState = await getState(baseUrl, lookalike);
      assert.equal(lookalikeState.viewer.isAdmin, false);

      const observerEdit = await editMarket(
        baseUrl,
        observer,
        openMarket,
        `Observer cannot edit ${stamp}`,
      );
      assert.equal(observerEdit.status, 403);
      assert.equal(observerEdit.payload.error?.code, "NOT_MARKET_ORACLE");

      const adminEdit = await editMarket(
        baseUrl,
        admin,
        openMarket,
        `Admin edited ${stamp}`,
      );
      assert.equal(adminEdit.status, 200);
      const editedMarket = marketFrom(adminEdit.payload, openMarket.id);
      assert.equal(editedMarket.question, `Admin edited ${stamp}`);
      assert.equal(currentRevision(editedMarket).editorName, admin.name);

      const adminDelete = await postAction(baseUrl, admin, {
        type: "delete_market",
        marketId: openMarket.id,
      });
      assert.equal(adminDelete.status, 403);
      assert.equal(adminDelete.payload.error?.code, "NOT_MARKET_CREATOR");

      const closesSoon = new Date(Date.now() + 2_000).toISOString();
      const closedMarket = await createMarket(
        baseUrl,
        creator,
        `Admin reopen ${stamp}`,
        closesSoon,
      );
      await waitPast(closesSoon);

      const observerReopen = await postAction(baseUrl, observer, {
        type: "reopen_market",
        marketId: closedMarket.id,
        baseRevisionId: closedMarket.currentRevisionId,
        closesAt: "2036-01-01T00:00:00.000Z",
        changeNote: "An ordinary friend must remain blocked",
      });
      assert.equal(observerReopen.status, 403);
      assert.equal(observerReopen.payload.error?.code, "NOT_MARKET_ORACLE");

      const adminReopen = await postAction(baseUrl, admin, {
        type: "reopen_market",
        marketId: closedMarket.id,
        baseRevisionId: closedMarket.currentRevisionId,
        closesAt: "2036-01-01T00:00:00.000Z",
        changeNote: "Admin reopened the postponed event",
      });
      assert.equal(adminReopen.status, 200);
      const reopenedMarket = marketFrom(adminReopen.payload, closedMarket.id);
      assert.equal(reopenedMarket.revisionNumber, 2);
      assert.equal(currentRevision(reopenedMarket).editorName, admin.name);

      const observerResolve = await postAction(baseUrl, observer, {
        type: "resolve_market",
        marketId: reopenedMarket.id,
        marketRevisionId: reopenedMarket.currentRevisionId,
        result: "a",
      });
      assert.equal(observerResolve.status, 403);
      assert.equal(observerResolve.payload.error?.code, "NOT_MARKET_ORACLE");

      const adminResolve = await postAction(baseUrl, admin, {
        type: "resolve_market",
        marketId: reopenedMarket.id,
        marketRevisionId: reopenedMarket.currentRevisionId,
        result: "a",
      });
      assert.equal(adminResolve.status, 200);
      const resolvedMarket = marketFrom(adminResolve.payload, reopenedMarket.id);
      assert.equal(resolvedMarket.status, "resolved");
      assert.equal(resolvedMarket.winningSelection, "a");
      assert.equal(
        adminResolve.payload.activity.some(
          (event) =>
            event.actorName === admin.name &&
            event.action === "resolved_market_revision" &&
            event.entityId === reopenedMarket.currentRevisionId,
        ),
        true,
      );

      const voidMarket = await createMarket(
        baseUrl,
        creator,
        `Admin void ${stamp}`,
        "2037-01-01T00:00:00.000Z",
      );
      const adminVoid = await postAction(baseUrl, admin, {
        type: "resolve_market",
        marketId: voidMarket.id,
        marketRevisionId: voidMarket.currentRevisionId,
        result: "void",
      });
      assert.equal(adminVoid.status, 200);
      assert.equal(marketFrom(adminVoid.payload, voidMarket.id).status, "void");
    } finally {
      await stopDevServer(server);
    }
  },
);

function user(prefix, stamp) {
  return {
    email: `${prefix.toLowerCase().replaceAll(" ", "-")}-${stamp}@local.sidebet`,
    name: `${prefix} ${stamp}`,
  };
}

async function createMarket(baseUrl, creator, question, closesAt) {
  const response = await postAction(baseUrl, creator, {
    type: "create_market",
    question,
    description: "Admin authorization integration test",
    selectionA: "Yes",
    selectionB: "No",
    closesAt,
  });
  assert.equal(response.status, 200);
  return marketFrom(response.payload, response.payload.markets.find(
    (market) => market.question === question,
  ).id);
}

function editMarket(baseUrl, actor, market, question) {
  return postAction(baseUrl, actor, {
    type: "edit_market",
    marketId: market.id,
    baseRevisionId: market.currentRevisionId,
    question,
    description: market.description,
    selectionA: market.selectionA,
    selectionB: market.selectionB,
    closesAt: "2035-06-01T00:00:00.000Z",
    changeNote: "Admin authorization edit test",
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

function marketFrom(state, marketId) {
  const market = state.markets.find((candidate) => candidate.id === marketId);
  assert.ok(market);
  return market;
}

function currentRevision(market) {
  const revision = market.revisions.find((candidate) => candidate.isCurrent);
  assert.ok(revision);
  return revision;
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
        ADMIN_EMAILS: ` other-admin@local.sidebet, ${adminEmail.toUpperCase()} `,
        WRANGLER_LOG_PATH: ".wrangler/admin-authorization-integration.log",
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
            email: "readiness-admin-auth@local.sidebet",
            name: "Readiness Admin Authorization",
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
