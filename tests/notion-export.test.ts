import assert from "node:assert/strict";
import test from "node:test";
import {
  NotionClient,
  canonicalizeMatchedBet,
  exportBetToNotion,
  hashExportPayload,
  notionPropertiesForBet,
  type MatchedBetExport,
} from "../lib/notion-export";

const matchedBet: MatchedBetExport = {
  betId: "bet-123",
  makerName: "Alice alice@example.com",
  takerName: "Bob",
  makerRiskCents: 10_00,
  takerRiskCents: 15_00,
  status: "pending",
  acceptedAt: "2026-07-20T17:00:00.000Z",
  settledAt: null,
  activeRevisionNumber: 2,
  legs: [
    {
      marketRevisionId: "market-revision-2",
      marketRevisionNumber: 2,
      question: "Will the Giants win?",
      makerSelection: "a",
      makerSelectionLabel: "Yes",
      closesAt: "2026-07-31T02:00:00.000Z",
      result: "pending",
    },
  ],
  revisions: [
    {
      revisionNumber: 1,
      makerRiskCents: 8_00,
      takerRiskCents: 12_00,
      proposerName: "Alice",
      recipientName: "Bob",
      status: "superseded",
      changeNote: "Original terms",
      createdAt: "2026-07-20T17:00:00.000Z",
      respondedAt: "2026-07-21T17:00:00.000Z",
      legs: [],
    },
    {
      revisionNumber: 2,
      makerRiskCents: 10_00,
      takerRiskCents: 15_00,
      proposerName: "Bob",
      recipientName: "Alice",
      status: "active",
      changeNote: "Updated odds",
      createdAt: "2026-07-21T17:00:00.000Z",
      respondedAt: "2026-07-21T18:00:00.000Z",
      legs: [],
    },
  ],
};

test("canonical export payload is stable and omits email addresses", async () => {
  const first = canonicalizeMatchedBet(matchedBet);
  const second = canonicalizeMatchedBet({
    ...matchedBet,
    revisions: [...matchedBet.revisions],
    legs: [...matchedBet.legs],
  });

  assert.equal(first, second);
  assert.doesNotMatch(first, /alice@example\.com/i);
  assert.equal(
    await hashExportPayload(first),
    await hashExportPayload(second),
  );
});

test("Notion properties contain the stable external key and readable history", () => {
  const properties = notionPropertiesForBet(
    matchedBet,
    "2026-07-28T17:00:00.000Z",
    "https://sidebet.example",
  );
  const serialized = JSON.stringify(properties);

  assert.match(serialized, /Sidebet Bet ID/);
  assert.match(serialized, /bet-123/);
  assert.match(serialized, /Revision 2/);
  assert.match(serialized, /Will the Giants win/);
  assert.doesNotMatch(serialized, /alice@example\.com/i);
  assert.deepEqual(properties["Maker Risk"], {
    type: "number",
    number: 10,
  });
  assert.deepEqual(properties["Taker Risk"], {
    type: "number",
    number: 15,
  });
});

test("Notion client paginates exact-ID lookup and retries throttling", async () => {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const responses = [
    new Response(JSON.stringify({ message: "slow down" }), {
      status: 429,
      headers: { "Retry-After": "0" },
    }),
    Response.json({
      results: [],
      has_more: true,
      next_cursor: "cursor-2",
    }),
    Response.json({
      results: [{ id: "notion-page-123" }],
      has_more: false,
      next_cursor: null,
    }),
  ];
  const client = new NotionClient({
    token: "test-token",
    dataSourceId: "data-source-123",
    fetch: async (input, init) => {
      calls.push({ url: String(input), init: init ?? {} });
      const response = responses.shift();
      assert.ok(response);
      return response;
    },
    sleep: async () => undefined,
  });

  assert.equal(await client.findPageByBetId("bet-123"), "notion-page-123");
  assert.equal(calls.length, 3);
  const headers = new Headers(calls[0]?.init.headers);
  assert.equal(headers.get("authorization"), "Bearer test-token");
  assert.equal(headers.get("notion-version"), "2026-03-11");
  assert.match(String(calls[2]?.init.body), /cursor-2/);
});

test("export creates, updates, and skips matched-bet records idempotently", async () => {
  const calls: string[] = [];
  const client = {
    findPageByBetId: async () => null,
    createPage: async () => {
      calls.push("create");
      return "page-created";
    },
    updatePage: async () => {
      calls.push("update");
    },
  };
  const canonicalPayload = canonicalizeMatchedBet(matchedBet);
  const hash = await hashExportPayload(canonicalPayload);

  assert.deepEqual(
    await exportBetToNotion({
      bet: matchedBet,
      existing: null,
      client,
      exportedAt: "2026-07-28T17:00:00.000Z",
      appUrl: "https://sidebet.example",
    }),
    { outcome: "created", notionPageId: "page-created", payloadHash: hash },
  );

  assert.deepEqual(
    await exportBetToNotion({
      bet: matchedBet,
      existing: { notionPageId: "page-created", payloadHash: hash },
      client,
      exportedAt: "2026-07-28T18:00:00.000Z",
      appUrl: "https://sidebet.example",
    }),
    {
      outcome: "unchanged",
      notionPageId: "page-created",
      payloadHash: hash,
    },
  );

  assert.deepEqual(
    await exportBetToNotion({
      bet: { ...matchedBet, status: "maker_won" },
      existing: { notionPageId: "page-created", payloadHash: hash },
      client,
      exportedAt: "2026-07-29T17:00:00.000Z",
      appUrl: "https://sidebet.example",
    }),
    {
      outcome: "updated",
      notionPageId: "page-created",
      payloadHash: await hashExportPayload(
        canonicalizeMatchedBet({ ...matchedBet, status: "maker_won" }),
      ),
    },
  );

  assert.deepEqual(calls, ["create", "update"]);
});
