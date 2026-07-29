# Weekly Notion archive

Sidebet exports every matched bet to a private Notion database once a week.
The archive is human-readable evidence keyed by the immutable `Sidebet Bet ID`.
It is not a complete disaster-recovery backup: users, unmatched offers, debts,
offline settlements, and the complete audit ledger remain in D1 only.

## Security boundary

- The Notion connection should have read, insert, and update content
  capabilities.
- Share only the parent page/archive database with that connection.
- Keep the archive private in Notion unless the friend group explicitly wants
  broader workspace access.
- Never paste a Notion token into chat, an issue, a pull request, source code,
  or a committed environment file.
- `NOTION_TOKEN` and `NOTION_EXPORT_SECRET` are encrypted runtime secrets.
  `NOTION_DATA_SOURCE_ID`, `SIDEBET_APP_URL`, and `SIDEBET_EXPORT_URL` are
  configuration values.
- The scheduler receives only the endpoint URL and trigger secret. It never
  receives the Notion token or D1 access.

## One-time Notion setup

1. Create a private Notion parent page.
2. Add the internal Sidebet connection to that page.
3. Store the rotated token in macOS Keychain without putting it on a command
   line:

   ```bash
   security add-generic-password -a "$USER" -s sidebet-notion-token -U -w
   ```

   macOS prompts for the value because `-w` is the last argument.

4. Copy the parent page ID and create the locked archive schema:

   ```bash
   export NOTION_PARENT_PAGE_ID="the-parent-page-id"
   NOTION_TOKEN="$(security find-generic-password -a "$USER" -s sidebet-notion-token -w)" \
     npm run notion:setup
   unset NOTION_PARENT_PAGE_ID
   ```

5. Save the returned `dataSourceId` as the Sites runtime value
   `NOTION_DATA_SOURCE_ID`. The script prints IDs and the archive URL, never the
   token.

The schema contains: Bet, Sidebet Bet ID, Maker, Taker, Maker Risk, Taker Risk,
Maker Position, Status, Matched At, Settled At, Active Revision, Leg Count,
Active Terms, Legs, Revision History, Void History, Last Exported, and Sidebet
URL. Void History records each request’s base bet revision, participants,
redacted reason, final status, and timestamps.

After pulling a release that adds archive fields, reconcile an existing data
source before triggering the export:

```bash
export NOTION_DATA_SOURCE_ID="the-data-source-id"
NOTION_TOKEN="$(security find-generic-password -a "$USER" -s sidebet-notion-token -w)" \
  npm run notion:reconcile-schema
unset NOTION_DATA_SOURCE_ID
```

The reconciliation is additive and prints only the data-source ID and property
names.

## Deployment

Configure the Sites app with:

- secret `NOTION_TOKEN`
- secret `NOTION_EXPORT_SECRET`
- value `NOTION_DATA_SOURCE_ID`
- value `SIDEBET_APP_URL`

Configure the separate Cloudflare Worker with:

```bash
npx wrangler secret put SIDEBET_EXPORT_SECRET \
  --config wrangler.scheduler.jsonc
npm run scheduler:deploy
```

The secret must be identical on both services. The committed scheduler config
runs `0 17 * * SUN`, or Sunday at 17:00 UTC.

## Manual reconciliation

Store the trigger secret in Keychain:

```bash
security add-generic-password -a "$USER" -s sidebet-export-secret -U -w
```

Then trigger an export without printing the secret:

```bash
SIDEBET_EXPORT_URL="https://sidebet-friends.tonykeuw.chatgpt.site/api/internal/notion-export" \
SIDEBET_EXPORT_SECRET="$(security find-generic-password -a "$USER" -s sidebet-export-secret -w)" \
  npm run notion:export
```

A successful response includes only the run ID and created, updated,
unchanged, failed, and scanned counts. A second unchanged run should report
zero created or updated records.

## Operations and recovery

- HTTP `409` means another run owns the D1 lease. Wait for it to finish. A
  stale lease is reclaimed after 30 minutes.
- HTTP `502` with `partial` means at least one bet failed. Successful records
  remain mapped; run reconciliation again after Notion recovers.
- Notion `429` and retryable `5xx` responses receive bounded retry/backoff.
- Rotate the Notion token in Notion and then replace only the Sites secret.
- Rotate the trigger secret by replacing it in Sites and the scheduler before
  the next manual or scheduled invocation.
- `notion_export_runs` records run counts and status.
  `notion_bet_exports` records the page mapping, payload hash, last successful
  export, and redacted last error.
- Mutual-void requests are preserved in `Void History` whether accepted,
  rejected, cancelled, or superseded. Agreement voids a pending bet without
  deleting its terms or creating debt.
- Permanent market deletion is outside this archive and is allowed only when
  no offer or matched-bet reference exists, so it cannot remove or invalidate
  an archived matched bet.
