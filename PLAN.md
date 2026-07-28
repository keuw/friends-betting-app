# Sidebet — Implementation Plan

**Updated:** 2026-07-28
**Status:** Phase 11 complete and verified; Phase 10 remains planned and unapproved

## Product contract

Sidebet is a signed-in social betting board for friends. Users create event
markets, publish one-to-one bet offers, negotiate terms through immutable
counteroffers, and accept exactly one opponent per offer. The application
records real-world dollar obligations but never holds money, connects to a
payment provider, or verifies payments.

Every accepted bet, edit proposal, revision, and debt-settlement action is
visible to signed-in members.

## Locked mechanics

- Every root offer can create at most one matched bet.
- To bet the same proposition against several friends, publish several offers.
- Root offers and counteroffers reserve no funds.
- Offer terms use exact integer cents:
  - the original maker's maximum loss;
  - the opposing user's maximum loss;
  - the maker's selection or parlay proposition.
- American odds are derived for display; settlement uses the exact agreed
  amounts.
- Any signed-in user except the maker may accept a root offer.
- Any signed-in user except the maker may start a counteroffer branch.
- Only the recipient of the latest counteroffer may accept or counter it.
- Accepting any root or counteroffer atomically consumes the root offer and
  supersedes all other branches.
- The event creator acts as oracle and may resolve or void that event.
- Market ownership does not restrict betting participation: the creator may
  make, counter, or accept offers containing their own market.
- Creator participation and creator resolution remain visible in the public
  activity ledger so the friend group can audit the conflict of interest.
- Market and bet revisions are append-only. Editing creates a new version and
  never rewrites terms that another user previously saw or accepted.
- Every offer and matched bet points to the exact market revision used when its
  terms were created. Later market edits affect only new offers and explicitly
  approved bet revisions.
- Only the market creator may propose new market terms, and only while the
  current revision is open and before its betting deadline.
- A market revision is resolved independently, so a bet on an older revision
  is graded against that older revision's wording, outcomes, and result.
- Either participant may propose a matched-bet revision, but only the other
  participant may accept it.
- A matched-bet revision may change exact risk amounts and the selected
  straight/parlay legs. Participants and already-recorded history never change.
- The original matched-bet terms remain active until the other participant
  explicitly accepts the proposed revision.
- Bet revisions may be proposed and accepted only while the bet is pending and
  every proposed leg remains open before its own betting deadline.
- Accepted offers, counteroffers, market revisions, bet revisions, and their
  response history remain immutable.
- Market resolution creates a pairwise debt from loser to winner.
- Reciprocal debts net automatically in the display without rewriting history.
- The current debtor may mark an amount as paid offline.
- The creditor must confirm receipt before the displayed debt is reduced.
- Dollars are stored as integer cents; timestamps are stored in UTC.

## Parlay rules

- A maker may choose one selection from each of two or more markets.
- The maker wins only when every non-void leg wins.
- The opposing user wins as soon as one selected leg loses.
- Voided legs are removed from the parlay.
- If every leg is void, the matched bet is void and creates no debt.
- If unresolved legs remain and no leg has lost, the bet remains pending.
- Counteroffers may change money terms but not the selected legs.
- A bilateral matched-bet revision may replace the money terms and selected
  legs before any affected leg closes.

## Authentication and access

- Deploy publicly but require Sign in with ChatGPT before showing group data.
- Use dispatch-owned SIWC and the forwarded stable email identity.
- Keep all authorization checks on the server.
- Never expose raw identity emails in the public group feed.
- The first release is one shared friend group.

## Data model

### `users`

- `id`, unique `email`, `display_name`, `created_at`.

### `markets`

- `id`, `question`, `description`.
- `selection_a`, `selection_b`.
- `closes_at`.
- `current_revision_id`.
- `status`: `open`, `resolved`, or `void`.
- `winning_selection`: `a`, `b`, or null.
- `creator_user_id`, `created_at`, `resolved_at`.
- Current term fields remain a materialized view of `current_revision_id` for
  ledger search and backwards-compatible queries.

### `market_revisions`

