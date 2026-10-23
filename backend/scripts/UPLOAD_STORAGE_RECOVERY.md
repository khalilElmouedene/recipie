# Recover upload storage and prevent recurrence

The recovery command deletes only application-generated image filenames in the
flat `uploads/recipes/` folder (default scope) and, with `--scope all`, UUID-named
images and prepared source images directly under `uploads/`. It does not sweep
PostgreSQL, Facebook, Threads, custom filenames, cookies, or other directories.

Before deleting, it scans all current database string/JSON fields, including
article HTML, templates, Pinterest history and standalone image generations.
Historical audit and job log entries are not live ownership references. Missing
tables, failed scans or lock timeouts abort the deletion. On PostgreSQL it holds
SHARE locks while checking/deleting, briefly blocking database writers to avoid
new references appearing during deletion. Recent files (mtime or ctime less than
48 hours old) are preserved. A preview changes nothing. Applications outside
this database, browser-only unsaved edits older than the grace period, or manually
linked images on external sites are outside the reference check.

## Immediate recovery without rebuilding the full backend

Copy `upload-storage-recovery.py` to `/tmp/` on the server. This standalone copy
uses the existing backend's environment, database and mounted uploads volume;
it does not install packages or start application background jobs.

From `/apps/recipie`, preview eligible files:

```bash
docker compose exec -T backend python - --scope recipes < /tmp/upload-storage-recovery.py
```

After reviewing the preview, remove eligible files in batches (repeat as needed):

```bash
docker compose exec -T backend python - --apply --scope recipes --limit 5000 < /tmp/upload-storage-recovery.py
df -h /
```

The command rescans references every time. A batch returns `deleted_gib` for the
amount actually reclaimed. Remaining candidates are processed on subsequent
runs. `--scope all` also includes the approximately 29 GiB of root-level cached
images. `--limit 0` removes all eligible candidates in one transaction, but holds
database writer locks longer; batches are preferable during normal operation.

If the backend container is stopped, start Docker and the existing backend/db
containers first (`systemctl start docker`, then `docker compose up -d db backend`).
If there is no room even to start them, clear package cache and older system
journals first as discussed. Do not remove Docker volume directories.

## Install the permanent fix

`upload-storage-fix.patch` contains the backend fixes, tests and compose setting.
It contains no environment files or credentials. Check compatibility before applying:

```bash
cd /apps/recipie
git apply --check /tmp/upload-storage-fix.patch
git apply /tmp/upload-storage-fix.patch
docker compose up -d --build --no-deps backend
docker compose logs --tail=100 backend
```

Apply only after recovering space so the Docker build has room. If the patch
check fails, keep the current server files and reconcile the source differences;
do not force-apply it. No database migration is required. The frontend need not
be rebuilt. If deploying by copying source instead, deploy the complete modified
backend and docker-compose.yml together.

The permanent backend runs orphan cleanup on startup and every hour, in batches
of 2,000 files, independently of per-owner and seven-day publication schedules.
`UPLOAD_ORPHAN_GRACE_HOURS` may extend the default 48-hour grace period. Recipe
and job deletion attempt immediate removal only after the database commit and
only when no remaining record needs the files. A failed removal is logged and
retried by the independent orphan sweep. Failed scheduled passes no longer
advance their successful-run timestamps. The existing Pinterest retention policy
is preserved.

New source uploads and generated article images reserve 512 MiB for Docker and
PostgreSQL. This protects these image writers; it is not a quota for other
applications, database growth, logs, or Facebook videos.

After deployment, the same preview/recovery tool is available in the image:

```bash
docker compose exec -T backend python -m app.scripts.cleanup_uploads --scope all
```
