import assert from "node:assert/strict";
import test from "node:test";
import { handleNotionExportRequest } from "../lib/notion-export-handler";
import { ExportAlreadyRunningError } from "../lib/notion-export-run";

const config = {
  exportSecret: "expected-secret",
  notionToken: "notion-test-token",
  notionDataSourceId: "data-source-id",
  appUrl: "https://sidebet.example",
};

function request(secret: string, method = "POST") {
  return new Request(
    "https://sidebet.example/api/internal/notion-export",
    {
      method,
      headers: { authorization: `Bearer ${secret}` },
    },
  );
}

test("export endpoint rejects unauthorized requests before any export work", async () => {
  let ran = false;
  const response = await handleNotionExportRequest(
    request("wrong-secret"),
    config,
    async () => {
      ran = true;
      throw new Error("must not run");
    },
  );

  assert.equal(response.status, 401);
  assert.equal(ran, false);
  assert.deepEqual(await response.json(), {
    error: { code: "UNAUTHORIZED" },
  });
});

test("export endpoint reports run counts and overlap without details", async () => {
  const summary = {
    runId: "run-1",
    status: "succeeded" as const,
    scanned: 2,
    created: 2,
    updated: 0,
    unchanged: 0,
    failed: 0,
  };
  const success = await handleNotionExportRequest(
    request("expected-secret"),
    config,
    async () => summary,
  );
  assert.equal(success.status, 200);
  assert.deepEqual(await success.json(), summary);

  const overlap = await handleNotionExportRequest(
    request("expected-secret"),
    config,
    async () => {
      throw new ExportAlreadyRunningError();
    },
  );
  assert.equal(overlap.status, 409);
  assert.deepEqual(await overlap.json(), {
    error: { code: "EXPORT_ALREADY_RUNNING" },
  });
});
