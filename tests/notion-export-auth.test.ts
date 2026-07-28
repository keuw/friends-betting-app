import assert from "node:assert/strict";
import test from "node:test";
import { isAuthorizedExportRequest } from "../lib/notion-export-auth";

test("internal export authorization requires the exact non-empty bearer secret", async () => {
  const request = (authorization?: string) =>
    new Request("https://sidebet.example/api/internal/notion-export", {
      method: "POST",
      headers: authorization ? { authorization } : {},
    });

  assert.equal(
    await isAuthorizedExportRequest(request(), "expected-secret"),
    false,
  );
  assert.equal(
    await isAuthorizedExportRequest(
      request("Bearer wrong-secret"),
      "expected-secret",
    ),
    false,
  );
  assert.equal(
    await isAuthorizedExportRequest(
      request("Bearer expected-secret"),
      "expected-secret",
    ),
    true,
  );
  assert.equal(
    await isAuthorizedExportRequest(request("Bearer "), ""),
    false,
  );
});