- `id`, `market_id`, monotonically increasing `revision_number`.
- Immutable `question`, `description`, `selection_a`, `selection_b`, and
  `closes_at`.
- Independent `status`, `winning_selection`, and `resolved_at`.
- `editor_user_id`, required `change_note`, `created_at`.
- Unique `(market_id, revision_number)`.

### `offers`

- `id`, `maker_user_id`.
- `maker_risk_cents`, `taker_risk_cents`.
- `status`: `open`, `accepted`, `cancelled`, or `expired`.
- `accepted_by_user_id`, `accepted_counter_id`.
- `created_at`, `expires_at`, `accepted_at`.

### `offer_legs`

- `id`, `offer_id`, `market_id`, `market_revision_id`, `maker_selection`.
- Unique `(offer_id, market_id)`.

### `counteroffers`

- `id`, `root_offer_id`, `parent_counter_id`.
- `challenger_user_id`, `proposer_user_id`, `recipient_user_id`.
- `maker_risk_cents`, `taker_risk_cents`.
- `status`: `pending`, `accepted`, or `superseded`.
- `created_at`.

### `bets`

- `id`, unique `offer_id`.
- `maker_user_id`, `taker_user_id`.
- `maker_risk_cents`, `taker_risk_cents`.
- `accepted_counter_id`.
- `current_revision_id`.
- `status`: `pending`, `maker_won`, `taker_won`, or `void`.
- `accepted_at`, `settled_at`.

### `bet_revisions`

- `id`, `bet_id`, monotonically increasing `revision_number`.
- Immutable `maker_risk_cents`, `taker_risk_cents`.
- `proposer_user_id`, `recipient_user_id`.
- `status`: `active`, `pending`, `rejected`, `cancelled`, or `superseded`.
- `change_note`, `created_at`, `responded_at`.
- Unique `(bet_id, revision_number)`, with at most one `pending` and one
  `active` revision per bet.

### `bet_revision_legs`

- `id`, `bet_revision_id`, `market_revision_id`, `maker_selection`.
- Unique `(bet_revision_id, market_revision_id)`.

### `debts`

- `id`, unique `bet_id`.
- `debtor_user_id`, `creditor_user_id`.
- `amount_cents`, `created_at`.

### `offline_settlements`

- `id`, `debtor_user_id`, `creditor_user_id`.
- `amount_cents`.
- `status`: `pending`, `confirmed`, `rejected`, or `cancelled`.
- `proposed_at`, `responded_at`.

### `audit_events`

- `id`, `actor_user_id`, `action`, `entity_type`, `entity_id`.
- `metadata_json`, `created_at`.

## Race-condition contract

Acceptance uses the database as the sole arbiter:

1. Validate the immutable root/counter terms and participants.
2. Insert a bet through `INSERT ... SELECT` only while the root offer is open.
3. Enforce a unique constraint on `bets.offer_id`.
4. Update the root offer to accepted and supersede all counter branches in the
   same atomic database batch.
5. Exactly one concurrent request can create the unique bet. All losing requests
   return `409 OFFER_TAKEN` and change no data.

Offline settlement confirmation is idempotent and may transition only from
`pending` to `confirmed` or `rejected` once.

Market and matched-bet editing also use the database as the sole arbiter:

1. A market edit includes the revision the editor started from. It creates a
   new immutable revision only if that revision is still current, open, and
   before its deadline; stale editors receive `409 MARKET_CHANGED`.
2. A matched-bet proposal inserts one immutable pending revision. A partial
   unique index prevents competing pending proposals for the same bet.
3. Only the named recipient may accept or reject a pending bet revision; the
   proposer may cancel it.
4. Acceptance atomically revalidates that the bet is pending and every proposed
   market revision is still open before its deadline, activates the proposed
   revision, and supersedes the prior active revision.
5. Concurrent responses or a simultaneous market resolution produce one
   winning transition. Losing requests return a structured `409` and never
   alter active bet terms.

## Server surface

