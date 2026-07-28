import assert from "node:assert/strict";
import { readFile, readdir, stat } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

async function readClientBundle() {
  const clientAssetDirectory = new URL("dist/client/assets/", root);
  const clientAssetNames = await readdir(clientAssetDirectory);
  return (
    await Promise.all(
      clientAssetNames
        .filter((name) => name.endsWith(".js"))
        .map((name) => readFile(new URL(name, clientAssetDirectory), "utf8")),
    )
  ).join("\n");
}

async function readMigrations() {
  const migrationDirectory = new URL("../drizzle/", import.meta.url);
  const migrationNames = await readdir(migrationDirectory);
  return (
    await Promise.all(
      migrationNames
        .filter((name) => name.endsWith(".sql"))
        .sort()
        .map((name) => readFile(new URL(name, migrationDirectory), "utf8")),
    )
  ).join("\n");
}

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

test("market creators can participate in offers on their own markets", async () => {
  const serverBundle = await readFile(
    new URL("dist/server/index.js", root),
    "utf8",
  );
  const clientBundle = await readClientBundle();

  assert.match(clientBundle, /Market creators can place offers too/);
  assert.doesNotMatch(serverBundle, /ORACLE_CONFLICT/);
  assert.doesNotMatch(clientBundle, /cannot bet on a market you created/i);
});

test("parlay legs expose deadlines and the market picker stays manageable", async () => {
  const [serverBundle, clientBundle] = await Promise.all([
    readFile(new URL("dist/server/index.js", root), "utf8"),
    readClientBundle(),
  ]);

  assert.match(serverBundle, /marketClosesAt/);
  assert.match(clientBundle, /Search markets/);
  assert.match(clientBundle, /Selected legs/);
  assert.match(clientBundle, /Show more markets/);
  assert.match(clientBundle, /Up to 8 legs/);
});

test("All markets can be searched, filtered, and keeps its ledger order", async () => {
  const [serverBundle, clientBundle] = await Promise.all([
    readFile(new URL("dist/server/index.js", root), "utf8"),
    readClientBundle(),
  ]);

  assert.match(clientBundle, /Search all markets/);
  assert.match(clientBundle, /Question, context, outcome, creator, or status/);
  assert.match(clientBundle, /Filter markets by status/);
  assert.match(clientBundle, /Voided/);
  assert.match(clientBundle, /No matching markets/);
  assert.match(clientBundle, /Clear search and filters/);
  assert.match(
    serverBundle,
    /CASE m\.status WHEN 'open' THEN 0 WHEN 'resolved' THEN 1 ELSE 2 END/,
  );
  assert.match(serverBundle, /datetime\(m\.closes_at\) DESC/);
});

test("market and matched-bet edits preserve immutable revision history", async () => {
  const [serverBundle, clientBundle, migrations] = await Promise.all([
    readFile(new URL("dist/server/index.js", root), "utf8"),
    readClientBundle(),
    readMigrations(),
  ]);

  assert.match(migrations, /CREATE TABLE `market_revisions`/);
  assert.match(migrations, /CREATE TABLE `bet_revisions`/);
  assert.match(migrations, /CREATE TABLE `bet_revision_legs`/);
  assert.match(migrations, /bet_revisions_one_pending/);
  assert.match(migrations, /bet_revisions_one_active/);
  assert.match(serverBundle, /edit_market/);
  assert.match(serverBundle, /propose_bet_revision/);
  assert.match(serverBundle, /respond_bet_revision/);
  assert.match(serverBundle, /cancel_bet_revision/);
  assert.match(serverBundle, /MARKET_CHANGED/);
  assert.match(serverBundle, /BET_REVISION_STALE/);
  assert.match(clientBundle, /Edit market/);
  assert.match(clientBundle, /Propose change/);
  assert.match(clientBundle, /Revision history/);
  assert.match(clientBundle, /Accept revision/);
  assert.match(clientBundle, /Current terms stay active until your friend accepts/);
});
