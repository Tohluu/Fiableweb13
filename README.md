# Fiable

Run the local app with `python server.py`, then open `http://localhost:8080`.
Restart the server after changing Python code.

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

Fiable now supports Render Postgres. Set `DATABASE_URL` on the server to use
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

Open **Admin → Settings → Delivery areas & batch groups**.

1. Review the proposed delivery areas. Each supported location belongs to one
   area. You can rename areas, add an area and move locations into it, or remove
   an area after moving its locations elsewhere.
   To add a missing neighbourhood or town, use **Add a location** in this section:
   enter its name, choose its pricing zone and delivery area, then select
   **Add location to draft**. The pricing zone determines normal route units;
   the area determines batch grouping. Custom location names and pricing zones
   can be edited in the location list. Standard locations keep their existing
   pricing zones.
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

Rules and the shared location list are stored in `DATA_DIR/batch_routing.json`, using the same persistent
storage root as orders. A missing file uses the proposed defaults; an invalid
file stops location loading and delivery quoting until repaired. Older routing
files automatically receive the standard location list when read, preserving
their area assignments and pickup rules. Grouping uses selected locations and
configured areas, without GPS, traffic or automatic road routing.

## Verification

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