- `GET /api/state` — signed-in application snapshot.
- `POST /api/actions` with a validated discriminated action:
  - `create_market`
  - `edit_market`
  - `resolve_market`
  - `create_offer`
  - `create_counteroffer`
  - `accept_offer`
  - `cancel_offer`
  - `propose_bet_revision`
  - `respond_bet_revision`
  - `cancel_bet_revision`
  - `propose_offline_settlement`
  - `respond_offline_settlement`

Every mutation authenticates the user, validates ownership/recipient rules,
checks the current resource state, performs its atomic write, and records an
audit event.

## Execution checklist

### Phase 1 — Foundation and tests

- [x] Initialize the supported Sites TypeScript starter.
- [x] Start the local development server.
- [x] Replace the previous house-backed plan with this peer-to-peer contract.
- [x] Declare D1 in `.openai/hosting.json`.
- [x] Write domain tests for odds, parlay grading, pairwise netting, and action
  validation.
- [x] Define the typed schema and generate its first migration.
- [x] Add runtime schema initialization for local development.

Acceptance:

- Domain tests establish settlement and netting semantics before API work.
- Generated SQL contains all tables, constraints, and indexes.

### Phase 2 — Authenticated server behavior

- [x] Upsert signed-in users from SIWC identity.
- [x] Implement the state snapshot query.
- [x] Implement every action and authorization rule.
- [x] Implement single-winner concurrent acceptance.
- [x] Implement idempotent market and offline-payment settlement.
- [x] Validate route-level failure paths and structured error codes.

Acceptance:

- Anonymous writes return `401`.
- A market creator cannot bet on their own event.
- One root offer creates at most one bet.
- Settling a bet twice creates one debt.
- An unconfirmed offline payment never changes the net balance.

### Phase 3 — Friend-facing interface

- [x] Replace the starter with a branded public sign-in page.
- [x] Build the authenticated board around active offers, not generic dashboard
  chrome.
- [x] Build market creation and resolution.
- [x] Build straight/parlay offer composition.
- [x] Build counteroffer threads and acceptance.
- [x] Build My Bets, public activity, pairwise debts, and settlement
  confirmations.
- [x] Make the full workflow responsive, keyboard accessible, and clear about
  maximum loss.
- [x] Add a visible notice that Sidebet handles no payments and does not verify
  offline transfers.

Acceptance:

- A signed-in user can create a market and another can publish an offer on it.
- A third user can counter or accept exactly once.
- Resolving the market creates the correct public debt.
- Debtor proposal plus creditor confirmation reduces the net balance.

### Phase 4 — Verification and publishing

- [x] Run domain and rendered-output tests.
- [x] Run lint, strict type-checking, migration generation, and production build.
- [x] Inspect the packaged migration and Worker output.
- [x] Commit the exact validated source.
- [x] Publish the repository to the user's GitHub.
- [x] Save and deploy the exact validated Sites version publicly.
- [x] Inspect production deployment status and open the final URL.

Acceptance:

- All repository checks pass.
- The public URL loads and requires ChatGPT sign-in for group data.
- Source history and deployed source identify the same validated commit.

### Phase 5 — Impeccable UI polish

This phase follows the `pbakaus/impeccable` polish playbook. It preserves
Sidebet's existing screen-printed sports-zine identity and product behavior
while making the signed-in experience feel calmer, faster to scan, and more
consistent as an operating interface.

Evidence from the current surface:

- The signed-in hero occupies roughly 25rem before the primary betting
  workspace, which delays the main task.
- The palette is distinctive, but accent colors, hard shadows, rotations, and
  one-off radii need clearer semantic roles inside the application.
- Focus treatment is defined for only one form family rather than every
  interactive control.
- The tab bar and dense betting cards need stronger small-screen prioritization.
- The header logo currently points to the sign-out route, making a brand click
  an unexpected destructive navigation.
- There is no durable `DESIGN.md` recording the visual system for future
  contributors.

Implementation:

- [x] Create `DESIGN.md` with the incumbent visual direction, semantic color
  roles, typography, spacing, radius, border, shadow, motion, and responsive
  rules.
- [x] Normalize reusable CSS tokens and shared focus, hover, active, disabled,
  loading, error, and success states.
- [x] Compress the signed-in introduction into an operate-mode command header
  so the board and offer composer appear much earlier in the first viewport.
