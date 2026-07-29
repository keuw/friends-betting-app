# Sidebet — Implementation Plan

**Updated:** 2026-07-28
**Status:** Phase 12 complete and deployed; Phases 13 and 14 planned and
awaiting approval.

## Product contract

Sidebet is a signed-in social betting board for friends. Users create event
markets, publish one-to-one bet offers, negotiate terms through immutable
counteroffers, and accept exactly one opponent per offer. The application
records real-world dollar obligations but never holds money, connects to a
payment provider, or verifies payments.

Every accepted bet, edit proposal, revision, mutual-void request, and
debt-settlement action is visible to signed-in members.

## Locked mechanics

- Every root offer can create at most one matched bet.
- To bet the same proposition against several friends, publish several offers.
- Root offers and counteroffers reserve no funds.
- Offer terms use exact integer cents:
  - the original maker's maximum loss;
  - the opposing user's maximum loss;
  - the maker's selection or parlay proposition.
- Multi-leg selections define one AND proposition. `back` takes that
  proposition; `fade` takes its complement and wins when any selected leg
  misses. Fade is never modeled by reversing each leg.
- Counteroffers inherit the root Back/Fade position and negotiate money terms
  only. A matched-bet position changes only through a mutually approved,
  append-only revision.
- American odds are derived for display; settlement uses the exact agreed
  amounts.
- Any signed-in user except the maker may accept a root offer.
- Any signed-in user except the maker may start a counteroffer branch.
- Only the recipient of the latest counteroffer may accept or counter it.
- Accepting any root or counteroffer atomically consumes the root offer and
  supersedes all other branches.
- The event creator acts as oracle and may resolve or void that event.
- Only the market creator may permanently delete a market, and only when no
  offer or matched-bet history references any revision of it.
- Permanent deletion removes the unused market and all of its revisions from
  the board. It never cascades into offers, bets, debts, or their immutable
  history.
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
- Either participant may request that a pending matched bet be voided, but the
  bet stays active until the other participant explicitly agrees.
- A mutually voided bet is never deleted. Its frozen terms, reason, responses,
  and audit history remain visible, and it creates no debt.
- Final bets and their debts cannot be reversed through mutual void. Any future
  settled-bet correction requires a separate, explicitly designed debt-reversal
  workflow.
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

### `bet_void_requests`

- `id`, `bet_id`, `base_revision_id`.
- `requester_user_id`, `recipient_user_id`.
- Required `reason`.
- `status`: `pending`, `accepted`, `rejected`, `cancelled`, or `superseded`.
- `created_at`, `responded_at`.
- At most one `pending` mutual-void request per bet.

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

Mutual voiding follows the same single-winner transition model:

1. A request records the exact active bet revision, both participants, and the
   required reason without changing the bet.
2. Only the named recipient may accept or reject it; only the requester may
   cancel it.
3. Acceptance atomically rechecks that the bet is still pending on the recorded
   base revision, changes the bet to `void`, and supersedes any pending term
   revision.
4. Accepting a term revision or settling the bet supersedes an older pending
   mutual-void request.
5. A resolution-versus-void race produces exactly one final bet state. A mutual
   void creates no debt; a settlement that wins the race creates exactly one
   debt; the losing response returns a structured `409`.

Permanent market deletion also uses the database as the sole arbiter:

1. Eligibility requires the requesting user to own the market and zero
   `offer_legs` or `bet_revision_legs` references across every market revision.
2. Deletion removes the market revisions and market in one atomic D1 batch.
3. Offer creation racing with deletion has one winner: either the offer and its
   frozen leg persist, or the market disappears. The losing action returns a
   structured conflict and leaves no partial offer or orphaned revision.
4. Historical references block deletion regardless of whether their offer or
   bet is currently open, cancelled, expired, settled, or void.

## Server surface

- `GET /api/state` — signed-in application snapshot.
- `POST /api/actions` with a validated discriminated action:
  - `create_market`
  - `edit_market`
  - `delete_market`
  - `resolve_market`
  - `create_offer`
  - `create_counteroffer`
  - `accept_offer`
  - `cancel_offer`
  - `propose_bet_revision`
  - `respond_bet_revision`
  - `cancel_bet_revision`
  - `request_bet_void`
  - `respond_bet_void`
  - `cancel_bet_void`
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

- [x] Add failing action-parser and production regressions for the decline
  action, recipient-only control, and user-facing copy.
- [x] Add `decline_counteroffer` to the action contract, parser, and server
  dispatcher.
- [x] Implement an idempotent recipient-authorized decline transition with a
  dedicated public audit event.
- [x] Add database guards so accepting or countering a counteroffer rechecks
  that exact counter is still pending inside the same atomic batch.
- [x] Add a clearly secondary `Decline` button beside `Accept` and `Counter`,
  with disabled, success, and stale-state handling.
- [x] Update the README and contributor invariants for the terminal decline
  behavior.
- [x] Run unit tests, rendered-output tests, lint, strict type checking, and the
  production build.
- [x] Exercise separate proposer and recipient identities locally, including a
  concurrent accept-versus-decline check.
- [x] Commit and push the verified source, publish a new Sites version, and
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

### Phase 12 — Back or fade a parlay

Let an offer creator choose which side of a multi-leg parlay they want. The
selected legs always define one parlay proposition:

`parlay = leg 1 AND leg 2 AND ...`

`fade = NOT(parlay) = leg 1 loses OR leg 2 loses OR ...`

The app must never model a fade by creating reversed duplicate legs. Instead,
the immutable offer or bet revision records whether the original maker backs
or fades the selected parlay.

Position contract:

- Introduce a typed `ParlayPosition` with exactly `back` and `fade`.
- The offer composer displays a segmented `Back this parlay` / `Fade this
  parlay` selector only when two or more legs are selected.
- `Back this parlay` is always the default. Removing legs until only one
  remains resets the position to `back` before submission.
- A straight offer has no position selector. Its selected outcome continues to
  describe the original maker's side directly.
- The selected leg outcomes always describe the parlay being evaluated,
  regardless of which participant backs it.
- When the maker position is `back`, the maker wins only if every non-void leg
  wins; the taker wins as soon as any active leg loses.
- When the maker position is `fade`, the maker wins as soon as any active leg
  loses; the taker wins only if every non-void leg wins.
- Voided legs are removed. If every leg is void, the bet is void and creates no
  debt.
- If no leg has lost and an active leg is unresolved, the bet remains pending.
- A decisive loss settles immediately. Later leg results may update their
  display state but never reopen the result or alter the immutable debt.
- Voided legs never recalculate the manually agreed risk amounts. The winner
  receives the other participant's exact accepted maximum-loss amount.

Negotiation and revision contract:

- A root offer freezes the maker's Back/Fade position.
- Counteroffers inherit the root position and may negotiate risk amounts only.
  No position field is accepted from a counteroffer request.
- The acceptance action names the position the taker receives: a Fade root uses
  `Back this parlay`; a Back root uses `Fade this parlay`.
- Either matched-bet participant may propose changing Back/Fade as part of a
  complete bet revision.
- A proposed position change has no effect until the other participant accepts
  that exact append-only revision.
- Switching Back/Fade does not swap risk amounts. Maker and taker risks remain
  attached to those people unless the proposal explicitly changes them.
- A one-leg bet revision must use `back`; the selected leg continues to express
  the maker's desired straight-bet outcome.
- Existing offers and bet revisions are backfilled as `back`, preserving every
  historical and pending result.

Persistence and compatibility contract:

- Add `maker_position TEXT NOT NULL DEFAULT 'back'` with a `back`/`fade` check
  constraint to `offers` and `bet_revisions`.
- Do not duplicate the position on `bets` or `counteroffers`. The root offer is
  the source for acceptance, and `bets.current_revision_id` identifies the
  active matched-bet position.
- Keep the historical D1 `maker_selection` column names, but expose those
  values as parlay selections in new TypeScript and user-facing terminology.
- Extend runtime schema initialization with additive, idempotent column checks
  and generate the next non-destructive Drizzle migration.
