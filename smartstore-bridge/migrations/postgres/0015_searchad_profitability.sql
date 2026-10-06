BEGIN;
-- Canonical rows are source-independent; existing legacy rows and indexes survive.
ALTER TABLE product_ad_mappings ALTER COLUMN source_product_id DROP NOT NULL;
ALTER TABLE product_ad_mappings
  ADD COLUMN valid_from timestamptz,
  ADD COLUMN valid_to timestamptz,
  ADD COLUMN allocation_json jsonb,
  ADD COLUMN binding_id uuid,
  ADD COLUMN identity_hash text,
  ADD COLUMN provenance text,
  ADD COLUMN actor_hash text,
  ADD CONSTRAINT product_ad_mapping_canonical_required CHECK
    (source_product_id IS NOT NULL OR (haar_product_id IS NOT NULL AND channel_product_id IS NOT NULL AND valid_from IS NOT NULL AND binding_id IS NOT NULL AND identity_hash IS NOT NULL AND provenance='manual')),
  ADD CONSTRAINT product_ad_mapping_validity CHECK (valid_to IS NULL OR valid_to>valid_from);
CREATE TABLE searchad_customer_channel_bindings (
  binding_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id text NOT NULL REFERENCES searchad_customer_accounts(customer_id),
  channel_id text NOT NULL REFERENCES sales_channels(channel_id),
  identity_hash text NOT NULL CHECK(identity_hash ~ '^[a-f0-9]{64}$'),
  source_identity text NOT NULL CHECK(source_identity ~ '^[a-f0-9]{64}$'),
  actor_hash text NOT NULL CHECK(actor_hash ~ '^[a-f0-9]{64}$'),
  verified_basis text NOT NULL DEFAULT 'configured_account_admin_binding' CHECK(verified_basis='configured_account_admin_binding'),
  created_at timestamptz NOT NULL,
  UNIQUE(customer_id,channel_id,identity_hash,source_identity),
  UNIQUE(binding_id,customer_id,channel_id)
);
ALTER TABLE product_ad_mappings ADD CONSTRAINT product_ad_mapping_binding_fk FOREIGN KEY(binding_id) REFERENCES searchad_customer_channel_bindings(binding_id);
CREATE UNIQUE INDEX product_ad_mapping_revision_uidx ON product_ad_mappings(customer_id,haar_product_id,channel_product_id,remote_entity_type,remote_entity_id,valid_from) WHERE source_product_id IS NULL;
CREATE FUNCTION searchad_validate_canonical_mapping() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP IN ('UPDATE','DELETE') AND OLD.valid_from IS NOT NULL THEN RAISE EXCEPTION 'immutable mapping revision'; END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  IF NEW.source_product_id IS NULL AND NOT EXISTS (
    SELECT 1 FROM channel_products cp JOIN searchad_customer_channel_bindings b ON b.binding_id=NEW.binding_id
    WHERE cp.channel_product_id=NEW.channel_product_id AND cp.haar_product_id=NEW.haar_product_id
      AND b.customer_id=NEW.customer_id AND b.channel_id=cp.channel_id AND b.identity_hash=NEW.identity_hash
  ) THEN RAISE EXCEPTION 'canonical mapping scope mismatch'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER searchad_canonical_mapping_scope BEFORE INSERT OR UPDATE OR DELETE ON product_ad_mappings FOR EACH ROW EXECUTE FUNCTION searchad_validate_canonical_mapping();