- [x] Make brand navigation safe, keep sign-out explicit, and improve header
  behavior at narrow widths.
- [x] Refine desktop and mobile tab navigation with clearer active state,
  consistent touch targets, and sticky access where it improves task flow.
- [x] Rebalance the offer composer and offer cards around proposition, maximum
  loss, odds, counter history, and primary action hierarchy.
- [x] Polish matched-bet, debt, settlement, market, loading, empty, error, and
  success states to the same visual quality floor.
- [x] Preserve expressive shadows and editorial texture on the persuasive
  landing page while reducing decorative noise in task-heavy signed-in views.
- [x] Verify keyboard focus, long names/questions, reduced motion, and layouts
  at mobile, intermediate, and wide breakpoints.
- [x] Run tests, lint, type-checking, and the production build.
- [x] Commit and push the exact verified source, then deploy a new public Sites
  version and verify the production URL.

Acceptance:

- The first actionable board content is visible without a long decorative
  scroll on common laptop and phone viewports.
- Color and typography communicate consistent meanings across every tab.
- Every interactive control has a visible keyboard focus state and an
  appropriate disabled/loading presentation.
- Long friend names and market questions do not break cards or navigation.
- No betting, counteroffer, settlement, authentication, or concurrency behavior
  changes.
- GitHub and the public deployment identify the same verified commit.

### Phase 6 — Creator participation

Allow a market creator to participate on either side of bets involving that
market. This changes the original oracle-conflict rule while preserving the
existing open-market checks, self-accept restriction, one-acceptor transaction,
immutable bet terms, and public audit history.

Implementation:

- [x] Add a failing production regression test proving the server no longer
  rejects creator participation and the interface advertises the new rule.
- [x] Remove the creator-only rejection from offer creation, counteroffers, and
  offer acceptance while preserving all market-state and participant checks.
- [x] Include open markets created by the viewer in the offer composer.
- [x] Add a clear `Create offer` action to each open market so its creator—or
  any friend—can jump directly into a preselected offer draft.
- [x] Replace the old oracle-conflict copy in the interface, README, and
  contributor-facing product rules with the new trust-based contract.
- [x] Run unit tests, the production regression suite, lint, strict type
  checking, migration generation, and the production build.
- [x] Exercise the local API with separate creator and friend identities to
  prove a creator can both publish an offer and take/counter a friend's offer
  on their own market.
- [x] Commit and push the verified source, publish a new Sites version, and
  verify the live workflow.

Acceptance:

- A creator can publish a straight bet or parlay containing a market they
  created.
- A creator can counter or accept another friend's offer on their market.
- A user still cannot accept their own root offer or bypass counteroffer
  recipient rules.
- Closed, resolved, void, or expired markets remain ineligible.
- Concurrent acceptance still produces exactly one matched bet.
- Creator-authored markets, offers, acceptances, and resolutions remain public
  in the signed-in activity ledger.

### Phase 7 — Leg deadlines and scalable market discovery

Make every parlay leg's betting deadline explicit and keep the offer composer
usable when the group has dozens or hundreds of open markets. The chooser stays
bounded instead of making the Board page grow indefinitely.

Interaction contract:

- Every draft leg, posted-offer leg, and matched-bet leg shows its market's
  betting close date and time.
- Open markets remain ordered by the earliest closing time first.
- The composer searches market questions, outcomes, and creator names.
- The first eight matching markets appear initially; `Show more` reveals the
  next eight without losing the search query or selected legs.
- Selected legs appear in a compact pinned bet slip above the market browser
  and can be removed there.
- The existing eight-leg server maximum is explained and enforced in the
  interface before submission.
- The desktop market browser remains height-bounded. Mobile uses progressive
  batches so the user does not fight a nested full-page scroll.

Implementation:

- [x] Add a failing production regression test for the per-leg closing-time
  contract and large-market discovery controls.
- [x] Add `marketClosesAt` to the offer-leg view contract and populate it from
  the existing `markets.closes_at` field; no schema migration is required.
- [x] Show a semantic `<time>` value on composer choices, selected legs, posted
  offers, and matched bets.
