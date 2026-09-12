# Automatic Pinterest publishing

Automatic publishing is available only to the signed-in `khalil@gmail.com` account,
and only for websites whose project that user can access. On the Pinterest gallery,
select a website, then choose **Start Publishing on Pinterest**. Connect Pinterest,
review the queue, set the daily limit and interval, and start publishing. Each website
has independent credentials, settings, and history. Connecting alone does not start it.

## Server setup

Set these variables in the backend environment or `backend/.env`:

```dotenv
PINTEREST_CLIENT_ID=your-app-id
PINTEREST_CLIENT_SECRET=your-app-secret
PINTEREST_REDIRECT_URI=https://your-frontend.example/pinterest/callback
ENCRYPTION_KEY=your-existing-fernet-key
```

Register that exact redirect URI in the Pinterest app dashboard. Keep the existing
encryption key stable and backed up: replacing it makes saved credentials unreadable.
Never prefix Pinterest secrets with `NEXT_PUBLIC_`. Docker Compose passes the Pinterest
credentials exclusively to the backend. In production, serve the frontend and backend
over HTTPS and configure the existing authenticated session cookies appropriately.

The flow requests `boards:read`, `boards:write`, `pins:read`, `pins:write`, and
`user_accounts:read`. Pinterest app access must permit the account being connected.
Tokens are encrypted with Fernet in dedicated backend tables; no token or secret is
returned by the publishing endpoints or included in audit values. OAuth states are
hashed, persisted for ten minutes, bound to the user and website, and consumed once.
The authorization code is exchanged on the backend. Refresh-token rotation and access
token expiry are handled before publication. Expired/revoked authorization may require
reconnecting. A connection that is unused beyond Pinterest's refresh-token lifetime
also needs reconnection.

Apply `cd backend && alembic upgrade head`, then restart the backend. The migration
also supports installations where startup `create_all` has already created the tables.
An always-running backend and PostgreSQL are required. The worker starts in the FastAPI
lifespan and checks every 30 seconds; no open browser or separate cron service is needed.
PostgreSQL session advisory locks require a direct connection or a pooler in session
mode, rather than transaction-pooling mode.

## Queue and scheduling behavior

- The source is the same generated/published recipe records as the Pinterest gallery,
  scoped to one website. Search and board filters do not limit the automatic queue.
  Local spreadsheet-only edits are not saved to those source records. Update the source
  pin content before retrying if it needs correction.
- Sync discovers new items without resetting existing records. Before each attempt,
  pending content is refreshed from its source recipe. Published content remains a
  snapshot, including Pinterest Pin ID and publication time, even if the source is deleted.
- Publishing uses the designed pin image, title, description, board name, keywords,
  and article permalink. Missing required content fails with a correction message.
  PNG/JPEG data images are sent as Pinterest base64 media; image URLs must be accessible
  to Pinterest. No generated-image fallback silently replaces a missing designed pin.
- Board lookup paginates through the connected user's owned boards and compares names
  without case or repeated whitespace. Only a missing board is created. Concurrent
  websites on the same Pinterest account serialize board lookup/creation.
- The daily limit uses UTC midnight. Delay between attempts is measured after completion
  and continues across midnight, stop/start, restarts, retries, and settings changes.
  A long interval can result in fewer pins than the daily maximum. There is no catch-up burst.
- Stopping prevents new dispatches. A pin request already sent to Pinterest can finish.
  Disconnecting clears encrypted tokens, stops publishing, and retains history.
- Existing image/recipe cleanup skips source content awaiting Pinterest publication
  for a connected website, including when its schedule is paused.
- Known transient failures retry with backoff, up to five attempts. Validation and
  permission failures stay Failed for correction and manual retry. Manual retry still
  respects the website schedule. A failed item is never reported as Published.

## Lost responses and duplicate prevention

Unique website/recipe records and PostgreSQL locks prevent duplicate workers and queue
syncs from publishing an item again. A dispatch marker is committed before the pin
request. Once a Pin ID is saved, the worker never selects that record again.

Pinterest's create-pin endpoint does not provide a documented idempotency key. A network
failure, server error, or worker crash after dispatch can therefore leave an unknown
outcome. Such items become Failed with automatic retries disabled and reserve a daily
slot. Check Pinterest: if the pin exists, enter its ID and use **Verify & save Pin ID**.
The server checks its board, title and destination before marking it Published. If no pin
was created, use **Verify before retrying** and explicitly confirm that check. An incorrect
manual confirmation can create a duplicate; the system cannot prove absence remotely.

## References

- [Pinterest authentication and refresh tokens](https://developers.pinterest.com/docs/getting-started/set-up-authentication-and-authorization/)
- [Register an app and redirect URI](https://developers.pinterest.com/docs/getting-started/connect-app/)
- [Create boards and pins](https://developers.pinterest.com/docs/work-with-organic-content-and-users/create-boards-and-pins/)

Live OAuth and publishing require configured app credentials and account authorization.
Automated checks mock Pinterest and never publish real pins.

Run the feature tests with `cd backend` then
`python -m unittest discover -s tests -p 'test_pinterest*.py' -v`.
The PostgreSQL tests run when `PINTEREST_TEST_DATABASE_URL` points to a disposable test
database; each creates and removes only its own randomly named schema. They cover
concurrent workers, concurrent queue sync, lock lifetime, migration compatibility, and
failure to save the database result after Pinterest accepts a pin.
