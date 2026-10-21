-- Idempotent, additive schema. Application records keep their existing fields
-- in JSONB; overview views expose common columns to pgAdmin/TablePlus/SQL.
CREATE SCHEMA IF NOT EXISTS fiable;
CREATE TABLE IF NOT EXISTS fiable.schema_migrations (
    version integer PRIMARY KEY,
    applied_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS fiable.collections (
    name text PRIMARY KEY,
    shape text NOT NULL CHECK (shape IN ('list', 'map', 'document'))
);
DO $$
DECLARE entity text;
BEGIN
    FOREACH entity IN ARRAY ARRAY[
        'accounts', 'admin_credentials', 'deliveries', 'riders', 'subscriptions',
        'rider_notifications', 'rider_payments', 'submissions', 'audit_log',
        'unit_adjustments', 'support_tickets', 'notification_log', 'payments',
        'reset_tokens', 'batch_routing', 'haulage_bookings'
    ] LOOP
        EXECUTE format('CREATE TABLE IF NOT EXISTS fiable.%I (
            record_key text PRIMARY KEY,
            position bigint NOT NULL,
            data jsonb NOT NULL,
            updated_at timestamptz NOT NULL DEFAULT now()
        )', entity);
    END LOOP;
END $$;
CREATE TABLE IF NOT EXISTS fiable.proof_files (
    filename text PRIMARY KEY,
    content bytea NOT NULL,
    mime_type text NOT NULL,
    sha256 text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS deliveries_vendor_idx ON fiable.deliveries ((data->>'accountEmail'));
CREATE INDEX IF NOT EXISTS deliveries_tracking_idx ON fiable.deliveries ((data->>'trackingCode'));
CREATE INDEX IF NOT EXISTS payments_reference_idx ON fiable.payments ((data->>'reference'));
CREATE INDEX IF NOT EXISTS accounts_email_idx ON fiable.accounts ((lower(data->>'email')));
CREATE INDEX IF NOT EXISTS riders_email_idx ON fiable.riders ((lower(data->>'email')));

CREATE OR REPLACE VIEW fiable.accounts_overview AS
SELECT record_key, data->>'email' AS email, data->>'name' AS name,
    data->>'subscriberId' AS subscriber_id, data->>'plan' AS plan,
    data->>'paymentStatus' AS payment_status, data->>'createdAt' AS created_at
FROM fiable.accounts;
CREATE OR REPLACE VIEW fiable.deliveries_overview AS
SELECT record_key, data->>'orderRef' AS order_ref, data->>'trackingCode' AS tracking_code,
    data->>'accountEmail' AS vendor_email, data->>'pickup' AS pickup,
    data->>'dropoff' AS dropoff, data->>'status' AS status,
    data->>'units' AS units, data->>'cost' AS cost,
    data->>'riderId' AS rider_id, data->>'createdAt' AS created_at
FROM fiable.deliveries;
CREATE OR REPLACE VIEW fiable.riders_overview AS
SELECT record_key, data->>'name' AS name, data->>'email' AS email,
    data->>'phone' AS phone, data->>'status' AS status, data->>'vehicle' AS vehicle
FROM fiable.riders;
CREATE OR REPLACE VIEW fiable.payments_overview AS
SELECT record_key, data->>'reference' AS reference, data->>'vendorEmail' AS vendor_email,
    data->>'amount' AS amount, data->>'status' AS status, data->>'plan' AS plan,
    data->>'createdAt' AS created_at
FROM fiable.payments;
CREATE OR REPLACE VIEW fiable.locations_overview AS
SELECT location->>'id' AS location_id, location->>'label' AS location_name,
    location->>'zone' AS pricing_zone
FROM fiable.batch_routing
CROSS JOIN LATERAL jsonb_array_elements(COALESCE(data->'locations', '[]'::jsonb)) AS location;
INSERT INTO fiable.schema_migrations (version) VALUES (1) ON CONFLICT DO NOTHING;
