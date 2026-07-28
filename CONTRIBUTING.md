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
- Market resolution creates an immutable debt record.
- Offline payment claims require confirmation from the other party.
- The app never holds, transfers, or verifies money.

## Interface changes

Read [DESIGN.md](./DESIGN.md) before changing the UI. Preserve the expressive
sports-zine landing page and the calmer, task-first signed-in experience. New
controls need keyboard focus, responsive behavior, and complete loading,
disabled, error, and success states.

## Pull request scope

Prefer small pull requests that change one workflow or concern. Avoid unrelated
refactors, preserve existing tests, and add focused coverage when behavior
changes.
