import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

test("production bundle contains the Sidebet public experience", async () => {
  const bundle = await readFile(new URL("dist/server/index.js", root), "utf8");

  assert.match(bundle, /Friendly wagers\./);
  assert.match(bundle, /Finally settled\./);
  assert.match(bundle, /Enter with ChatGPT/);
  assert.match(bundle, /Payments happen offline/);
  assert.match(bundle, /No deposits\. No wallet\. No payment processing\./);
  assert.match(bundle, /signin-with-chatgpt/);
  assert.doesNotMatch(bundle, /react-loading-skeleton|Your site is taking shape/);
});

test("production bundle contains social metadata and the share image", async () => {
  const bundle = await readFile(new URL("dist/server/index.js", root), "utf8");
  const image = await stat(new URL("public/og-sidebet.png", root));

  assert.match(bundle, /Sidebet — Friendly wagers, finally settled/);
  assert.match(bundle, /summary_large_image/);
  assert.match(bundle, /og-sidebet\.png/);
  assert.match(bundle, /#142018/);
  assert.ok(image.size > 100_000, "share image should be a finished raster asset");
});

test("production bundle includes both API routes and the D1 race guard", async () => {
  const [bundle, migration] = await Promise.all([
    readFile(new URL("dist/server/index.js", root), "utf8"),
    readFile(new URL("drizzle/0000_shiny_champions.sql", root), "utf8"),
  ]);

  assert.match(bundle, /\/api\/actions/);
  assert.match(bundle, /\/api\/state/);
  assert.match(migration, /CREATE UNIQUE INDEX `bets_offer_unique`/);
  assert.match(migration, /CREATE TABLE `offline_settlements`/);
});
