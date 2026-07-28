import assert from "node:assert/strict";
import test from "node:test";
import { invokeWeeklyExport } from "../scheduler/index";

test("weekly scheduler posts the trigger secret and rejects failed exports", async () => {
  const requests: Request[] = [];
  await invokeWeeklyExport(
    {
      SIDEBET_EXPORT_URL:
        "https://sidebet.example/api/internal/notion-export",
      SIDEBET_EXPORT_SECRET: "scheduler-secret",
    },
    async (input, init) => {
      requests.push(new Request(input, init));
      return Response.json({ status: "succeeded" });
    },
  );

  const request = requests[0];
  assert.ok(request);
  assert.equal(request.method, "POST");
  assert.equal(request.headers.get("authorization"), "Bearer scheduler-secret");
  assert.equal(request.headers.get("content-type"), "application/json");

  await assert.rejects(
    invokeWeeklyExport(
      {
        SIDEBET_EXPORT_URL:
          "https://sidebet.example/api/internal/notion-export",
        SIDEBET_EXPORT_SECRET: "scheduler-secret",
      },
      async () => Response.json({ status: "partial" }, { status: 502 }),
    ),
    /failed with status 502/,
  );
});