CREATE TABLE searchad_product_cost_inputs (
  cost_input_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id text NOT NULL REFERENCES searchad_customer_accounts(customer_id),
  haar_product_id uuid NOT NULL REFERENCES haar_products(haar_product_id),
  haar_variant_id uuid REFERENCES haar_product_variants(haar_variant_id),
  component text NOT NULL CHECK(component IN ('cogs','fees','shipping','seller_discount','return_provision')),
  amount_krw numeric(18,4) NOT NULL CHECK(amount_krw>=0),
  provenance text NOT NULL DEFAULT 'manual_estimate' CHECK(provenance='manual_estimate'),
  source_hash text NOT NULL CHECK(source_hash ~ '^[a-f0-9]{64}$'),
  reason_hash text NOT NULL CHECK(reason_hash ~ '^[a-f0-9]{64}$'),
  actor_hash text NOT NULL CHECK(actor_hash ~ '^[a-f0-9]{64}$'),
  valid_from timestamptz NOT NULL,
  valid_to timestamptz CHECK(valid_to>valid_from),
  created_at timestamptz NOT NULL
);
CREATE UNIQUE INDEX searchad_product_cost_revision ON searchad_product_cost_inputs(customer_id,haar_product_id,COALESCE(haar_variant_id,'00000000-0000-0000-0000-000000000000'::uuid),component,valid_from);
CREATE TABLE searchad_commerce_observations (
  observation_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id text NOT NULL REFERENCES searchad_customer_accounts(customer_id),
  haar_product_id uuid NOT NULL REFERENCES haar_products(haar_product_id),
  channel_product_id uuid NOT NULL REFERENCES channel_products(channel_product_id),
  binding_id uuid NOT NULL REFERENCES searchad_customer_channel_bindings(binding_id),
  capability text NOT NULL CHECK(capability IN ('productState','orderLines','adjustments','settlements')),
  since date NOT NULL, until date NOT NULL CHECK(until>=since),
  identity_hash text NOT NULL CHECK(identity_hash ~ '^[a-f0-9]{64}$'),
  source_identity text NOT NULL CHECK(source_identity ~ '^[a-f0-9]{64}$'),
  source_hash text NOT NULL CHECK(source_hash ~ '^[a-f0-9]{64}$'),
  rows_json jsonb NOT NULL CHECK(jsonb_typeof(rows_json)='array'),
  complete boolean NOT NULL DEFAULT false,
  missing_reasons jsonb NOT NULL CHECK(jsonb_typeof(missing_reasons)='array'),
  observed_at timestamptz NOT NULL,
  UNIQUE(customer_id,haar_product_id,channel_product_id,capability,since,until,identity_hash,source_identity,observed_at,source_hash)
);
CREATE INDEX searchad_commerce_selection ON searchad_commerce_observations(customer_id,haar_product_id,channel_product_id,capability,observed_at DESC);
-- Every writer must preserve the same Customer/product/channel/source tuple.
CREATE FUNCTION searchad_validate_commerce_observation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM searchad_customer_channel_bindings b
    JOIN channel_products cp ON cp.channel_id=b.channel_id
    WHERE b.binding_id=NEW.binding_id AND b.customer_id=NEW.customer_id
      AND b.identity_hash=NEW.identity_hash AND b.source_identity=NEW.source_identity
      AND cp.channel_product_id=NEW.channel_product_id AND cp.haar_product_id=NEW.haar_product_id
  ) THEN RAISE EXCEPTION 'commerce observation scope mismatch' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER searchad_commerce_observation_scope BEFORE INSERT ON searchad_commerce_observations FOR EACH ROW EXECUTE FUNCTION searchad_validate_commerce_observation();
-- Reserved Task9 durable outputs; Task8 cannot insert actual-profit or executable evidence.
CREATE TABLE searchad_profitability_snapshots (
  snapshot_id uuid PRIMARY KEY DEFAULT gen_random_uuid(), customer_id text NOT NULL REFERENCES searchad_customer_accounts(customer_id),
  haar_product_id uuid NOT NULL REFERENCES haar_products(haar_product_id), since date NOT NULL, until date NOT NULL CHECK(until>=since),
  input_hash text NOT NULL, quality text NOT NULL CHECK(quality IN ('actual','estimated','partial','unknown')),
  snapshot_json jsonb NOT NULL, created_at timestamptz NOT NULL
);
CREATE TABLE searchad_recommendations (
  recommendation_id uuid PRIMARY KEY DEFAULT gen_random_uuid(), customer_id text NOT NULL REFERENCES searchad_customer_accounts(customer_id),
  haar_product_id uuid NOT NULL REFERENCES haar_products(haar_product_id), input_hash text NOT NULL,
  recommendation_json jsonb NOT NULL, executable boolean NOT NULL DEFAULT false, created_at timestamptz NOT NULL
);
CREATE TRIGGER searchad_bindings_immutable BEFORE UPDATE OR DELETE ON searchad_customer_channel_bindings FOR EACH ROW EXECUTE FUNCTION searchad_reject_immutable_mutation();
CREATE TRIGGER searchad_costs_immutable BEFORE UPDATE OR DELETE ON searchad_product_cost_inputs FOR EACH ROW EXECUTE FUNCTION searchad_reject_immutable_mutation();
CREATE TRIGGER searchad_commerce_immutable BEFORE UPDATE OR DELETE ON searchad_commerce_observations FOR EACH ROW EXECUTE FUNCTION searchad_reject_immutable_mutation();
CREATE TRIGGER searchad_profitability_immutable BEFORE UPDATE OR DELETE ON searchad_profitability_snapshots FOR EACH ROW EXECUTE FUNCTION searchad_reject_immutable_mutation();
CREATE TRIGGER searchad_recommendations_immutable BEFORE UPDATE OR DELETE ON searchad_recommendations FOR EACH ROW EXECUTE FUNCTION searchad_reject_immutable_mutation();
COMMIT;