- [x] Add market search, match counts, eight-item progressive disclosure, and
  useful no-results copy.
- [x] Add a pinned selected-leg slip with removal controls and clear eight-leg
  limit feedback.
- [x] Tune desktop and mobile layouts without changing offer, parlay,
  counteroffer, settlement, or acceptance semantics.
- [x] Update the design documentation for bounded collection pickers.
- [x] Run tests, lint, strict type checking, migration generation, and the
  production build.
- [x] Exercise a local multi-market parlay through the API and verify each leg
  returns its own closing time.
- [x] Commit, push, publish a new Sites version, and verify the production URL.

Acceptance:

- Friends can see exactly when betting closes for each leg before and after an
  offer is matched.
- A long market list never makes the composer grow without a bound.
- Search and progressive disclosure work without clearing selected legs.
- Keyboard and touch users can search, choose, inspect, and remove legs.
- Existing eight-leg, earliest-expiry, atomic acceptance, and parlay grading
  rules continue to pass.

### Phase 8 — Searchable All markets ledger

Make the Markets ledger easy to scan independently from the Board composer.
The ledger uses the requested newest-closing-first order while the offer
composer keeps its separate earliest-closing-first workflow.

Interaction contract:

- `All markets` includes a search field covering question, description,
  outcomes, creator name, and status.
- A status filter offers `All`, `Open`, `Resolved`, and `Voided`, with counts
  and a visible pressed state.
- Search and status filters compose, so a query can be narrowed to one market
  state without clearing either control.
- Results update immediately without hiding the market creation form.
- The result count shows filtered and total market counts.
- Open markets appear before resolved and void markets.
- Within each status group, markets sort by betting close date descending.
- No-result copy explains how to clear or broaden the search.

Implementation:

- [x] Add a failing production regression test for All markets search, status
  filtering, and open-first descending close-date order.
- [x] Change the state query to order status groups with open first and
  `closes_at` descending within each group.
- [x] Add the ledger search input, status filter with counts, filtered result
  count, and no-results state.
- [x] Style the search affordance consistently with the Board market search and
  preserve responsive behavior.
- [x] Verify the Board composer still sorts eligible markets by earliest close
  date and all betting behavior remains unchanged.
- [x] Run tests, lint, strict type checking, migration generation, and the
  production build.
- [x] Exercise local state with multiple open and resolved markets to verify the
  exact order.
- [x] Commit, push, publish a new Sites version, and verify production.

Acceptance:

- Searching finds markets by any visible identifying field.
- Status filters correctly isolate open, resolved, and voided markets.
- Search and status filters work together and remain keyboard accessible.
- Clearing search restores the full ledger.
- Open markets always precede non-open markets.
- Later-closing open markets appear above earlier-closing open markets.
- Offer composition remains earliest-closing-first.

### Phase 9 — Versioned market and matched-bet editing

Allow friends to correct or renegotiate terms without erasing what anyone
originally saw or accepted. Market edits create independently resolvable
versions. Matched-bet edits remain proposals until the other participant
accepts, and no amendment can activate after an affected leg closes.

Interaction contract:

- Only a market's creator sees `Edit market` on its current open revision.
- The market editor is prefilled with current terms and requires a short change
  note explaining why the revision exists.
- Saving creates a new numbered revision; it never alters prior revisions.
- Market cards expose a public history view with timestamps, change notes, and
  field-level before/after values.
- Existing offers and bets display the exact market revision they use, even
  after the market's current terms change.
- Historical market revisions remain independently resolvable wherever an open
  offer or pending bet still references them.
- Either participant in a pending matched bet may choose `Propose change`.
- The proposal editor starts from the active revision and may change both risk
  amounts and the selected straight/parlay legs.
- The recipient sees an explicit old-versus-new diff and may accept or reject;
  the proposer may cancel while it remains pending.
- Until acceptance, every bet card and settlement calculation continues using
  the currently active revision.
- All friends may inspect original terms and every pending, accepted, rejected,
  cancelled, or superseded revision. Only the two participants may act.
- Editing controls disappear once the bet settles or any proposed leg reaches
  its deadline; stale open editors receive a clear conflict message.

