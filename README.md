# Apexwings

The website uses Apexwings Logistics branding and the selected blue A/wing logo
from the bottom-left option in the supplied logo sheet. `images/apexwings-logo.png`
contains the full logo and tagline; `images/apexwings-symbol.png` is the compact
symbol used beside the website wordmark. Shared sizing lives in `brand.css`.
Existing contact details, storage keys and infrastructure names are retained
for compatibility.

Run the local app with `python server.py`, then open `http://localhost:8080`.
Restart the server after changing Python code.

## Admin team access and email setup

**Admin → Team** supports role changes, access revocation/restoration, deletion,
password-reset emails, invitation resends, search, last sign-in (Lagos time),
MFA status and a permission summary for each role. The original Owner and your
own role/access cannot be removed or changed here. Other Super Admin accounts
can be managed by an Owner or Super Admin. Legacy Staff is displayed separately
with its actual permissions. Role changes sign the affected person out.

Choose **Email invitation** to send a 24-hour setup link. An invited account
cannot sign in until its owner sets a password. Failed invitations remain
pending and can be resent. **Temporary password** remains available for manual
setup; the admin must choose a different password on first login.

Configure these server environment variables to enable email invitations and
password resets (the app does not automatically load `.env`):

```text
APP_BASE_URL=https://YOUR-DOMAIN
EMAIL_PROVIDER=smtp
EMAIL_FROM=accounts@YOUR-DOMAIN
SMTP_HOST=your-provider-smtp-host
SMTP_PORT=587
SMTP_SECURITY=starttls
SMTP_USERNAME=your-provider-username
SMTP_PASSWORD=your-provider-password
```

Use your provider's real SMTP settings and authorized sender. Implicit TLS uses
`SMTP_SECURITY=ssl` and `SMTP_PORT=465`. Production requires an HTTPS base URL;
local development may use an HTTP localhost URL. The Team page shows whether
email is configured and disables email-only actions when it is unavailable.
Delivery failures are reported without claiming a successful send.

Public admin recovery always returns the same acknowledgement for known and
unknown accounts, without exposing a link. Admin links are stored as hashes,
scoped to admin setup/recovery, single-use and time-limited. Older shared
customer/rider reset links cannot reset an admin account. Resending replaces
the previous admin link. Links travel in URL fragments and are removed from
the address bar when opened. Recovery preserves MFA, revokes existing sessions
and pending login challenges, and requires a fresh login. Revoking or deleting
an account invalidates its links; restored pending invitations must be resent.

`python -B tests/admin_team_checks.py` verifies account lifecycle, recovery,
invitations, session invalidation, SMTP transport and concurrency using temporary
records and mocked email. `node --test tests/admin_team_ui_checks.cjs` checks
Team controls, permission display, legacy roles and recovery page behavior.

## Bulk haulage payments

Open **Admin → Payments overview → Bulk haulage payments**. Haulage enquiries
still go through WhatsApp; they are not automatically saved as paid bookings.
After agreeing a quote, an owner or finance administrator can record the customer,
route, load, agreed amount and dates. Record each deposit or balance payment with
the actual received date, method and optional reference. Each booking shows the
quote, received total, remaining customer balance, payment status and receipt history.
Search by customer, booking reference or route, or filter by payment status.
Admins with financial viewing access can inspect the register without changing it.

Confirmed haulage receipts count in the overview's monthly and annual receipts,
using Lagos payment dates. An unpaid quote does not count as revenue. Outstanding
haulage includes balances across all bookings, independently of the month selected.
Use **Record a van payment or other expense** to record amounts already paid
against a job. Categories include van payments, fuel, loading/unloading,
tolls/parking and other expenses. Record the amount, paid date, recipient,
description, method and optional reference. Multiple entries support van deposits
and balance payments. Fully paid and unpaid customer bookings both accept expenses;
costs may exceed receipts or the agreed quote. No expense is inferred from a quote.

Each booking shows van payments, other expenses, total paid expenses and
**net received = customer receipts − paid expenses**. Customer debt remains
**agreed quote − customer receipts**; spending money does not reduce what the
customer owes. Expense history retains the paid date and recording administrator.
Monthly and annual cost totals use the Lagos paid date, independently of when
customer receipts arrive, so a month or job can show a negative net received.
The overview's **After recorded costs** subtracts rider costs and paid haulage
expenses from receipts. Unrecorded operating costs are excluded, so this is not
net profit. Existing bookings without expenses start at zero costs on read,
without rewriting their records. Duplicate retries are idempotent,
overpayments and reused payment references are rejected, and changes are audited.

Records use `DATA_DIR/haulage_bookings.json` locally or the `haulage_bookings`
PostgreSQL collection. The additive schema creates the table during server startup
and includes it in database imports and backups. No previous WhatsApp payments
are imported automatically. Restart the server after updating the application.