- A missing position in a legacy `create_offer` request resolves to `back`.
- A missing position in a legacy matched-bet revision request inherits the
  current active revision so a stale browser cannot silently flip a Fade bet
  back to Back.
- Initial bet acceptance copies the root offer position into revision 1 inside
  the same atomic acceptance batch.

Interface and history contract:

- Open parlay offers show `BACKING PARLAY` or `FADING PARLAY` plus a sentence
  naming both winning conditions, for example: `Tony wins if any pick misses;
  the opponent wins if every pick hits.`
- Matched bets name both roles, for example: `Tony fades this parlay · Alex
  backs it`, alongside each person's exact maximum loss.
- Participant ribbons use `BACK` or `FADE` for parlays instead of the internal
  `maker`/`taker` labels.
- Current-versus-proposed revision summaries show the position on both sides.
- Revision history records explicit before-and-after role changes, such as
  `Tony: Back → Fade; Alex: Fade → Back`.
- Audit metadata for offer creation, initial acceptance, revision proposal, and
  revision acceptance contains the relevant immutable position without
  identity emails.
- The weekly Notion archive stores the active maker position, renders the
  natural-language winning rule, and includes position changes in revision
  history. Its canonical payload hash includes these values so existing pages
  update exactly once after deployment.

Integrity and threat model:

- Treat every client-supplied position as untrusted. The action parser and
  server accept only `back` or `fade`, and the server rejects `fade` when fewer
  than two distinct legs exist.
- Settlement reads the position from the active persisted bet revision, never
  from request payloads or UI state.
- Offer acceptance must atomically copy the root position with the frozen legs,
  risks, and market revisions; concurrent acceptance still creates at most one
  bet.
- Bet-revision acceptance must atomically recheck the pending revision,
  recipient, current active revision, open leg windows, and unresolved bet
  before activating a position change.
- Market resolution and revision acceptance races must produce one valid
  transition with no partial position, settlement, or debt state.
- Existing rows must never be interpreted as `fade` due to null, missing, or
  malformed data; the migration and read layer both preserve `back`.
- Notion failures must not affect D1 settlement. Export errors remain retryable
  through the existing run ledger and never expose secrets or identity emails.

Implementation:

- [x] Add failing domain truth-table tests for Back and Fade across all-hit,
  one-miss, pending, partially void, and all-void parlays; prove that one miss
  settles a Fade winner immediately and exact risk amounts remain unchanged.
- [x] Add failing parser and production D1 regressions for create-offer
  position validation, legacy defaults, counter inheritance, atomic initial
  revision persistence, Fade settlement debts, mutually approved position
  changes, stale revision responses, and resolution-versus-revision races.
- [x] Add `ParlayPosition` and position-aware offer, bet revision, state, and
  Notion export contracts in `lib/contracts.ts`, `lib/action-parser.ts`, and
  `lib/notion-export.ts`.
- [x] Refactor `lib/domain.ts` so grading first determines whether the selected
  parlay won, lost, remains pending, or is void, then maps that proposition
  result through the persisted maker position to `maker_won` or `taker_won`.
- [x] Add the two `maker_position` columns to `db/schema.ts`, `db/index.ts`,
  and the generated Drizzle migration with idempotent `back` compatibility for
  every existing row.
- [x] Update `lib/server.ts` create, accept, state-query, revision, audit, and
  settlement paths to persist and consume the immutable position while
  preserving the existing single-winner transaction guards.
- [x] Add the responsive, keyboard-accessible Back/Fade composer control and
  reset behavior in `app/BettingApp.tsx` and `app/globals.css`, including
  complete disabled, pending, success, error, and stale-state handling.
- [x] Update offer cards, acceptance calls to action, My Bets, proposed-term
  comparisons, participant ribbons, and revision history with explicit
  participant roles and winning-condition copy.
- [x] Extend `lib/notion-export-repository.ts`, `lib/notion-export.ts`, archive
  setup/reconciliation scripts, and their tests with active position, winning
  rule, and before/after revision history while preserving redaction and
  idempotent hashes.
- [x] Update `README.md`, `CONTRIBUTING.md`, and the top-level parlay invariants
  in this plan after implementation so contributors cannot model Fade by
  reversing each leg.
- [x] Run `npm run test:unit`, `npm test`, `npm run lint`,
  `npm run typecheck`, `npm run db:generate`, and `npm run build`; inspect the
  generated SQL and packaged Worker for an additive migration and no secrets.
- [x] Exercise separate maker and taker identities against a multi-leg Back
  offer, a multi-leg Fade offer, a money-only counteroffer, and a mutually
  approved position revision, including early settlement and void cases.
- [x] Commit and push the exact verified source, deploy a saved Sites version,
  verify the production D1 backfill and Notion reconciliation, then confirm the
  public app returns successfully with no new Worker errors.

Acceptance:

- A creator can post a multi-leg parlay while backing it or fading it.
- A friend accepting a Fade offer backs the selected AND proposition; they win
  only if every non-void leg hits.
- A Fade participant wins as soon as any active selected leg misses.
- Back and Fade are exact complements for every resolved, pending, and void
  truth-table case, so both participants can never win or lose simultaneously.
- Straight bets continue to behave exactly as before.
- Counteroffers cannot change position, while a matched-bet position changes
  only after explicit approval from the other participant.
- Existing offers, bets, debts, and revision histories preserve their original
  maker-backed meaning.
- Risk amounts stay attached to people and remain exact after voided legs or a
  mutually approved position switch.
- Every offer, bet, revision, audit entry, and Notion record makes both sides
  and their winning conditions unambiguous.
- Concurrent acceptance, revision, and resolution requests never create
  partial terms, contradictory results, or duplicate debts.
- Existing authentication, market editing, counteroffer decline, settlement,
  weekly export, and public-audit behavior continues to pass.

### Phase 13 — Mutually void a pending matched bet

Let either participant ask to end a pending matched bet when both friends
agree. This is an audited lifecycle transition to `void`, never deletion: the
offer, accepted terms, revisions, request reason, and responses remain visible
to the group.

Lifecycle contract:

- Only the maker or taker may request a mutual void, and the requester must
  provide a reason between 3 and 200 characters.
- A request names the other participant as its only recipient and captures the
  bet's exact `current_revision_id` as `base_revision_id`.
- At most one mutual-void request may be pending for a bet. Rejected,
  cancelled, accepted, and superseded requests remain immutable history, and a
  new request may be made only while the bet is still pending.
- The matched bet remains active while the request is pending. Its markets may
  still resolve, its outcome may settle, and a debt may still be created.
- Only the recipient may choose `accepted` or `rejected`. The requester may
  cancel a pending request but may not approve their own request.
- Rejection or cancellation leaves the bet and its active revision unchanged.
- Acceptance is allowed only while the bet remains pending on the captured base
  revision. It sets the bet status to `void`, records `settled_at`, and creates
  no debt.
- Accepted mutual voids never remove rows. The voided bet stays on Every
  matched bet with its final terms and full mutual-void history.
- Bets already won, lost, or void are final. This phase does not delete debts,
  reverse confirmed settlement history, or add corrections for a settled bet.

Revision and settlement interaction:

- A pending mutual-void request and a pending term revision may coexist because
  they ask different questions, but only one can win a conflicting response
  race.
- Accepting a term revision supersedes every pending void request tied to the
  old active revision. The participants must create a fresh request if they
  still want to void the newly accepted terms.
- Accepting a mutual void supersedes every pending term revision because final
  bets cannot activate new terms.
- Market settlement, including an all-leg market void, supersedes any pending
  mutual-void request after the bet leaves `pending`.
- Request creation and every response use conditional D1 writes, the partial
  unique pending-request index, the base revision, named participants, and bet
  status as server-side guards.
- Concurrent accept/reject/cancel responses produce one terminal request
  status. A concurrent market resolution or term-revision acceptance produces
  one valid bet transition, no partial history, and at most one debt.
- Repeated delivery of the already-recorded response by its authorized actor is
  idempotent; stale or conflicting responses return a structured `409`.

Interface and public-history contract:

- A participant sees `Request mutual void` only on a pending matched bet. The
  inline form explains that the current bet remains active until the friend
  agrees and requires the reason before submission.
- Every signed-in group member sees the pending request, its reason, requester,
  recipient, creation time, and the captured bet revision.
- The recipient sees `Agree and void bet` and `Keep bet`; the requester sees
  `Cancel request`. Controls expose disabled, busy, success, stale, and error
  states without optimistic final-state changes.
- The acceptance control clearly warns that agreement is final, produces no
  debt, and does not erase the record.
- Each matched-bet card exposes append-only `Void history` showing accepted,
  rejected, cancelled, and superseded requests with response times.
- An accepted request leaves the card visible with a `VOIDED` status, the
  unchanged active terms, and an explanation that the participants ended it by
  agreement.
- Audit events cover user-authored request, acceptance, rejection, and
  cancellation actions without identity emails or secrets; the immutable
  request row records automatic supersession.
- The controls remain keyboard accessible and readable on narrow screens, and
  the existing revision editor and participant ribbon remain unambiguous.

Persistence and archive contract:

- Add typed `BetVoidRequestStatus` and `BetVoidRequestView` contracts plus
  `request_bet_void`, `respond_bet_void`, and `cancel_bet_void` actions.
- Add a dedicated `bet_void_requests` table with participant, base-revision,
  status, reason, and timestamp constraints; do not overload term revisions or
  add a hard-delete endpoint.
- Add a partial unique index for one pending request per bet plus indexes for
  bet history and recipient response lookup.
- Runtime initialization and the generated Drizzle migration must be additive
  and idempotent. They must not rebuild `bets`, `bet_revisions`, or any table
  referenced by existing production foreign keys.
- The application snapshot returns complete void-request history for every
  displayed bet, with server-derived response and cancellation permissions.
- The weekly Notion archive includes a `Void History` property containing base
  revision, participants, reason, status, and timestamps. Canonical payload
  hashing includes this history so affected records update exactly once.
- Notion serialization redacts identity-like email strings from reasons and
  names, while an export failure remains isolated from betting and settlement.

Implementation:

- [x] Add failing parser tests for required reasons, exact accepted/rejected
  decisions, IDs, length bounds, and the three new action variants.
- [x] Add a failing production D1 test covering participant authorization,
  public request visibility, reject, cancel, accept, repeat delivery, one
  pending request, no debt after agreement, and final-bet rejection.
- [x] Add production race regressions for accept-versus-reject,
  mutual-void-versus-market-resolution, and mutual-void-versus-bet-revision
  acceptance, proving one final state and at most one debt.
- [x] Add `BetVoidRequestStatus`, state views, and action contracts in
  `lib/contracts.ts` and strict untrusted-input parsing in
  `lib/action-parser.ts`.
- [x] Add `bet_void_requests` to `db/schema.ts` and runtime initialization in
  `db/index.ts`; generate and inspect the next additive Drizzle migration.
- [x] Extend `lib/server.ts` state queries and mappings with full request
  history and server-derived capabilities for the current viewer.
- [x] Implement request, respond, cancel, supersession, idempotency, audit, and
  structured conflict paths with conditional D1 batches and base-revision
  guards.
- [x] Update market settlement and bet-revision acceptance so either transition
  supersedes stale pending mutual-void requests without changing completed
  history.
- [x] Build the inline request form, pending decision panel, response controls,
  accepted-void explanation, and append-only history in
  `app/BettingApp.tsx` and `app/globals.css`.
- [x] Extend the Notion export repository, canonical types, renderer, archive
  setup/reconciliation scripts, and unit tests with redacted `Void History`.
- [x] Update rendered-output and migration regressions plus `README.md`,
  `CONTRIBUTING.md`, and archive documentation to explain mutual void versus
  deletion and the settled-bet boundary.
- [x] Run `npm run test:unit`, `npm test`, `npm run lint`,
  `npm run typecheck`, `npm run db:generate`, and `npm run build`; inspect the
  generated SQL and packaged Worker for additive schema changes and no secrets.
- [x] Exercise separate maker, taker, and observer identities through request,
  reject, cancel, accept, stale revision, and resolution-race paths against the
  production-style D1 runtime.
- [x] Commit and push the exact verified source, deploy a saved Sites version,
  reconcile the Notion property and affected records, and verify the live app
  and Worker logs.

Acceptance:

- Either matched-bet participant can request a mutual void with a visible
  reason, and nobody else can create or answer that request.
- The other participant can agree or decline; the requester can cancel; exactly
  one concurrent response becomes final.
- A pending request never pauses or changes the bet.
- Mutual agreement changes a still-pending bet to `void`, creates no debt, and
  never deletes its accepted terms or history.
- A settled or otherwise voided bet cannot use this flow, and no existing debt
  can be erased through it.
- A term edit or market result that wins a race safely supersedes the stale
  request; a mutual void that wins safely supersedes the pending edit.
- Every signed-in member can audit the complete lifecycle in the app, and the
  weekly Notion record preserves the same redacted history.
- Existing authentication, offers, counteroffers, market editing, Back/Fade
  parlays, bet revisions, settlement, export, and public activity behavior
  continues to pass.

### Phase 14 — Permanently delete an unused market

Let market creators remove accidental, duplicate, or abandoned markets from
the board without weakening Sidebet's accepted-offer and matched-bet audit
history. “Delete” means the unused market and every one of its revisions leave
the database and application state; it does not mean erasing historical bets
or recursively deleting other users' records.

Eligibility contract:

- Only the market creator may delete the market. Other signed-in users receive
  `403 NOT_MARKET_CREATOR`, even if the market is otherwise unused.
- An open, resolved, or void market is eligible when no `offer_legs` row and no
  `bet_revision_legs` row references the market or any of its revisions.
- Reference checks include every offer and bet status. Cancelled or expired
  offers and won, lost, or void bets still represent public history and block
  deletion.
- This conservative definition is intentionally stronger than “no active
  bets.” If the market was ever used in an offer or matched-bet revision, it is
  historical rather than unused and cannot be hard-deleted.
- Editing a market does not make it ineligible by itself. An unused market may
  be deleted together with all of its immutable revisions.
- Deletion never removes or rewrites an offer, counteroffer, bet, bet revision,
  debt, offline settlement, or Notion matched-bet record.
- The action is irreversible. There is no automatic restore or undelete flow
  in this phase.

Interface contract:

- A creator-owned market card exposes `Delete unused market` only when the
  server reports that it has zero offer and bet references.
- Creator-owned ineligible cards explain the blocker using server-derived
  counts, for example `Cannot delete: used by 2 offers and 1 matched bet`.
- Selecting delete opens an inline destructive confirmation panel naming the
  market and explaining that every revision will be permanently removed.
- The final `Delete permanently` control is visually distinct from edit, void,
  and resolve actions. `Cancel` closes the panel without changing data.
- All destructive controls expose disabled and busy states. The client does not
  remove a card optimistically; it waits for the refreshed server snapshot.
- A successful deletion removes the card and updates All/Open/Resolved/Voided
  counts immediately. If a friend creates an offer first, the stale confirmation
  reports that the market is now in use and refreshes the protected card.
- The controls are keyboard accessible and remain usable on narrow screens.
- Deletion records a minimal `deleted_market` activity receipt with the actor,
  former market ID, question, revision count, and timestamp so the action is
  accountable without keeping the market on the board.

Server and race contract:

- Add a `delete_market` action accepting only a validated `marketId`; ownership
  and eligibility are always recomputed by the server.
- The application snapshot adds `offerReferenceCount`,
  `betReferenceCount`, `canDelete`, and a server-derived deletion blocker to
  each market view. These fields are advisory for UI only and never authorize
  deletion.
- The delete handler loads the market for clear `404`, ownership, and conflict
  errors, then performs conditional deletes that repeat the same ownership and
  zero-reference predicates inside the atomic D1 batch.
- The `deleted_market` receipt is inserted with the same eligibility predicate
  inside that batch, so a failed or stale deletion cannot leave a false audit
  event.
