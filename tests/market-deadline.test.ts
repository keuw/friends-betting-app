import assert from "node:assert/strict";
import test from "node:test";
import { defaultMarketCloseDate } from "../lib/market-deadline";

test("defaults market closes to three calendar months in local time", () => {
  const now = new Date(2026, 7, 1, 14, 30, 45, 123);
  const result = defaultMarketCloseDate(now);

  assert.equal(result.getFullYear(), 2026);
  assert.equal(result.getMonth(), 10);
  assert.equal(result.getDate(), 1);
  assert.equal(result.getHours(), 14);
  assert.equal(result.getMinutes(), 30);
  assert.equal(result.getSeconds(), 45);
  assert.equal(result.getMilliseconds(), 123);
  assert.notEqual(result, now);
});

test("clamps three-month defaults at the target month end", () => {
  const now = new Date(2026, 10, 30, 9, 15);
  const result = defaultMarketCloseDate(now);

  assert.equal(result.getFullYear(), 2027);
  assert.equal(result.getMonth(), 1);
  assert.equal(result.getDate(), 28);
  assert.equal(result.getHours(), 9);
  assert.equal(result.getMinutes(), 15);
});

test("keeps an existing market deadline when it is later than the default", () => {
  const now = new Date(2026, 7, 1, 14, 30);
  const existingClose = new Date(2027, 0, 15, 18, 0);
  const result = defaultMarketCloseDate(now, existingClose);

  assert.equal(result.getTime(), existingClose.getTime());
  assert.notEqual(result, existingClose);
});

test("uses the three-month default when the existing deadline is earlier", () => {
  const now = new Date(2026, 7, 1, 14, 30);
  const existingClose = new Date(2026, 8, 1, 18, 0);
  const result = defaultMarketCloseDate(now, existingClose);

  assert.equal(result.getFullYear(), 2026);
  assert.equal(result.getMonth(), 10);
  assert.equal(result.getDate(), 1);
  assert.equal(result.getHours(), 14);
  assert.equal(result.getMinutes(), 30);
});