`python -B tests/haulage_payment_checks.py` verifies partial and full receipts,
van payments, expense categories, negative net receipts, legacy records,
permissions, concurrency, persistence, monthly/annual totals and invalid input using
temporary records. `node --test tests/haulage_payment_ui_checks.cjs` checks the
payment view, search, receipt form, read-only access and failed-request retries.

## Express delivery bookings

The express form on `get-started.html#quick-express` offers WhatsApp enquiries
and website bookings without an account. Website bookings collect pickup and
recipient contacts, addresses and delivery areas, and show an estimate at
₦2,000 per route unit. No subscription units are deducted. Customers can choose
**Pay online** through Paystack or **Arrange payment with dispatch**. Online
checkout asks for a receipt email and charges the saved delivery total. Bookings
are saved as pending Express orders with a tracking code;
retries of the same submission do not create another order.

In **Admin → Orders**, select **Website express bookings**, open an order and
use **Assign Rider**. The rider must be signed in and available under the
existing dispatch rules. The assigned booking appears in that rider's dashboard
and notifications. Assignment is performed by dispatch and depends on availability.

After receiving an express customer's payment, an owner or finance administrator
can open the order and select **Mark payment received**, recording cash, bank
transfer or POS and an optional reference. The saved payment status then shows
**Payment received**. Booking or completing a delivery alone does not mark it paid.

To enable online checkout, set `PAYMENTS_ENABLED=true`, `PAYMENT_PROVIDER=paystack`
and `PAYSTACK_SECRET_KEY` in the server environment, then restart the server.
Use a Paystack test key to test checkout before using live credentials. Configure
the Paystack webhook URL as `https://YOUR-DOMAIN/api/payments/paystack/webhook`.
The app does not load `.env` automatically. Never put secret keys in frontend
files or commit them. When payment settings are absent, the form clearly shows
online checkout as unavailable and still supports arranging payment with dispatch.

Successful checkout returns to the booking confirmation. Both that return and
the signed webhook independently verify the reference, amount, currency and
customer with Paystack before recording payment on the order. Confirmed online
receipts feed the Payments overview automatically. Failed or cancelled checkout
keeps the original booking for retry; an ambiguous payment stays unconfirmed.
Duplicate initialization reuses the checkout, and late extra payments are flagged
for review instead of crediting the same delivery twice.

**Admin → Payments overview** combines paid subscriptions and confirmed website
express payments, with separate monthly totals, year-to-date receipts and unpaid
website bookings. Receipts use the payment date in Lagos time. Completed-delivery
rider costs are attributed to the completion date; the remaining amount excludes
other business expenses. Subscription summaries contain only subscription receipts
and subscription delivery rider costs. Existing confirmed express receipts are
included automatically without re-entering payments.

Run `python -B tests/payment_overview_checks.py` for isolated summary checks.

Run `python -B tests/express_delivery_checks.py` for isolated booking-to-delivery checks.

## PostgreSQL and Render hosting

Apexwings now supports Render Postgres. Set `DATABASE_URL` on the server to use
PostgreSQL for app records and proof uploads. Set `REQUIRE_DATABASE=true` in
production so a missing connection URL cannot start file-storage mode.
Without `DATABASE_URL`, local development continues to use JSON files.

See [Render database setup and migration](docs/RENDER_DATABASE.md) for creating
the database, importing existing records, backups and managing it with pgAdmin.
The supplied `render.yaml` defines paid resources for review; it has not been
deployed. Existing data is never imported automatically on startup.

Install database dependencies with `python -B -m pip install -r requirements.txt`.
Validate a JSON backup without writing data with
`python -B manage_database.py import-json --source data`.

## Trying delivery areas and batch groups

Open **Admin → Settings → Pricing zones, delivery areas & batch groups**.

In **Pricing zone names and route units**, rename any pricing zone and set
1–7 units for every pair of zones. Prices are symmetric: a route has the same
units in either direction. A zone paired with itself controls within-zone
journeys, including bookings with the same pickup and destination location.
Use **Delivery areas and location assignments** to change the pricing zone
of any standard or custom location. Save with **Save routing rules**.

The original Lekki zone is split into **Lekki Corridor 1** (Ikate, Ilasan,
Marwa, Jakande, Osapa London, Chevron, Ikota and Orchid Road) and **Lekki
Corridor 2** (VGC, Ajah, Abraham Adesanya, Sangotedo and Lekki Phase 2).
Lekki Phase 1 remains in Central Island. These assignments are editable.
Both corridors inherit the former zone's route units until edited. Existing
routing files receive the split, names and route units when read, without
changing their delivery areas, batch groups or stored orders.

