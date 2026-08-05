import assert from "node:assert/strict";
import test from "node:test";
import { isAdminEmail } from "../lib/admin-authorization";

test("matches configured admin emails exactly after normalization", () => {
  const configured =
    " first-admin@example.com, SECOND-ADMIN@EXAMPLE.COM , ,";

  assert.equal(isAdminEmail("first-admin@example.com", configured), true);
  assert.equal(isAdminEmail(" second-admin@example.com ", configured), true);
  assert.equal(isAdminEmail("second-admin@example.com.evil", configured), false);
  assert.equal(isAdminEmail("admin@example.com", configured), false);
});

test("does not grant admin access without a usable allowlist", () => {
  assert.equal(isAdminEmail("member@example.com", undefined), false);
  assert.equal(isAdminEmail("member@example.com", ""), false);
  assert.equal(isAdminEmail("", "member@example.com"), false);
});