- Delete `market_revisions` before `markets` to satisfy existing foreign keys.
  Do not add `ON DELETE CASCADE` and do not disable foreign-key enforcement.
- A concurrent offer or bet-revision insert that commits first causes deletion
  to return `409 MARKET_IN_USE`. A deletion that commits first makes the stale
  leg insertion fail atomically with a structured market-changed response and
  no root offer, leg, or audit fragment.
- Concurrent repeated deletes are idempotent only for the request that removed
  the market. Later requests receive `404 MARKET_NOT_FOUND`; they never report
  success for an unknown target.
- Concurrent edit or resolution requests either complete before deletion and
  are removed with the still-unused market, or lose to deletion and return a
  structured stale/not-found response.
- Existing foreign-key constraints are the final integrity backstop. Any
  unexpected reference aborts the full deletion batch.

Persistence and compatibility contract:

- This phase adds no new database table or column. Eligibility derives from the
  existing indexed `offer_legs.market_id` and
  `bet_revision_legs.market_id` relationships.
- Add an index on `bet_revision_legs.market_id` only if query-plan inspection
  shows the existing revision index cannot serve the eligibility query; any
  generated migration must remain additive and non-destructive.
- Runtime schema initialization must mirror any added index with
  `CREATE INDEX IF NOT EXISTS`.
- Historical Notion exports require no deletion or schema change because an
  eligible market cannot appear in a matched bet. Weekly export behavior must
  remain unchanged.
- Documentation distinguishes permanent deletion of a never-used market from
  voiding a market result and mutually voiding a matched bet.

Threat model:

- Treat client `canDelete` values, displayed counts, market status, and
  ownership as untrusted. The server derives all authorization and reference
  checks directly from D1 at mutation time.
- Never accept cascade, force, actor, or reference-count fields from the
  request payload.
- Protect against time-of-check/time-of-use races by repeating the eligibility
  predicate in the delete statements rather than relying on the earlier state
  snapshot.
- Do not expose identity emails, SQL errors, or raw foreign-key details in
  conflict responses or the deletion activity receipt.
- A malformed, unauthorized, stale, or in-use deletion request changes no
  market, revision, offer, bet, debt, export, or audit history.

Implementation:

- [x] Add failing parser tests proving `delete_market` requires one bounded
  `marketId`, returns only typed action fields, and cannot be authorized by
  client-supplied ownership, force, or reference-count overrides.
- [x] Add failing production D1 tests for creator-only deletion across open,
  resolved, void, and multi-revision unused markets, including full removal
  from every viewer's state.
- [x] Add production blockers for open, cancelled, expired, and accepted
  offers plus pending, won, lost, and void matched bets, proving every
  historical reference preserves the market.
- [x] Add offer-creation-versus-deletion, edit-versus-deletion,
  resolution-versus-deletion, and repeated-deletion race regressions proving
  one coherent result and no partial offer or orphaned revision.
- [x] Add the `DeleteMarketAction` contract and market deletion capability
  fields in `lib/contracts.ts`, then parse the action in
  `lib/action-parser.ts`.
- [x] Extend `lib/server.ts` market-state queries with distinct offer and bet
  reference counts plus server-derived `canDelete` and blocker text.
- [x] Implement conditional creator-only revision and market deletion,
  structured `MARKET_IN_USE` handling, race-safe stale-offer handling, and the
  minimal `deleted_market` audit receipt.
- [x] Inspect D1 query plans for both reference checks; add only the missing
  additive index to `db/schema.ts`, `db/index.ts`, and a generated migration if
  the current indexes are insufficient.
- [x] Add the eligibility explanation and two-step destructive confirmation to
  `app/BettingApp.tsx`, with responsive styles in `app/globals.css`.
- [x] Update rendered-output regressions, `README.md`, `CONTRIBUTING.md`, and
  market documentation with the exact deletion boundary and conflict errors.
- [x] Run `npm run test:unit`, `npm test`, `npm run lint`,
  `npm run typecheck`, `npm run db:generate`, and `npm run build`; inspect any
  generated migration and the packaged Worker for destructive SQL, disabled
  foreign keys, or secrets.
- [x] Exercise creator, non-creator, and observer identities against eligible
  and protected markets in the production-style D1 runtime.
- [x] Commit and push the exact verified source, deploy a saved Sites version,
  and verify successful deletion plus every protected-state conflict on the
  live app without changing the Notion archive.

Acceptance:

- A market creator can permanently delete their unused market regardless of
  whether it is open, resolved, void, or has multiple unreferenced revisions.
- The deleted market and all of its revisions disappear from D1-backed
  application state for every user, and the All markets counts shrink.
- Nobody else can delete it, and client-supplied state cannot bypass the
  server's ownership or reference checks.
- Any offer or matched-bet reference of any status protects the market and its
  frozen revision history from deletion.
- Offer creation and deletion races produce either one complete offer with its
  market or one complete deletion with no offer; partial records are
  impossible.
- The UI clearly distinguishes deleting an unused market, voiding a market
  result, and mutually voiding a pending matched bet.
- Existing authentication, offers, counteroffers, market editing and
  resolution, Back/Fade parlays, mutual bet revisions, debt settlement, Notion
  export, and public activity behavior continues to pass.

### Phase 15 — Delete markets after terminal unmatched offers

Relax Phase 14's conservative offer-history blocker so friends can clean up
markets whose only offer references are cancelled or expired. The deletion
remains creator-initiated and permanent; Sidebet does not automatically prune
markets. Open offers and every matched bet continue to preserve the market and
its immutable terms.

Eligibility contract:

- Only the market creator may delete the market.
- An open offer using any revision of the market blocks deletion.
- Any matched bet using any revision of the market blocks deletion, regardless
  of whether the bet is pending, maker-won, taker-won, mutually voided, or
  otherwise final. A settled bet is therefore always protected.
- Accepted offers are protected through their matched bet. An accepted offer
  without a corresponding bet is treated as inconsistent protected data and
  must fail closed rather than be cleaned up.
- Cancelled and expired offers do not block deletion when they have no matched
  bet. Their terminal status must be rechecked in D1 during the mutation.
- Market status is independent of deletion eligibility: open, resolved, and
  void markets all follow the same reference rules.
- This phase changes only manual deletion eligibility. It does not
  automatically remove old markets or allow one user to delete a friend's
  market.

Inactive-offer cleanup contract:

- Deleting a market also permanently removes every unmatched root offer in
  `cancelled` or `expired` status that references it, together with all of that
  offer's `offer_legs` and `counteroffers`.
- A parlay is one indivisible offer. If a terminal unmatched parlay references
  several markets, deleting any one of those markets removes the complete
  inactive parlay and its counteroffer thread from all market views. Sidebet
  must never retain or display a silently shortened parlay.
- Before removing those rows, write an immutable
  `deleted_inactive_offer` tombstone containing the root offer ID, terminal
  status, non-secret terms, leg count, triggering market ID, and deletion
  operation ID. Existing audit events remain append-only.
- The market's `deleted_market` receipt records the number of terminal offers
  removed in the same operation in addition to the existing question and
  revision count.
- Never delete an accepted offer, bet, bet revision, bet leg, void request,
  debt, offline settlement, or Notion export. Any such reference aborts the
  operation.

State and interface contract:

- Preserve `offerReferenceCount` as the total reference count for compatibility
  and add explicit active and removable-terminal offer counts to `MarketView`.
- Derive `canDelete` from creator ownership, zero active or otherwise
  non-terminal offer references, and zero matched-bet references. Client counts
  are explanatory only.
- Creator-owned blocked cards say whether open offers, matched bets, or both
  protect the market. Cancelled and expired offers no longer appear as blockers.
- Rename the control from `Delete unused market` to `Delete market` because a
  deletable market may now have terminal offer history.
- The confirmation panel reports how many cancelled or expired offers and
  counteroffer threads will also be removed. For a multi-market parlay, it
  explicitly says the complete inactive parlay disappears from every market.
- The client waits for the refreshed server snapshot and never optimistically
  removes markets or offers.