**Mainland North-West** starts with Ayobo, Ipaja, Abule Egba, Agbado and
Alagbado. **Mainland North-East** starts with Agege and Ifako-Ijaiye. Mainland
North retains Egbeda, Shasha, Igando, Idimu and Ikotun. Ikeja and Kosofe stay
in Mainland East. These are editable operational groups, not measured road
distance boundaries.

Existing eight-zone settings are upgraded on read. Original zone-pair rates
and custom zone names are preserved; only unchanged old default labels are
updated. Standard locations move to the new northern zones only if they still
have their former default assignment. Explicit assignments elsewhere are kept.
New rows inherit the highest saved North/West rate for their constituent
locations, with a minimum of 2 units, including within-zone journeys. With the
original rates, Egbeda–Ipaja, Egbeda–Ifako-Ijaiye and within the new northern
zones start at 3 units. Review and edit these starting charges before launch.
Saved orders, delivery areas and batch discount groups are unchanged.

1. Review the proposed delivery areas. Each supported location belongs to one
   area. You can rename areas, add an area and move locations into it, or remove
   an area after moving its locations elsewhere.
   To add a missing neighbourhood or town, use **Add a location** in this section:
   enter its name, choose its pricing zone and delivery area, then select
   **Add location to draft**. The pricing zone determines normal route units;
   the area determines batch grouping. Custom location names and all location
   pricing zones can be edited in the location list.
2. Choose a pickup area. Destination areas start in separate discount groups.
   Give two or more areas the same group name to combine them for that pickup
   area only. Validate combinations with your dispatcher before saving.
3. Use **Try a batch without booking** to compare pickup locations and delivery
   counts against your current edits. Tests use Basic plan pricing and next-day
   delivery; they do not save rules, create orders or deduct units.
4. Select **Save routing rules** to apply the configuration to new quotes.
   Saved locations appear in the public delivery calculator and in both single
   and batch pickup/destination dropdowns when the customer refreshes the page
   or returns to its browser tab. Full
   street addresses are still entered separately for each delivery.

The Lagos catalog includes 30 additional neighbourhoods across the mainland,
island and both Lekki corridors. Existing settings receive these once, without
overwriting saved prices, location assignments or batch groups. Matching IDs or
names already added by an administrator are retained. New locations initially
have separate delivery areas; combine areas only after reviewing dispatch routes.
All 30 names, pricing zones and area assignments are editable in the location
list above. Berger is clarified to Ojodu Berger, keeping its existing ID and zone.
The catalog version is saved with routing settings so later admin edits persist.

For example, test three Lekki Phase 1, three Chevron and three Sangotedo
deliveries from Egbeda. They initially form three groups. For the Alimosho pickup
area, assign Lekki Phase 1 / Ikate and Chevron / Ikota the same test group name.
The dry run then shows two groups from Egbeda, while a pickup in Ikeja still
produces three. This demonstrates the rule mechanism, not a validated dispatch
recommendation.

Owners and operations managers can save rules. Dispatchers and analysts can
inspect and test them. Concurrent admin edits require reloading saved rules.
If rules or quoted prices change after a customer previews a batch, the customer
must review a fresh quote before confirming. Existing orders retain their saved
prices, group labels and routing version.

Pricing zones, route units, rules and the shared location list are stored in `DATA_DIR/batch_routing.json`, using the same persistent
storage root as orders. A missing file uses the proposed defaults; an invalid
file stops location loading and delivery quoting until repaired. Older routing
files automatically receive the standard location list when read, preserving
their area assignments and pickup rules. Grouping uses selected locations and
configured areas, without GPS, traffic or automatic road routing.

## Verification

`python -B tests/lagos_location_checks.py` checks the 30-location rollout,
existing settings and duplicate preservation, public quotes, express/batch
bookings, and persisted admin edits without changing existing orders.

`python -B tests/pricing_zone_checks.py` checks both corridors, legacy migration,
all original route prices, editable route units and location assignments,
draft previews, public/express/subscriber/batch pricing, invalid input,
permissions, concurrent edits, stale quotes and preserved booking snapshots.

`python -B tests/batch_delivery_checks.py` checks pricing, allocation and booking.
`python -B tests/batch_routing_checks.py` checks pickup-specific grouping,
configuration validation, permissions, persistence and outdated quote handling.
Both use temporary storage.
`python -B tests/delivery_location_checks.py` checks adding locations, legacy
settings, public dropdown data, pricing and single/batch booking.
`node --test tests/services_calculator_checks.cjs` checks public calculator
location loading, saved-location updates, selected routes, CSRF and error recovery.

For browser checks, run `python -B tests/batch_delivery_checks.py --serve` and a
headless Chromium/Edge browser with a temporary profile and debugging port 9224.
Run `node tests/batch_browser_checks.cjs`, followed by
`node tests/batch_routing_browser_checks.cjs`. All bookings and configuration edits
in these checks target the isolated fixture at port 8093.
