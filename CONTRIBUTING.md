# Contributing to Sidebet

Sidebet is intentionally small enough for friends to build together. The
GitHub repository is public, so the default contribution path is:

1. Fork the repository or create a feature branch if you have collaborator
   access.
2. Make one focused change.
3. Run the repository checks.
4. Open a pull request explaining the user-visible result.

## Local setup

Sidebet requires Node.js `>=22.13.0`.

```bash
npm ci
npm run dev
```

Local development supplies a test identity automatically. Production identity
is handled by Sign in with ChatGPT.

## Before opening a pull request

```bash
npm run test:unit
npm run lint
npm run typecheck
npm test
```

Include screenshots for visual changes when possible. Keep generated build
output, environment files, credentials, and local database state out of commits.

## Product invariants

Read [PLAN.md](./PLAN.md) before changing betting behavior. In particular:

- One root offer can create at most one matched bet.
- Offers and counteroffers never reserve funds.
- Accepting any branch consumes the root offer.
- Multi-leg selections always define one AND proposition. `back` means the
  original maker takes that proposition; `fade` means the maker wins if any
  selected leg misses. Never implement Fade by reversing duplicate legs.
- Counteroffers inherit the immutable root Back/Fade position and change money
  terms only. Matched-bet position changes are append-only revisions requiring
  acceptance by the other participant.
- Only the current recipient may accept, counter, or decline a pending
  counteroffer. Those transitions must recheck the pending state atomically so
  exactly one wins; declining leaves the root offer open.
- Market creators may participate in offers on markets they resolve; both the
  participation and resolution stay visible in the public activity ledger.
- Market and matched-bet terms are append-only. Never update a revision in
  place or repoint an existing offer to a newer market revision.
- Either matched-bet participant may request a mutual void while the bet is
  pending. Only the other participant may accept or reject it; acceptance
  retains the bet and request history, marks the bet void, and creates no debt.
  Never use this flow to erase a settled debt.
- Permanent market deletion is only for a creator-owned market with zero
  references in `offer_legs` and `bet_revision_legs`. Cancelled, expired,
  accepted, settled, and void history all block deletion; never add a force or
  cascade bypass.
- Only the market creator may publish a new market revision. A pending
  matched-bet revision becomes active only after the other participant accepts
  it, and both current and proposed legs must still be open.
- Market resolution creates an immutable debt record.
- Offline payment claims require confirmation from the other party.
- The app never holds, transfers, or verifies money.
- The weekly Notion archive is a human-readable matched-bet ledger, not a
  complete backup. Its Void History is redacted and append-only. Do not expand
  its scope to identity emails or credentials.

## Interface changes

Read [DESIGN.md](./DESIGN.md) before changing the UI. Preserve the expressive
sports-zine landing page and the calmer, task-first signed-in experience. New
controls need keyboard focus, responsive behavior, and complete loading,
disabled, error, and success states.

## Pull request scope

Prefer small pull requests that change one workflow or concern. Avoid unrelated
refactors, preserve existing tests, and add focused coverage when behavior
changes.

Never commit Notion tokens, export trigger secrets, local `.dev.vars`, D1
exports, or copied production responses. Public scheduler configuration may
contain the endpoint URL and variable names only.