Atomicity and race contract:

- Load the market and candidate terminal offer IDs for clear authorization and
  conflict errors, but repeat every eligibility condition inside one D1 batch.
- Use an operation-scoped audit gate inside the batch. Candidate tombstones,
  counteroffer deletion, offer-leg deletion, root-offer deletion, market
  revision deletion, and market deletion execute only when that gate proves
  creator ownership, zero protected offer references, and zero bet references.
- The tombstones form the exact candidate set used by later statements, so the
  implementation does not depend on a large client-bound `IN` list and cannot
  partially shorten a parlay.
- Delete counteroffers before offer legs, root offers after their children,
  market revisions after all eligible offer legs, and the market last to
  satisfy current foreign keys without disabling enforcement or adding broad
  cascades.
- If an open offer, accepted offer, or bet reference wins a race, deletion
  returns `409 MARKET_IN_USE` and changes no market, offer, counteroffer, or
  audit record.
- If deletion wins, a concurrent stale offer creation fails atomically with the
  existing structured market-changed response and leaves no root offer, leg, or
  audit fragment.
- Cancellation or expiration racing with deletion may make the first deletion
  return a retryable conflict, but must never create partial cleanup. A retry
  against the refreshed state may then delete the market.

Persistence and compatibility contract:

- Prefer the existing tables and append-only `audit_events` as operation-scoped
  tombstones; add no migration unless query-plan or integrity testing proves a
  schema change is necessary.
- Continue using the indexed `offer_legs.market_id`,
  `offers.status`, and `bet_revision_legs.market_id` paths; inspect production
  D1 query plans before deciding whether another additive index is warranted.
- The weekly Notion archive is unchanged because every matched bet blocks
  market deletion. Terminal unmatched offers are outside the matched-bet
  export.
- Update README and contribution guidance so nobody reintroduces the Phase 14
  rule that cancelled and expired offers block forever.

Threat model:

- Treat all client capability flags, statuses, counts, offer IDs, actor IDs, and
  cleanup claims as untrusted. The request continues to accept only `marketId`.
- Never permit a client-supplied force, cascade, cleanup list, status, or
  reference count.
- Fail closed on accepted offers without bets, unknown offer statuses,
  unexpected foreign-key references, missing candidate tombstones, or a final
  market delete that does not affect exactly one row.
- Do not expose user emails, SQL errors, or raw foreign-key details in the
  activity receipt or conflict response.
- Audit metadata may preserve public betting terms and IDs but must not contain
  authentication data, service secrets, or external payment information.

Implementation:

- [x] Replace the cancelled/expired blocker assertions with failing production
  D1 tests proving both statuses become deletable while open offers remain
  protected.
- [x] Add failing tests proving pending, won, lost, mutually voided, and settled
  matched bets still block deletion and preserve all offer and bet history.
- [x] Add a terminal multi-market parlay test proving deletion removes the
  whole inactive offer and counteroffer thread while leaving unrelated markets
  intact and eligible state recalculated.
- [x] Add mixed-reference and race regressions proving an open or accepted
  offer rolls back terminal-offer cleanup, cancellation/expiration races are
  retry-safe, and create-offer-versus-delete remains atomic.
- [x] Extend `MarketView` and server row types with total, active/protected, and
  removable terminal offer counts while preserving the existing total count.
- [x] Update the market-state query, `canDelete`, and blocker text to ignore
  unmatched cancelled/expired offers without weakening matched-bet checks.
- [x] Implement the operation-gated D1 cleanup batch, immutable inactive-offer
  tombstones, child-first deletion ordering, final market deletion, and
  structured conflict handling.
- [x] Update the market card control, warning copy, confirmation details,
  success message, responsive states, and rendered-output regressions.
- [x] Update `README.md` and `CONTRIBUTING.md` with the new eligibility,
  multi-market parlay cleanup, audit, and race boundaries.
- [x] Inspect D1 query plans and generated schema output; add an additive index
  only if the existing indexes are insufficient.
- [x] Run `npm run test:unit`, `npm test`, `npm run lint`,
  `npm run typecheck`, `npm run db:generate`, and `npm run build`; inspect the
  packaged Worker for destructive SQL, disabled foreign keys, or secrets.
- [x] Exercise separate creator, non-creator, and observer identities against
  open-offer, cancelled-offer, expired-offer, matched-bet, and multi-market
  parlay cases in the production-style D1 runtime.
- [x] Commit and push the exact verified source, deploy a saved Sites version,
  and verify the new cleanup boundary on the live app without changing matched
  bets or the Notion archive.

Acceptance:

- A creator can delete a market whose only offer references are cancelled or
  expired, and every other viewer receives the same refreshed state.
- The deletion removes the market, its revisions, and the complete terminal
  unmatched offers that referenced it, including their legs and counteroffers.
- An inactive multi-market parlay is removed as a whole; it is never rewritten
  into a different bet.
- Open offers and all matched-bet history, including final and settled bets,
  continue to block deletion.
- Any authorization failure, protected reference, stale candidate set, or race
  leaves the database unchanged and returns a structured error.
- Public audit receipts explain which market and inactive offers were removed
  without exposing credentials or weakening existing history.
- Existing authentication, market editing and resolution, Back/Fade parlays,
  counteroffers, matched-bet revisions and voiding, debt settlement, weekly
  Notion export, and public activity behavior continues to pass.

### Phase 16 — Distinguish betting close from market resolution

Make the market lifecycle explicit and show complete dates. Passing the betting
deadline stops new offers but does not resolve the market; the creator still
records the outcome later.

Lifecycle contract:

- `Open for offers` means the stored market status is `open` and `closesAt` is
  in the future.
- `Closed · awaiting result` means the stored market status is still `open` but
  `closesAt` has passed.
- `Resolved` means the creator recorded selection A or B as the result.
- `Voided` means the creator recorded that the market has no winning
  selection.
- Closing is derived from the immutable betting deadline and current time. Do
  not add a second persisted `closed` status or automatically resolve a market.
- The server remains authoritative: after `closesAt`, it rejects new offers and
  counteroffers even if a stale client still displays an old state.
- Existing offers expire when their earliest leg closes. Matched bets remain
  pending until every required market is resolved or voided.

Date presentation contract:

- Every absolute betting-close timestamp includes month, day, four-digit year,
  hour, and minute in the viewer's local timezone.
- Apply the same year-bearing formatter to market cards, offer legs, matched-bet
  legs, revision history, and old-versus-new deadline comparisons so a date is
  never ambiguous between years.
- Preserve exact ISO timestamps in state and actions; this is a presentation
  change only and must not rewrite stored deadlines.
- Relative activity labels may remain relative, but any displayed absolute
  timestamp includes its year.

Markets-tab filter and card contract:

- Replace the ambiguous `Open` filter label with `Open for offers`.
- Add a separate `Closed · awaiting result` filter between open and resolved.
- Keep `All`, `Resolved`, and `Voided`; every filter shows a count computed
  from the same lifecycle classification used for its results.
- Search recognizes `open`, `open for offers`, `closed`, `awaiting result`,
  `resolved`, `void`, and `voided`.
- Market cards use lifecycle badges rather than showing `open` for a deadline
  that has already passed.
- An open-for-offers card says `Closes …` and may show offer controls. A
  closed-unresolved card says `Betting closed …`, hides offer controls, and
  makes clear that the creator still needs to resolve it.
- Editing terms remains available only before betting closes. Resolution
  remains a separate creator action for open-for-offers or
  closed-awaiting-result markets.
- The lifecycle display advances while the page remains open using a small
  shared clock tick; a reload is not required when a deadline passes.

Ordering contract:

- `All markets` orders lifecycle groups as Open for offers, Closed awaiting
  result, Resolved, then Voided.
- Within each group, preserve the requested close-date-descending order and use
  creation time as the final stable tie-breaker.
- The Board offer composer remains separate: it includes only open-for-offers
  markets and keeps its earliest-closing-first order.

Implementation:

- [x] Add failing unit tests for lifecycle classification immediately before,
  at, and after `closesAt`, including resolved and void precedence.
