# Sidebet — Implementation Plan

**Updated:** 2026-07-28
**Status:** Phase 7 implemented, verified, and published

## Product contract

Sidebet is a signed-in social betting board for friends. Users create event
markets, publish one-to-one bet offers, negotiate terms through immutable
counteroffers, and accept exactly one opponent per offer. The application
records real-world dollar obligations but never holds money, connects to a
payment provider, or verifies payments.

Every accepted bet and debt-settlement action is visible to signed-in members.

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
- Accepted bets and negotiation history are immutable.
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
- `status`: `open`, `resolved`, or `void`.
- `winning_selection`: `a`, `b`, or null.
- `creator_user_id`, `created_at`, `resolved_at`.

### `offers`

- `id`, `maker_user_id`.
- `maker_risk_cents`, `taker_risk_cents`.
- `status`: `open`, `accepted`, `cancelled`, or `expired`.
- `accepted_by_user_id`, `accepted_counter_id`.
- `created_at`, `expires_at`, `accepted_at`.

### `offer_legs`

- `id`, `offer_id`, `market_id`, `maker_selection`.
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
- `status`: `pending`, `maker_won`, `taker_won`, or `void`.
- `accepted_at`, `settled_at`.

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

## Server surface

- `GET /api/state` — signed-in application snapshot.
- `POST /api/actions` with a validated discriminated action:
  - `create_market`
  - `resolve_market`
  - `create_offer`
  - `create_counteroffer`
  - `accept_offer`
  - `cancel_offer`
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
