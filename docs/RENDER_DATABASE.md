# Hosting Fiable with Render Postgres

Fiable supports PostgreSQL through the server-side `DATABASE_URL` environment
variable. With this variable set, app records and proof uploads live in Postgres;
JSON files are not used as a fallback if the database is unavailable. The local
JSON mode remains available when `DATABASE_URL` is absent.

The supplied `render.yaml` prepares a paid Python web service and a paid Render
Postgres 17 database in Frankfurt. Review the plans, region and charges in
Render before creating resources. Automatic deploys are disabled in the file.
No Render resources are created merely by adding this file to the repository.

Render's free Postgres tier expires after 30 days and is intended for evaluation,
not a live business database. See [Render's free-tier limits](https://render.com/docs/free).

## Create the Render resources

1. Push the application changes to the Git repository you will deploy.
2. In Render, create a **Blueprint** from that repository and review `render.yaml`.
   It defines the `fiable` web service and `fiable-db` database. If an existing
   service/database uses either name, review the proposed changes before applying.
3. Confirm the region and paid plans. The web service and database must use the
   same region to use the internal connection URL.
4. The Blueprint sets `DATABASE_URL` from the database's internal connection
   string, `REQUIRE_DATABASE=true`, and `APP_ENV=production`. It installs
   `requirements.txt` and starts `python -B -u server.py`.
5. Check `/api/health`. Startup creates the additive schema if needed. It does
   not automatically import the JSON files bundled in the repository.

For a manually configured web service, use the same build/start commands and
environment variables. Set `DATABASE_URL` to your database's **Internal Database
URL** in Render's Environment page. Keep the URL out of HTML, JavaScript,
Git commits and screenshots. `REQUIRE_DATABASE=true` prevents an accidentally
missing URL from starting the deployment in file-storage mode.

References: [Blueprints](https://render.com/docs/infrastructure-as-code),
[database connections](https://render.com/docs/postgresql-creating-connecting).

## Import existing Fiable records

Use a backup from the server that holds the latest real data. For the local app,
the source is its `data` directory. For an existing Railway deployment, copy the
current persistent volume contents, including `proof/`; a Git checkout might
contain older development data.

Pause bookings, payments and admin updates on the source app while making the
final backup and switching hosts, so changes cannot occur after the snapshot.
Keep that source backup until the migration has been verified.

First validate the backup. This does not connect to a database or change data:

```powershell
python -B manage_database.py import-json --source data
```

To import from your Windows computer:

1. In Render, open `fiable-db`, add your current public IP to its external access
   allowlist, and copy its **External Database URL**. The Blueprint initially
   permits internal access only. Use TLS for the external connection
   (`sslmode=require` in the URL's query string).
2. Install the driver in the project environment:

   ```powershell
   python -B -m pip install -r requirements.txt
   ```

3. Set the URL privately in the terminal. This prompt masks the URL:

   ```powershell
   $fiableDatabaseSecret = Read-Host 'Paste the external database URL' -AsSecureString
   $env:DATABASE_URL = [System.Net.NetworkCredential]::new('', $fiableDatabaseSecret).Password
   ```

4. Import into an empty target:

   ```powershell
   python -B manage_database.py import-json --source data --apply
   python -B manage_database.py check
   ```

5. Verify admin and vendor logins, balances, delivery tracking, riders, location
   rules and proof images through the new website before switching your domain.
6. Remove your external IP allowlist entry when no longer needed. Clear the URL
   from your terminal session with `Remove-Item Env:DATABASE_URL`.

The import validates the known data files, preserves passwords/hashes, IDs,
tracking codes and dispatcher settings, and verifies imported values and proof
bytes before committing. All imported collections and uploads commit together.
The importer refuses a database that already contains app records or uploads.
It never deletes or modifies the source files. Repair invalid JSON or missing
proof files in a backup copy before retrying a failed validation.

Do not create a bootstrap admin on the target before importing existing data:
that would make the target nonempty. For a completely new business database
with no records to import, set `ADMIN_BOOTSTRAP_EMAIL` and
`ADMIN_BOOTSTRAP_PASSWORD` in Render instead, deploy once, then remove these
bootstrap variables. The existing bootstrap helper resets that account's
password whenever it runs with those variables present.

## Manage the database yourself

Use Fiable's Admin portal for everyday customer, rider, order and location work.

For database administration in a browser, open the Postgres database in Render,
select **Apps**, and deploy **pgAdmin**. Render shows the extra web-service cost
before creation and connects it over the private network. Save its separate
login credentials. See [Render's admin-app instructions](https://render.com/docs/postgresql-apps).

Alternatively, connect an installed desktop PostgreSQL client such as TablePlus
or pgAdmin with the External Database URL, TLS, and your IP allowlisted. The
internal URL is for the Render-hosted application; it will not work from your
computer.

In the database client, expand the **fiable** schema. It contains separate
tables for accounts, deliveries, riders, subscriptions, payments, admin accounts,
support tickets, audit logs, routing settings and other app records. Each row
has a stable `record_key`, an ordering value, and the existing record fields in
a `data` JSONB column. This is a database-backed document model; the current
app's nested records have not been converted into a fully normalized schema.

The `accounts_overview`, `deliveries_overview`, `riders_overview`,
`payments_overview` and `locations_overview` views make common fields easier to
browse without opening the JSONB records. For example:

```sql
SELECT order_ref, vendor_email, pickup, dropoff, status, units
FROM fiable.deliveries_overview;
```

Use the application for business edits so its validation, balance calculations
and audit trail run. Database credentials grant direct access to authentication
records and personal information; give them only to trusted administrators.

## Backups and recovery

Use Render's backup/recovery controls for the selected paid plan. An additional
portable application snapshot can be created with:

```powershell
python -B manage_database.py export-json --destination database_exports/fiable-backup-2026-10-14
```

Exports include all app records, proof images and a SHA-256 manifest. Choose a
new directory each time. They contain private customer and authentication data;
store them securely. The suggested export folder is ignored by Git.

Validate an export with `import-json --source <export-directory>`. Restore it
into a new empty database using `--apply`, verify the restored app, then change
the service's connection URL. Keep the original database available until the
restore has been checked. See [Render recovery and backups](https://render.com/docs/postgresql-backups).

## Current operating limits

Keep one web-service instance: login sessions are still stored in process memory,
so a restart signs users out and multiple replicas would need shared sessions.
Postgres transactions serialize the app's existing record-list updates across
connections. This preserves balance checks and prevents competing writes from
losing records; it is not a high-throughput, normalized query implementation.

Proof images are stored as database binary records, retaining the current 5 MB
per-file upload limit. A separate object store can be introduced later if upload
volume warrants it. A persistent Render disk is not required for these uploads.

The legacy `reset_for_launch.py` and `seed_test_data.py` file tools are disabled
when `DATABASE_URL` is set. They are not database migration or restore tools.

## Local verification

The existing regression scripts run in temporary JSON directories. PostgreSQL
integration checks use a local server and create their own randomly named test
databases, leaving other databases untouched:

```powershell
$env:FIABLE_TEST_DATABASE_URL = 'postgresql://TEST_USER@127.0.0.1:5432/postgres'
python -B tests/postgres_checks.py
```

The integration tests cover import/export/restore, transaction rollback,
concurrent writes and booking balances, customer/admin/rider APIs, saved
locations, proof retrieval, persistence across new connections, and failure to
commit a response before the database transaction succeeds.
