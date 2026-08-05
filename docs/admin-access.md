# Market administrator access

Sidebet grants market administration through the hosted `ADMIN_EMAILS`
environment value. It accepts a comma-separated list of exact ChatGPT sign-in
emails. Matching trims whitespace and ignores case, but never accepts partial
addresses or display names.

Keep the production value in Sites as a secret. Do not add real account emails
to source files, `.openai/hosting.json`, screenshots, logs, or copied API
responses. For local testing only, start the app with a non-production value:

```bash
ADMIN_EMAILS=admin@example.test npm run dev
```

## Permission boundary

An admin may:

- edit a still-open market through its append-only revision flow;
- reopen a closed unresolved market without changing its locked terms; and
- resolve or void an unresolved market revision; and
- return a resolved or voided revision to unresolved with a public correction
  reason.

Admin actions use the signed-in admin's user ID, so the existing revision and
activity histories show who acted. Admins remain subject to the same deadline,
finality, stale-revision, concurrency, offer-propagation, and settlement rules
as market creators.

## Result corrections

Unresolving is a correction, not a deadline extension. The original close time
remains in force, and expired offers and superseded counteroffers are not
restored. The action may target the current revision or an older revision used
by a frozen matched bet.

Sidebet atomically removes debt derived from affected bets, returns eligible
bets to pending, clears the market result, and regrades those bets from their
accepted revision legs. A parlay can immediately become final again when
another leg already determines its outcome. Bets voided by mutual agreement
remain voided.

Confirmed offline payments are historical facts and are never removed. If an
incorrect result had already been paid, removing its debt can temporarily make
the ledger show the opposite friend as owing money. Resolving the corrected
market or recording another offline payment brings the ledger forward from
that history. Pending payment proposals for affected pairs are cancelled so
friends review the recalculated balance before claiming another payment.

Duplicate and stale correction requests fail without partially changing bets,
debts, payments, or audit history.

An admin may not delete another user's market, control another user's offers,
approve both sides of a matched-bet amendment or mutual void, confirm both sides
of an offline settlement, or impersonate another account.

To add or remove an admin, update the hosted `ADMIN_EMAILS` secret and deploy a
saved version so the new environment revision becomes active. No database
migration is required.