- [x] Extend market-ledger tests for the new closed-awaiting-result filter,
  counts/search vocabulary, lifecycle group order, and deterministic injected
  current time.
- [x] Add rendered-output regressions for four-digit years, `Open for offers`,
  `Closed · awaiting result`, `Betting closed`, and hidden post-close offer
  controls.
- [x] Add a typed lifecycle helper shared by filtering, sorting, status copy,
  counts, and card capabilities rather than duplicating date comparisons.
- [x] Extend `MarketLedgerFilter` and the Markets-tab filter controls with the
  derived closed-awaiting-result state and unambiguous labels.
- [x] Update market badges, deadline copy, offer-control visibility, edit
  capability, empty-state copy, and status search terms.
- [x] Add the lightweight UI clock tick and ensure it does not discard search,
  filters, form input, selected offer legs, or other local state.
- [x] Add `year: "numeric"` to the shared absolute date formatter and audit
  every `closesAt` rendering path for use of that formatter.
- [x] Update `README.md` and `CONTRIBUTING.md` with the close-versus-resolution
  lifecycle and the server-authoritative offer cutoff.
- [x] Run `npm run test:unit`, `npm test`, `npm run lint`,
  `npm run typecheck`, and `npm run build`; verify there is no persistence
  migration and no regression to server deadline enforcement.
- [x] Exercise future-open, past-unresolved, resolved, and void markets in the
  production-style D1 runtime and confirm filter counts and offer rejection.
- [x] Commit and push the exact verified source, deploy a saved Sites version,
  and verify the year-bearing dates and all five filters on the live app.

Acceptance:

- No market, offer leg, bet leg, or revision view displays a close date without
  its year.
- A market whose deadline passed but has no recorded result is visibly closed
  to offers and remains visibly unresolved.
- The Markets tab independently filters All, Open for offers, Closed awaiting
  result, Resolved, and Voided markets with correct counts and ordering.
- New-offer controls disappear at the deadline, and the server still rejects a
  stale or forged post-close request.
- Closing never invents a result, changes a matched bet, creates a debt, or
  prevents the creator from resolving or voiding the market later.
- Existing authentication, deletion eligibility, offers and counteroffers,
  market revisions, parlays, mutual bet edits and voids, debt settlement,
  Notion export, and public activity behavior continues to pass.

### Phase 17 — Polish the mutual-void request UI

Make the matched-bet mutual-void workflow feel like one deliberate, trustworthy
agreement surface. Fix the misaligned reason field and give both the request
composer and pending-request panel a clearer visual hierarchy without changing
who may request, respond to, or cancel a void.

Visual and content contract:

- Present the request composer as a compact inset agreement card with a clear
  `REQUEST MUTUAL VOID` eyebrow, an action-oriented title naming the other
  participant, and one concise explanation that the bet remains active until
  both sides agree.
- Give the reason its own full-width field group. The visible label, public
  history helper, textarea, and live `0 / 200` character count align to the
  same card width; the textarea never inherits inline label sizing or overflows
  its parent.
- Use the existing paper, coral-danger, ink, line, radius, and focus tokens.
  The form receives one border-based elevation signal and no decorative shadow.
- Separate explanatory content from the form field with spacing rather than
  extra boxes. Keep the finality/no-debt message visible but secondary.
- Use outcome-specific action labels: `Send void request` is primary and
  `Cancel` is secondary. Do not style cancellation as agreement to keep the
  bet.
- Restyle the public pending-request panel as the read-only counterpart to the
  composer: requester/recipient and status in the header, the reason in a
  legible quote block, the captured revision and active-until-agreed rule in a
  compact notice, then the existing response controls.

Interaction, responsive, and accessibility contract:

- Preserve the existing 3–200 character validation, server action payloads,
  permissions, busy handling, success messages, and audited history exactly.
- Connect the textarea to an explicit label and helper with stable IDs and
  `aria-describedby`; expose the character count without creating noisy live
  announcements on every keystroke.
- The sender sees the other participant's name in the title. All signed-in
  friends continue to see the public pending request, while only the recipient
  or requester receives their existing allowed controls.
- At narrow widths, the header stacks cleanly, the reason remains full width,
  and every action becomes a 44px-high full-width control in logical keyboard
  order. Long names and reasons wrap without widening the matched-bet card.
- Focus-visible, hover, disabled, and busy states continue using the existing
  application behavior and remain readable on the danger-tinted surface.

Implementation:

- [x] Add rendered-output regressions for the explicit reason label/helper,
  character count, participant-specific title, pending reason block, and
  active-until-agreed notice.
- [x] Refactor only the mutual-void composer and pending proposal markup in
  `app/BettingApp.tsx`, keeping request/response actions and state transitions
  unchanged.
- [x] Add scoped mutual-void field, header, reason, notice, and footer styles in
  `app/globals.css`; do not alter shared form controls in ways that affect
  market, offer, revision, or settlement forms.
- [x] Add the mobile stacking rules to the existing `680px` breakpoint and
  confirm the textarea and buttons fit the narrowest supported card.
- [x] Confirm `DESIGN.md` already covers the mutual-agreement pattern; no new
  design-system rule is required.
- [x] Run `npm run test:unit`, `npm test`, `npm run lint`,
  `npm run typecheck`, and `npm run build`.
- [/] Inspect the form and pending-request states at desktop and mobile widths,
  including empty, minimum-valid, maximum-length, disabled/busy, requester,
  recipient, and observer views. The in-app browser was unavailable during
  local verification; compiled responsive and accessibility regressions pass.
- [x] Commit and push the exact verified source, deploy Sites version 16, and
  verify the live app responds successfully with the Phase 17 stylesheet.

Acceptance:

- The reason label, helper, textarea, and character count form one aligned,
  full-width field group with no clipping or awkward inline sizing.
- The mutual-void composer is visually distinct from the surrounding matched
  bet, explains the two-party agreement rule, and keeps its primary and
  secondary actions easy to scan.
- The pending-request panel uses the same hierarchy and makes the participants,
  reason, status, base revision, and current-bet guardrail easy to understand.
- The workflow is keyboard accessible and remains clean on mobile.
- No database, API, authorization, settlement, debt, audit, or Notion export
  behavior changes.

### Phase 18 — Show complete offer rules and each participant's side

Make every offer understandable before acceptance and every matched bet
understandable from the signed-in participant's perspective. Surface the exact
versioned market context, name both sides of the agreement, and state what the
viewer needs in order to win without changing settlement semantics.

Exact-rule data contract:

- Extend each `OfferLegView` with the description from its captured
  `market_revision_id`, not the market's latest description. Offers and matched
  bets must therefore keep showing the context that governed their exact
  version even after the market is edited.
- Include a server-derived label for the selection opposite the listed maker
  selection. Do not make the client infer the other outcome from current market
  state.
- Select the description and both outcome labels in the existing offer-leg and
  bet-revision-leg joins and map them through the shared leg-view function.
- This is a read-model extension only: no D1 migration, historical rewrite,
  action payload change, or settlement-rule change is required.
- An empty optional context is omitted cleanly. A non-empty context is rendered
  in full and wraps without widening the card.

Offer-card contract:

- Each offer leg shows, in order: market question, exact market context,
  betting deadline, revision badge, and the listed pick.
- Add an `OFFER SIDES` summary immediately before the stakes and actions. For a
  straight bet it names the maker's outcome and says `You if accepted` with the
  exact opposite outcome. For a parlay it names who Backs and who Fades the
  listed picks.
- State the winning rule beside each position. Back wins only if every
  non-void listed pick hits; Fade wins if any listed pick misses. Never describe
  Fade as reversing every parlay leg.
- For a viewer who can accept, change generic opponent copy to personal copy:
  `You risk`, `Your side`, and `You win if`. The maker's own card retains
  neutral `Friend who accepts` wording.
- Replace the straight-bet `Take the other side` action with the exact result,
  such as `Accept · Lakers win`. Parlay actions remain position-based but become
  explicit, such as `Accept · Fade this parlay`.
