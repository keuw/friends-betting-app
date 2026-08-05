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
- resolve or void an unresolved market revision.

Admin actions use the signed-in admin's user ID, so the existing revision and
activity histories show who acted. Admins remain subject to the same deadline,
finality, stale-revision, concurrency, offer-propagation, and settlement rules
as market creators.

An admin may not delete another user's market, control another user's offers,
approve both sides of a matched-bet amendment or mutual void, confirm both sides
of an offline settlement, or impersonate another account.

To add or remove an admin, update the hosted `ADMIN_EMAILS` secret and deploy a
saved version so the new environment revision becomes active. No database
migration is required.
