# Sidebet

**Live app:** [Open Sidebet](https://sidebet-friends.tonykeuw.chatgpt.site)

Sidebet is a private social betting board for friends. Any signed-in user can
publish an offer, another friend can accept it or counter the terms, and the
group can see the resulting bets and offline debts.

The app does not hold funds or process payments. When friends settle through an
external method, both parties confirm the settlement in Sidebet.

## Product rules

- One root offer creates at most one matched bet. Accepting it atomically closes
  the whole offer and supersedes every competing counteroffer.
- Creating or countering an offer does not reserve funds. Sidebet has no wallet,
  deposit, balance, or credit limit.
- An offer can contain one market or multiple legs. Every leg must win for a
  parlay to win; a void leg is ignored.
- The market creator acts as its resolver and may also make, counter, or accept
  offers on that market. Participation and resolution remain public to the
  group.
- A market edit publishes a numbered revision instead of rewriting history.
  Existing offers and matched bets keep the exact market version they already
  reference, and each referenced version is resolved independently.
- Either participant may propose new terms for a pending matched bet. The
  current version remains active unless the other participant accepts the
  complete proposal; rejected and cancelled proposals stay in the public
  history without changing the bet.
- Settled bets create pairwise debts. Reciprocal debts are netted before the app
  shows who owes whom.
- Offline settlement proposals require confirmation from the other party.

See [PLAN.md](./PLAN.md) for the full domain model, race-condition contract, and
release plan.

## Contributing

The repository is public and contributions are welcome from the friend group.
Fork it and open a pull request, or ask the repository owner for collaborator
access if you need to push branches directly. Start with
[CONTRIBUTING.md](./CONTRIBUTING.md) and follow [DESIGN.md](./DESIGN.md) for
interface changes.

## Local development

Requires Node.js `>=22.13.0`.

```bash
npm install
npm run dev
```

The local development server supplies a local test identity. Production uses
Sign in with ChatGPT and injects the authenticated identity at the edge.

## Verification

```bash
npm run test:unit
npm run typecheck
npm run lint
npm test
```

`npm test` runs the pure domain tests, creates a production Cloudflare build,
and renders the compiled worker to verify the public landing page.

## Storage and deployment

The app targets Cloudflare Workers through Vinext and stores its ledger in a D1
database. The schema lives in `db/schema.ts`; generated SQL migrations live in
`drizzle/`.

Production hosting is configured through `.openai/hosting.json`.