- Counteroffer acceptance uses the same perspective rule: exact outcome for a
  straight bet, Back/Fade for a parlay. Negotiated money remains in the original
  maker/taker perspective.

Matched-bet contract:

- Replace the rotated `YOUR SIDE: MAKER/TAKER` ribbon with an in-flow
  `YOUR BET` summary for participants. `Maker` and `taker` remain internal role
  names and are not presented as the user's meaningful betting side.
- For a straight bet, the summary shows `Your pick` with the viewer's exact
  outcome, `You win if` with the same resolved outcome, the opponent's outcome,
  and the viewer's maximum risk.
- For a parlay, the summary shows `Your position: Back/Fade`, identifies the
  listed picks as the proposition being backed or faded, and states the
  viewer-specific winning rule in direct `You win…` language.
- Observers continue to receive a neutral two-party explanation naming each
  participant and their winning condition; they never receive a misleading
  `Your bet` panel.
- Each current matched-bet leg also shows its captured market context. The
  listed selection is labeled `Listed pick` for parlays so a Fade participant
  does not mistake every listed pick for their own side.
- Keep status, exact revision, dates, risks, edit/void controls, history,
  settlement, and participant permissions unchanged.

Visual, responsive, and accessibility contract:

- Use one compact blue informational surface for side/win summaries and the
  existing paper/cream hierarchy for market context. Do not add modal
  confirmation or hide rules behind disclosure.
- Treat context as supporting copy and the viewer's side/winning condition as
  the strongest content immediately before acceptance.
- Long questions, contexts, names, and outcome labels wrap. At the `680px`
  breakpoint the two-side summary stacks while preserving maker/acceptor order
  and full-width actions.
- The accepting button's accessible name contains the exact outcome or parlay
  position. Repeated labels remain understandable without relying on color.

Implementation:

- [x] Add failing unit tests for straight and parlay perspective helpers,
  covering maker, taker, observer, Back, Fade, and exact opposite selections.
- [x] Add failing rendered-output regressions for captured context,
  `OFFER SIDES`, `You if accepted`, exact straight acceptance copy,
  Back/Fade acceptance copy, `YOUR BET`, `Your pick`, and `You win if`.
- [x] Extend `OfferLegRow`, `BetRevisionLegRow`, and `OfferLegView` with the
  captured market description and opposite selection label; update both D1
  joins and the shared leg mapper.
- [x] Build typed helpers for viewer-facing side labels and winning rules so the
  offer card, counter acceptance, matched-bet summary, and leg labels cannot
  drift independently.
- [x] Update offer legs, the pre-acceptance side summary, stakes copy, root
  acceptance action, and counteroffer acceptance in `app/BettingApp.tsx`.
- [x] Replace the matched-bet ribbon with the participant/observer summary and
  render exact context in current bet legs.
- [x] Add scoped offer-rule, market-context, side-summary, and personal-bet
  styles in `app/globals.css`, including narrow-screen stacking.
- [x] Update `DESIGN.md` to require pre-acceptance side/win clarity and
  participant-perspective matched-bet summaries.
- [x] Run `npm run test:unit`, `npm test`, `npm run lint`,
  `npm run typecheck`, and `npm run build`; confirm no migration is generated
  and existing Back/Fade D1 settlement tests remain green.
- [/] Inspect straight and parlay offers plus maker, taker, and observer matched
  views at desktop and mobile widths. The in-app browser was unavailable;
  compiled responsive and accessibility regressions pass.
- [x] Commit and push the exact verified source, deploy Sites version 17, and
  verify the live production bundle contains the new context and side copy.

Acceptance:

- A friend can read the exact captured market context, their side, their risk,
  and the condition required for them to win before accepting an offer.
- A straight-bet acceptance action names the actual outcome being accepted
  instead of saying only `Take the other side`.
- A parlay clearly distinguishes its listed picks from Back/Fade positions and
  describes Fade as winning when any listed pick misses.
- In Matched bets, each participant receives a prominent personal summary of
  their pick or position and their winning condition; observers receive a
  neutral explanation.
- Existing offers and matched bets gain the clarification from stored revision
  data without rewriting history or changing any wager result.
- Authentication, acceptance concurrency, counteroffers, revisions, mutual
  voids, settlement, debts, Notion export, and market deletion continue to pass.

### Phase 19 — Filter matched bets without default void clutter

Keep mutually voided bets available as permanent public history while removing
them from the initial Matched bets view. Add explicit status filters so friends
can focus on bets awaiting results, completed results, or void history without
changing bet settlement or deletion semantics.

Filter semantics:

- Add a typed matched-bet ledger filter with `current`, `pending`, `resolved`,
  `void`, and `all` values.
- `Current` is the default and includes every `pending`, `maker_won`, and
  `taker_won` bet. It excludes only `void` bets, so existing resolved history
  remains visible on first load.
- `Pending` includes only bets whose stored status is `pending`.
- `Resolved` combines `maker_won` and `taker_won`; the existing winner-specific
  status badge remains on each card.
- `Voided` includes only bets whose stored status is `void`.
- `All` restores the complete matched-bet history, including voided bets.
- There is no `Settled` matched-bet filter. Confirmed offline payments continue
  to apply to pairwise net balances and are not presented as a per-bet state.
- Filtering preserves the server's existing newest-accepted-first ordering and
  operates over the already-authorized bet views. It does not delete, archive,
  mutate, or weaken access to any bet or void-agreement history.

Matched-bets UI contract:

- Place one compact filter surface between the `Every matched bet` heading and
  the bet grid, following the existing All markets filter styling.
- Show buttons for `Current`, `Pending`, `Resolved`, `Voided`, and `All`, each
  with its count. The Current control includes supporting copy that it means
  `Pending + resolved · voided hidden`.
- Use pressed-button semantics and a visible selected state; the filter must be
  usable by keyboard and understandable without relying on color.
- Change the heading count from an unconditional total to the number currently
  shown, while also retaining the complete total in the filter summary.
- When the complete ledger is empty, keep the existing `Nothing matched yet`
  card. When a selected filter has no matches, show a filter-specific empty
  state rather than implying that no bets have ever existed.
- The filter wraps cleanly on narrow screens, retains at least a 44px target
  height, and never pushes the bet grid beyond the viewport.
- Filter selection is local to the mounted Matched bets tab. Refreshing or
  revisiting the tab safely returns to the default Current view.

Data and architecture boundary:

- Create a small pure helper in `lib/bet-ledger.ts` for lifecycle
  classification, counts, and filtering so the four stored `BetStatus` values
  cannot drift from the three user-facing lifecycle labels.
- Keep `BetStatus`, `BetView`, D1 queries, the 100-row authorization boundary,
  API payloads, `settled_at`, debts, and offline settlements unchanged.
- Do not rename `maker_won` or `taker_won` in storage; they remain the source of
  both the Resolved filter and each card's exact winner badge.
- Do not automatically delete voided bets. Their terms, mutual-void reason,
  revision history, audit history, and Notion export eligibility remain intact.

Implementation:

- [x] Add failing unit tests for Current, Pending, Resolved, Voided, and All
  filtering, including exact counts and stable input ordering.
- [x] Add a failing rendered-output regression for the matched-bet filter,
  default void exclusion, status labels, accessible pressed state, filtered
  result count, and mobile styling.
- [x] Add the typed lifecycle/count/filter helper in `lib/bet-ledger.ts`.
- [x] Update `BetsTab` in `app/BettingApp.tsx` with local default filter state,
  status counts, filtered cards, and distinct complete-ledger versus
  no-filter-results empty states.
- [x] Add scoped matched-bet filter styles in `app/globals.css`, reusing the
  established paper, cream, ink, count-badge, wrap, and focus patterns.
- [x] Update `DESIGN.md` with the Current-default and Resolved/Voided history
  rules.
- [x] Run `npm run test:unit`, `npm test`, `npm run lint`,
  `npm run typecheck`, `npm run db:generate`, and `npm run build`; confirm no
  migration is generated and mutual-void/debt-settlement regressions remain
  green.