Implementation:

- [x] Add failing domain, action-validation, migration, and production
  regression tests for immutable market snapshots, version-specific grading,
  bilateral bet edits, deadline rejection, and concurrent responses.
- [x] Add `market_revisions`, `bet_revisions`, and `bet_revision_legs`; add
  revision pointers to markets, offer legs, and bets with the required unique
  and partial indexes.
- [x] Generate and inspect a data migration that backfills one initial market
  revision per existing market and one active bet revision per existing bet
  without changing any current result, debt, or settlement.
- [x] Change offer creation and acceptance to lock exact market revision IDs;
  preserve older open offers on their original terms and validate their
  original revision deadlines.
- [x] Grade pending bets and create debts from the active bet revision and its
  version-specific market results.
- [x] Implement market editing with creator authorization, optimistic
  `baseRevisionId` checks, bounded terms, a required change note, and public
  audit events.
- [x] Implement propose, accept, reject, and cancel actions for bet revisions
  with participant authorization and database-enforced single-transition
  concurrency.
- [x] Extend the state contract with current revision IDs, market history, bet
  history, pending-response permissions, and exact revision terms.
- [x] Add the market edit form, public revision timeline, revision badges, and
  safe resolution controls for referenced historical revisions.
- [x] Add the matched-bet proposal editor, old-versus-new review, accept/reject
  controls, cancellation, stale-state feedback, and public revision timeline.
- [x] Update activity copy, `README.md`, `CONTRIBUTING.md`, and `DESIGN.md` to
  document append-only edits and bilateral approval.
- [x] Run unit tests, rendered-output tests, lint, strict type checking,
  migration generation, and the production build.
- [x] Exercise separate creator, maker, and taker identities locally to prove
  old market terms still settle correctly and a bet changes only after the
  counterparty accepts.
- [x] Commit and push the verified source, publish a new Sites version, and
  verify the production URL.

Acceptance:

- Editing a market never changes the terms shown on an existing offer or bet.
- A creator can inspect and resolve every market revision still referenced by
  an offer or pending bet.
- New offers use the newest market revision; older offers clearly identify
  their earlier revision.
- Either bet participant can propose new amounts and legs, but cannot accept
  their own proposal.
- Rejected, cancelled, stale, or unaccepted proposals never affect grading or
  debts.
- An accepted revision becomes active exactly once and remains permanently
  visible beside the original and all intermediate proposals.
- No bet can be amended after settlement, after any proposed leg closes, or
  after any proposed leg resolves or voids.
- Concurrent edit or response attempts resolve deterministically with no
  partial state and a structured conflict for the loser.
- Existing offer acceptance, counteroffer, parlay grading, settlement, search,
  authentication, and public-audit behavior continue to pass.

### Phase 10 — Decline counteroffers

Let the current counteroffer recipient end that negotiation branch without
accepting it or proposing another set of terms. Declining does not cancel the
root offer and does not affect unrelated counteroffers from other friends.

Interaction contract:

- The recipient of each latest pending counteroffer sees `Accept`, `Counter`,
  and `Decline`.
- No other user sees an enabled decline control for that counteroffer.
- Declining removes that counteroffer from the active negotiation list while
  leaving the root offer open for acceptance or future counteroffers.
- A declined counteroffer cannot later be accepted or countered.
- The action records a dedicated `declined_counteroffer` audit event. The
  existing terminal `superseded` storage state is reused, so no schema migration
  is required.
- If accept, counter, and decline requests race, exactly one transition wins;
  the others receive a structured stale-counter response and create no bet or
  follow-up counteroffer.

Implementation:

- [ ] Add failing action-parser and production regressions for the decline
  action, recipient-only control, and user-facing copy.
- [ ] Add `decline_counteroffer` to the action contract, parser, and server
  dispatcher.
- [ ] Implement an idempotent recipient-authorized decline transition with a
  dedicated public audit event.
- [ ] Add database guards so accepting or countering a counteroffer rechecks
  that exact counter is still pending inside the same atomic batch.
- [ ] Add a clearly secondary `Decline` button beside `Accept` and `Counter`,
  with disabled, success, and stale-state handling.
