import assert from "node:assert/strict";
import test from "node:test";
import {
  ExportAlreadyRunningError,
  runMatchedBetExport,
  type ExportRepository,
} from "../lib/notion-export-run";
import type { MatchedBetExport } from "../lib/notion-export";

const bet = {
  betId: "bet-1",
  makerName: "Alice",
  takerName: "Bob",
  makerRiskCents: 1_000,
  takerRiskCents: 1_500,
  status: "pending",
  acceptedAt: "2026-07-20T17:00:00.000Z",
  settledAt: null,
  activeRevisionNumber: 1,
  legs: [],
  revisions: [],
} satisfies MatchedBetExport;

test("export run records unchanged and failed bets without losing progress", async () => {
  const events: string[] = [];
  const repository: ExportRepository = {
    beginRun: async () => "run-1",
    listMatchedBets: async () => [bet, { ...bet, betId: "bet-2" }],
    getExportState: async () => null,
    recordSuccess: async ({ betId, outcome }) => {
      events.push(`${betId}:${outcome}`);
    },
    recordFailure: async ({ betId }) => {
      events.push(`${betId}:failed`);
    },
    finishRun: async ({ status }) => {
      events.push(`run:${status}`);
    },
  };

  const result = await runMatchedBetExport({
    repository,
    client: {
      findPageByBetId: async () => null,
      createPage: async (properties) => {
        const id = JSON.stringify(properties).includes("bet-2")
          ? "page-2"
          : "page-1";
        if (id === "page-2") {
          throw new Error("Notion unavailable");
        }
        return id;
      },
      updatePage: async () => undefined,
    },
    appUrl: "https://sidebet.example",
    now: () => new Date("2026-07-28T17:00:00.000Z"),
  });

  assert.deepEqual(result, {
    runId: "run-1",
    status: "partial",
    scanned: 2,
    created: 1,
    updated: 0,
    unchanged: 0,
    failed: 1,
  });
  assert.deepEqual(events, ["bet-1:created", "bet-2:failed", "run:partial"]);
});

test("overlapping run rejection exits before querying matched bets", async () => {
  let queried = false;
  const repository: ExportRepository = {
    beginRun: async () => {
      throw new ExportAlreadyRunningError();
    },
    listMatchedBets: async () => {
      queried = true;
      return [];
    },
    getExportState: async () => null,
    recordSuccess: async () => undefined,
    recordFailure: async () => undefined,
    finishRun: async () => undefined,
  };

  await assert.rejects(
    runMatchedBetExport({
      repository,
      client: {
        findPageByBetId: async () => null,
        createPage: async () => "page-1",
        updatePage: async () => undefined,
      },
      appUrl: "https://sidebet.example",
    }),
    ExportAlreadyRunningError,
  );
  assert.equal(queried, false);
});