- [/] Inspect Current, Pending, Resolved, Voided, All, and empty-result states
  at desktop and mobile widths. The in-app browser was unavailable; compiled
  responsive, accessible-control, and empty-state regressions pass.
- [x] Commit and push the exact verified source, deploy Sites version 18, and
  verify the live bundle contains the new filter controls and default Current
  explanation.

Acceptance:

- Opening Matched bets shows pending and resolved bets but no voided bets.
- A friend can switch among Pending, Resolved, Voided, All, and the default
  Current view, with truthful counts and no page reload.
- Resolved includes both maker-won and taker-won bets while retaining each
  card's exact outcome.
- Voided bets remain fully readable when explicitly selected, including their
  mutual-agreement reason and immutable history.
- Selecting an empty category produces a clear filtered-empty message; it does
  not show the first-use `Nothing matched yet` message.
- No bet, debt, payment confirmation, market, offer, audit record, or Notion
  export behavior changes.

### Phase 20 — Open the signed-in user's live bets from the score strip

Turn the existing `My live bets` score into a clear navigation shortcut. A
friend can select it from any signed-in tab and land directly on only their own
unresolved matched bets, while the normal Matched bets destination continues to
open the public Current ledger from Phase 19.

Live-bet semantics:

- Add `mine` to the typed `BetLedgerFilter` union and label it `My live`.
- `My live` includes a bet only when `bet.isParticipant` is true and the stored
  bet status is `pending`.
- A pending bet remains live while its result is unresolved, including after
  one or more markets close to additional offers. Market close time does not
  independently remove a matched bet from this view.
- Maker-won, taker-won, and voided bets are never included in My live.
- The My live count is derived by the same pure helper used by the score strip
  and filter control so the navigation promise and displayed cards cannot
  disagree.
- This remains a viewer-specific read filter over the already-authorized
  `BetView.isParticipant` field. It introduces no new server trust decision.

Navigation and state contract:

- Render the `My live bets` metric as a semantic button with a visible
  interactive affordance, existing paper tone, and an accessible name such as
  `View 3 of your live bets`.
- Selecting the metric sets the Matched bets filter to `My live` and navigates
  to the Matched bets tab in one interaction.
- The shortcut works from every app tab and also switches an already-open
  Matched bets ledger from another filter to My live.
- Add `My live` as the first explicit filter control before `Current`, with its
  participant-specific count.
- Selecting the normal `Matched bets` navigation button continues to open
  `Current`, preserving the default Pending + Resolved public view and hidden
  void history from Phase 19.
- Move the matched-bet filter state to the signed-in app shell and pass it into
  `BetsTab` as controlled state. Do not create competing parent and child
  filters or use an effect to synchronize them.
- If the signed-in user has zero live bets, the metric remains usable and opens
  the existing filtered-empty state with `My live` selected and a route back to
  All bets.

Visual, responsive, and accessibility contract:

- Preserve the score strip's three equal metrics; the actionable metric must
  not grow, wrap the strip, or look like a primary destructive/submit action.
- Use border/outline, hover, active, and a small directional affordance to make
  the metric recognizably clickable while retaining the paper color role.
- The button keeps a minimum 44px target, visible focus ring, and no
  color-only indication of interactivity.
- At the `680px` layout, the label, count, and affordance remain legible inside
  the existing three-column score strip without horizontal overflow.
- The selected My live filter uses the same pressed-state treatment, count
  badge, keyboard behavior, wrapping, and live result count as every other
  matched-bet filter.

Data and architecture boundary:

- Extend `lib/bet-ledger.ts`; do not duplicate the `isParticipant && pending`
  predicate in the metric, filter bar, or component rendering.
- Keep `BetStatus`, `BetView`, D1 queries, the 100-row response boundary, API
  actions, authentication, settlement, debts, and Notion export unchanged.
- Do not add personal bet visibility restrictions: Sidebet's full matched-bet
  ledger remains public to signed-in friends. My live is only a convenience
  filter.

Implementation:

- [x] Add failing unit tests proving My live includes only participant-pending
  bets, returns a truthful count, and preserves input order.
- [x] Add a failing rendered-output regression for the semantic metric button,
  accessible count label, My live filter, controlled navigation state, empty
  result behavior, and responsive interaction styling.
- [x] Extend the typed bet-ledger helper and filter counts with `mine`.
- [x] Lift the matched-bet filter state into `BettingApp`; connect the score
  metric, normal Matched bets tab, and controlled `BetsTab` filter callbacks.
- [x] Extend `Metric` with an optional semantic action path without changing
  the noninteractive Open offers and net-balance metrics.
- [x] Add the My live filter control and reuse the Phase 19 results/empty-state
  UI.
- [x] Add scoped actionable-metric hover, active, directional, focus, and
  narrow-screen styles in `app/globals.css`.
- [x] Update `DESIGN.md` with score-strip drill-down and viewer-specific live
  bet filter behavior.
- [x] Run `npm run test:unit`, `npm test`, `npm run lint`,
  `npm run typecheck`, `npm run db:generate`, and `npm run build`; confirm no
  migration and no matched-bet, void, settlement, or authentication regression.
- [/] Inspect the shortcut from Board, Matched bets, Settle up, and Markets,
  plus zero/nonzero My live states at desktop and mobile widths.
  Browser inspection remains pending because no controllable browser backend
  was available in this session; bundle, responsive-style, and state semantics
  are covered by the automated regressions.
- [x] Commit and push the exact verified source, deploy a saved Sites version,
  and verify the new shortcut and My live filter in the production bundle.

Acceptance:

- Clicking `My live bets` opens Matched bets with `My live` visibly selected.
- The resulting cards are exactly the signed-in user's pending matched bets;
  friends' bets, resolved bets, and voided bets are excluded.
- The metric and filter show the same count before and after navigation.
- Clicking the normal Matched bets navigation returns to Current rather than
  leaving a hidden personal filter active.
- A zero count still opens a clear My live empty view instead of doing nothing.
- No bet terms, permissions, outcomes, debts, offline payments, public history,
  or stored data change.

### Phase 21 — Make Pending the unambiguous matched-bet default

Remove the combined `Current` filter now that it is easy to mistake for
`Pending`. Each remaining control represents one clear scope, and normal
Matched bets navigation opens the public pending ledger.

Filter contract:

- The filters are `My live`, `Pending`, `Resolved`, `Voided`, and `All`, in
  that order.
- `Pending` is the default and includes every unresolved matched bet across the
  friend group.
- `My live` remains the viewer-specific subset of Pending where
  `isParticipant` is true.
- `Resolved` contains maker-won and taker-won bets, `Voided` contains voided
  history, and `All` contains the complete signed-in group ledger.
- Remove `current` from `BetLedgerFilter`, helper counts, filter behavior, UI
  controls, fallback labels, and explanatory copy.

Navigation and state:

- Selecting normal Matched bets navigation always resets the controlled filter
  to `Pending`.
- Selecting the score-strip shortcut still opens `My live`.
- A zero-bet Pending ledger retains the friendly first-use card. A zero-result
  explicit filter retains the filtered empty state and one-action All reset.
- This is a read-only presentation change. Bet visibility, stored statuses,
  permissions, matching, resolution, settlement, debt, and exports do not
  change.

Implementation:

- [x] Add failing helper and production-bundle regressions for the Pending
  default and absence of Current.
- [x] Remove Current semantics from the typed helper and counts.
- [x] Remove the Current control and make filter descriptions specific to the
  selected scope.
- [x] Update `DESIGN.md` to make Pending the normal ledger destination.
- [x] Run the full unit, built integration, lint, type, schema, and build gates;
  confirm no migration.
- [x] Commit and push the verified source, deploy a saved Sites version, and
  verify the production bundle exposes the simplified filters.

Acceptance:

- Normal Matched bets navigation opens Pending, never a hidden combination.
- My live and Pending remain visibly distinct: personal active bets versus all
  active bets.
- Current is absent from the filter bar and from the typed filter contract.
- Resolved and Voided history remain available explicitly; All remains the
  complete ledger.
- No stored data or server behavior changes.

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