- [ ] Update the README and contributor invariants for the terminal decline
  behavior.
- [ ] Run unit tests, rendered-output tests, lint, strict type checking, and the
  production build.
- [ ] Exercise separate proposer and recipient identities locally, including a
  concurrent accept-versus-decline check.
- [ ] Commit and push the verified source, publish a new Sites version, and
  verify the production URL.

Acceptance:

- A counteroffer recipient can decline without matching a bet.
- Declining one counteroffer leaves the root offer and unrelated counteroffers
  open.
- The proposer cannot decline their own proposal.
- Declined terms cannot later be accepted or used as the parent of another
  counteroffer.
- Concurrent accept, counter, or decline requests never create partial or
  contradictory state.
- Existing offer acceptance, negotiation, market, bet, and settlement behavior
  continues to pass.

### Phase 11 — Weekly Notion matched-bet archive

Create a durable, human-readable archive outside the hosted Sidebet project.
One Notion data-source record represents one immutable Sidebet bet ID. Weekly
exports upsert the latest status, active terms, legs, and complete revision
history without duplicating records.

This archive is intentionally narrower than a restorable D1 backup. It
preserves matched-bet evidence for the friend group, but it does not replace
full exports of users, unmatched offers, debts, offline settlements, or every
audit event.

Architecture contract:

- Keep the existing Sites deployment and ChatGPT sign-in flow unchanged.
- Run the schedule from a small, separately deployed Cloudflare Worker in the
  owner's Cloudflare account.
- Configure the Cron Worker for `0 17 * * SUN` (Sunday at 17:00 UTC).
- The Cron Worker sends a `POST` request to a private internal endpoint on the
  Sites app using a high-entropy bearer secret.
- The Sites app reads matched bets from its existing D1 binding and writes them
  to Notion using an internal Notion connection.
- Store `NOTION_TOKEN` and `NOTION_EXPORT_SECRET` as encrypted Sites runtime
  secrets. Store the matching trigger secret only as an encrypted secret on
  the Cron Worker.
- Store the Notion data-source ID and export URL as runtime configuration, not
  source-code credentials.
- The Cron Worker never receives D1 credentials or the Notion token.
- The repository remains safe to keep public: no secret may be committed,
  included in build output, returned by an endpoint, or written to logs.

Notion record contract:

- Use `Sidebet Bet ID` as the stable external key and enforce idempotency in the
  exporter.
- Use a readable title containing the maker and taker display names.
- Store maker and taker display names, never identity email addresses.
- Store exact maker and taker risk amounts, status, matched time, optional
  settlement time, active revision number, leg count, and last export time.
- Render active straight/parlay legs with the frozen market-revision question,
  chosen outcome, revision number, close time, and result state.
- Render the complete matched-bet revision timeline with amounts, legs, change
  note, proposer and recipient display names, status, and response time.
- Include a link to the live Sidebet app.
- Keep the Notion database private unless the owner explicitly changes its
  workspace sharing settings.

Idempotency and failure contract:

- Add a `notion_bet_exports` table keyed by `bet_id` with the Notion page ID,
  canonical payload hash, last successful export time, and last error.
- Add a `notion_export_runs` table recording start/end times, status, scanned,
  created, updated, unchanged, and failed counts.
- Query all matched bets through a dedicated export query; do not reuse the
  friend-facing `LIMIT 100` state query.
- When a stored page ID is absent or stale, query Notion by exact
  `Sidebet Bet ID` before creating a page.
- Skip an update when the canonical payload hash is unchanged.
- Retry Notion `429` and retryable `5xx` responses with bounded exponential
  backoff and respect `Retry-After`.
- Prevent overlapping export runs with an expiring D1 lease. A stale lease may
  be reclaimed after a bounded timeout.
- A partially failed run records per-bet errors and returns a non-success
  outcome to the Cron Worker. The next run retries failed and missing bets.
- Re-running a completed week creates zero duplicate Notion records.

Security threat model:

- A forged trigger could exfiltrate friend-group data to an attacker-controlled
  destination or consume Notion quota. Mitigate with a fixed server-side
  destination, bearer-secret verification, `POST` only, no CORS permission,
  bounded run concurrency, and generic response bodies.
