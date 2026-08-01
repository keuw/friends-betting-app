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

async function readClientStyles() {
  const clientAssetDirectory = new URL("dist/client/assets/", root);
  const clientAssetNames = await readdir(clientAssetDirectory);
  return (
    await Promise.all(
      clientAssetNames
        .filter((name) => name.endsWith(".css"))
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

test("posted offers show their exact creation date and time", async () => {
  const clientBundle = await readClientBundle();

  assert.match(clientBundle, /Posted /);
});

test("All markets can be searched, filtered, and keeps its ledger order", async () => {
  const [serverBundle, clientBundle] = await Promise.all([
    readFile(new URL("dist/server/index.js", root), "utf8"),
    readClientBundle(),
  ]);

  assert.match(clientBundle, /Search all markets/);
  assert.match(clientBundle, /Question, context, outcome, creator, or status/);
  assert.match(clientBundle, /Filter markets by status/);
  assert.match(clientBundle, /Open for offers/);
  assert.match(clientBundle, /Closed · awaiting result/);
  assert.match(clientBundle, /Betting closed/);
  assert.match(clientBundle, /selected market is now closed/);
  assert.match(clientBundle, /Voided/);
  assert.match(clientBundle, /No matching markets/);
  assert.match(clientBundle, /Clear search and filters/);
  assert.match(clientBundle, /year:[`"']numeric[`"']/);
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

test("counteroffer recipients can decline without consuming the root offer", async () => {
  const [serverBundle, clientBundle] = await Promise.all([
    readFile(new URL("dist/server/index.js", root), "utf8"),
    readClientBundle(),
  ]);

  assert.match(serverBundle, /decline_counteroffer/);
  assert.match(serverBundle, /declined_counteroffer/);
  assert.match(serverBundle, /NOT_COUNTER_RECIPIENT/);
  assert.match(serverBundle, /COUNTER_STALE/);
  assert.match(serverBundle, /datetime\(mr\.closes_at\).*CURRENT_TIMESTAMP/);
  assert.match(serverBundle, /accepted_offer/);
  assert.match(clientBundle, /Decline/);
  assert.match(clientBundle, /Counter declined\. The original offer stays open\./);
});

test("parlay offers can explicitly Back or Fade with complementary role copy", async () => {
  const [serverBundle, clientBundle, migrations] = await Promise.all([
    readFile(new URL("dist/server/index.js", root), "utf8"),
    readClientBundle(),
    readMigrations(),
  ]);

  assert.match(migrations, /maker_position/);
  assert.match(serverBundle, /FADE_REQUIRES_PARLAY/);
  assert.match(serverBundle, /makerPosition/);
  assert.match(clientBundle, /Back this parlay/);
  assert.match(clientBundle, /Fade this parlay/);
  assert.match(clientBundle, /FADING PARLAY/);
  assert.match(clientBundle, /win if any listed pick misses/);
  assert.match(clientBundle, /win only if every non-void listed pick hits/);
  assert.match(clientBundle, /Back or fade the listed picks/);
});

test("offers and matched bets explain exact context, sides, and winning rules", async () => {
  const [serverBundle, clientBundle, clientStyles] = await Promise.all([
    readFile(new URL("dist/server/index.js", root), "utf8"),
    readClientBundle(),
    readClientStyles(),
  ]);

  assert.match(serverBundle, /market_description/);
  assert.match(clientBundle, /OFFER SIDES/);
  assert.match(clientBundle, /You if accepted/);
  assert.match(clientBundle, /Accept ·/);
  assert.match(clientBundle, /YOUR BET/);
  assert.match(clientBundle, /Your pick/);
  assert.match(clientBundle, /You win if/);
  assert.match(clientBundle, /Listed pick/);
  assert.doesNotMatch(clientBundle, /YOUR SIDE:/);
  assert.match(clientStyles, /\.market-context/);
  assert.match(clientStyles, /\.offer-side-summary/);
  assert.match(clientStyles, /\.personal-bet-summary/);
});

test("matched bets default to Pending and expose unambiguous status filters", async () => {
  const [clientBundle, clientStyles] = await Promise.all([
    readClientBundle(),
    readClientStyles(),
  ]);

  assert.match(clientBundle, /Filter matched bets by status/);
  assert.match(clientBundle, /All unresolved matched bets/);
  assert.doesNotMatch(clientBundle, /Pending \+ resolved · voided hidden/);
  assert.doesNotMatch(clientBundle, /value:`current`,label:`Current`/);
  assert.match(clientBundle, /Nothing in this view/);
  assert.match(clientBundle, /Showing .* of .* matched bets/);
  assert.match(clientStyles, /\.bet-ledger-tools/);
  assert.match(clientStyles, /\.bet-status-filters/);
  assert.match(clientStyles, /\.bet-ledger-empty/);
});

test("market creators can extend open deadlines and reopen closed markets safely", async () => {
  const [serverBundle, clientBundle, clientStyles, migrations] =
    await Promise.all([
      readFile(new URL("dist/server/index.js", root), "utf8"),
      readClientBundle(),
      readClientStyles(),
      readMigrations(),
    ]);

  assert.match(serverBundle, /reopen_market/);
  assert.match(serverBundle, /DEADLINE_CANNOT_SHORTEN/);
  assert.match(clientBundle, /Reopen market/);
  assert.match(clientBundle, /Expired offers stay expired/);
  assert.match(clientBundle, /Deadline extensions update .* open offer/);
  assert.match(clientBundle, /Originally posted under market v/);
  assert.match(clientStyles, /\.market-reopen-panel/);
  assert.match(clientStyles, /\.offer-deadline-extension/);
  assert.match(migrations, /original_market_revision_id/);
});

test("market deadline forms default to three months without shortening", async () => {
  const clientBundle = await readClientBundle();

  assert.match(clientBundle, /closing date starts/);
  assert.match(clientBundle, /editor starts at least three months/);
  assert.match(clientBundle, /new deadline starts three months/);
});

test("the score strip opens the signed-in user's live matched bets", async () => {
  const [clientBundle, clientStyles] = await Promise.all([
    readClientBundle(),
    readClientStyles(),
  ]);

  assert.match(clientBundle, /My live bets/);
  assert.match(clientBundle, /My live/);
  assert.match(clientBundle, /View .* of your live bets/);
  assert.match(clientBundle, /metric-action/);
  assert.match(clientBundle, /NO .* BETS/);
  assert.match(clientStyles, /\.metric-action/);
  assert.match(clientStyles, /\.metric-action:{1,2}after/);
});

test("mutual matched-bet voids preserve public history and require agreement", async () => {
  const [serverBundle, clientBundle, clientStyles, migrations] =
    await Promise.all([
      readFile(new URL("dist/server/index.js", root), "utf8"),
      readClientBundle(),
      readClientStyles(),
      readMigrations(),
    ]);

  assert.match(migrations, /CREATE TABLE `bet_void_requests`/);
  assert.match(migrations, /bet_void_requests_one_pending/);
  assert.match(serverBundle, /request_bet_void/);
  assert.match(serverBundle, /respond_bet_void/);
  assert.match(serverBundle, /cancel_bet_void/);
  assert.match(serverBundle, /BET_VOID_STALE/);
  assert.match(serverBundle, /Void History/);
  assert.match(clientBundle, /Request mutual void/);
  assert.match(clientBundle, /Agree and void bet/);
  assert.match(clientBundle, /Keep bet active/);
  assert.match(clientBundle, /Voided by mutual agreement/);
  assert.match(clientBundle, /Requests and responses stay public/);
  assert.match(clientBundle, /to void this bet/);
  assert.match(clientBundle, /Reason for requesting a void/);
  assert.match(clientBundle, /Visible to everyone in bet history/);
  assert.match(clientBundle, /characters used/);
  assert.match(clientBundle, /This bet stays active until/);
  assert.match(clientBundle, /Nothing changes because of this request unless/);
  assert.match(clientStyles, /\.void-request-field/);
  assert.match(clientStyles, /\.void-request-form-head/);
  assert.match(clientStyles, /\.void-request-reason-block/);
});

test("market creators receive a guarded permanent-delete flow with inactive-offer cleanup", async () => {
  const [serverBundle, clientBundle, migrations] = await Promise.all([
    readFile(new URL("dist/server/index.js", root), "utf8"),
    readClientBundle(),
    readMigrations(),
  ]);

  assert.match(migrations, /bet_revision_legs_market_idx/);
  assert.match(serverBundle, /delete_market/);
  assert.match(serverBundle, /deleted_market/);
  assert.match(serverBundle, /deleted_inactive_offer/);
  assert.match(serverBundle, /NOT_MARKET_CREATOR/);
  assert.match(serverBundle, /MARKET_IN_USE/);
  assert.match(clientBundle, /Delete market/);
  assert.match(clientBundle, /PERMANENT DELETE/);
  assert.match(clientBundle, /Permanently delete/);
  assert.match(clientBundle, /Audit receipts remain/);
  assert.match(clientBundle, /Complete inactive parlays/);
  assert.match(clientBundle, /Cannot delete:/);
});

test("weekly Notion export is protected, idempotent, and contains no committed token", async () => {
  const [serverBundle, migrations, schedulerConfig] = await Promise.all([
    readFile(new URL("dist/server/index.js", root), "utf8"),
    readMigrations(),
    readFile(new URL("wrangler.scheduler.jsonc", root), "utf8"),
  ]);
  const notionTokenPrefix = ["ntn", "_"].join("");

  assert.match(serverBundle, /\/api\/internal\/notion-export/);
  assert.match(serverBundle, /NOTION_EXPORT_SECRET/);
  assert.match(serverBundle, /Notion-Version/);
  assert.match(serverBundle, /2026-03-11/);
  assert.match(migrations, /CREATE TABLE `notion_bet_exports`/);
  assert.match(migrations, /CREATE TABLE `notion_export_runs`/);
  assert.match(migrations, /notion_export_runs_one_running/);
  assert.match(schedulerConfig, /0 17 \* \* SUN/);
  assert.doesNotMatch(serverBundle, new RegExp(`${notionTokenPrefix}[A-Za-z0-9]{20,}`));
  assert.doesNotMatch(schedulerConfig, /SIDEBET_EXPORT_SECRET"\s*:/);
});