- A leaked Notion token could expose the connected workspace. Mitigate with a
  least-privilege internal connection shared only with the Sidebet archive,
  encrypted runtime secrets, redacted errors, and documented token rotation.
- A malicious bet title or change note could become active Notion content.
  Treat every field as plain rich text; never construct executable URLs,
  mentions, embeds, or raw HTML from bet data.
- A public repository could leak operational values. Add regression checks that
  committed configuration contains variable names only and never secret
  values.

Implementation:

- [x] Connect Notion and create a private `Sidebet Matched Bets Archive`
  database with the locked property schema.
- [x] Create a least-privilege Notion internal connection, share only the
  archive database with it, and configure its token through Sites runtime
  secrets.
- [x] Add failing unit and route tests for canonical export payloads, omission
  of emails, stable hashes, Notion create/update/unchanged behavior,
  pagination, retry handling, overlapping-run rejection, and secret
  authorization.
- [x] Add `notion_bet_exports` and `notion_export_runs` to the Drizzle schema
  and runtime schema initialization; generate and inspect a non-destructive D1
  migration.
- [x] Implement a dedicated matched-bet export query containing active terms,
  frozen legs, results, and the full immutable revision timeline without the
  UI query's 100-row limit.
- [x] Implement a typed Notion client pinned to API version `2026-03-11`, with
  bounded pagination, timeouts, retry/backoff, plain-text serialization, and
  redacted errors.
- [x] Implement idempotent per-bet page creation and updates keyed by
  `Sidebet Bet ID`, plus payload-hash skipping and export-run accounting.
- [x] Add `POST /api/internal/notion-export` with constant-time bearer-secret
  validation, an expiring D1 run lease, generic count-only responses, and no
  authenticated-user dependency.
- [x] Add `scheduler/index.ts` and `wrangler.scheduler.jsonc` for a separate
  Cloudflare Cron Worker that invokes the internal endpoint weekly and fails
  observably on non-success responses.
- [x] Add local scripts and documentation for testing the scheduled handler,
  rotating secrets, manually triggering a reconciliation, inspecting run
  history, and recovering after a partial export.
- [x] Run unit tests, rendered-output tests, lint, strict type checking,
  migration generation, the production build, and local scheduled-handler
  simulation.
- [x] Configure the Sites secrets and Notion data-source ID without exposing
  their values, deploy the verified app version, and perform an initial full
  backfill.
- [x] Re-run the export and verify every D1 bet ID has exactly one Notion
  record and the second run reports only unchanged records.
- [x] Deploy the Cron Worker to the owner's Cloudflare account, verify the
  weekly trigger is registered, manually test one invocation, and confirm its
  run appears in both Cloudflare logs and `notion_export_runs`.
- [x] Update `README.md` and `CONTRIBUTING.md` to distinguish the Notion
  matched-bet archive from a complete disaster-recovery backup.

Acceptance:

- Every matched bet has exactly one Notion record keyed by its Sidebet bet ID.
- A weekly run updates settled status or accepted bet revisions without
  duplicating the record.
- Active terms and the full revision history in Notion match the immutable D1
  records.
- No Notion record contains an identity email address or secret.
- An unauthorized or overlapping export request writes nothing.
- Temporary Notion throttling or service failure is recorded and retried on a
  later run without losing or duplicating matched bets.
- The Cron scheduler is owned independently from the Sites project and can
  invoke a manual reconciliation in addition to its weekly schedule.
- Existing authentication, betting, editing, settlement, and public-audit
  behavior remains unchanged.

## Required verification

```text
npm run test:unit
npm test
npm run lint
npm run typecheck
npm run db:generate
npm run build
```

## Release boundaries

- Sidebet never stores card, bank, Venmo, PayPal, or other payment credentials.
- Sidebet never initiates or verifies a transfer.
- “Paid offline” is only a mutually confirmed record between two users.
- The product must not claim that a wager or debt is legally enforceable.
- Legal eligibility depends on participant location and remains the users'
  responsibility before use.
