-- =============================================================================
-- 002 — Plant document library + indexes for cross-plant equipment search.
--
-- Apply once, as the schema owner, to an existing database:
--     psql "$OWNER_DSN" -f database/migrations/002_documents_and_equipment_search.sql
--     psql "$OWNER_DSN" -f database/roles.sql          # grants for the new tables
-- Fresh installs: seed_from_json.py --apply-schema applies migrations/ after schema.sql.
--
-- Documents are metadata rows in plant_documents plus the file itself, held
-- either in plant_document_blobs (storage = 'db', the default: nothing outside
-- PostgreSQL to back up) or on the API server's disk (storage = 'fs', for large
-- drawings). See api/pdm_api/documents.py.
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- Document library, one list per plant
-- -----------------------------------------------------------------------------

CREATE TABLE plant_documents (
    id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    plant_id      bigint      NOT NULL REFERENCES plants (id) ON DELETE CASCADE,
    category      text        NOT NULL CHECK (category IN (
                      'pid', 'electrical', 'mechanical', 'layout', 'manual',
                      'datasheet', 'report', 'certificate', 'photo', 'other')),
    title         text        NOT NULL CHECK (btrim(title) = title AND length(title) BETWEEN 1 AND 300),
    description   text        CHECK (description IS NULL OR length(description) BETWEEN 1 AND 2000),
    -- Name as uploaded, kept verbatim so the file downloads under its own name.
    file_name     text        NOT NULL CHECK (length(file_name) BETWEEN 1 AND 300),
    content_type  text        NOT NULL CHECK (length(content_type) BETWEEN 1 AND 200),
    byte_size     bigint      NOT NULL CHECK (byte_size > 0),
    sha256        text        NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
    storage       text        NOT NULL CHECK (storage IN ('db', 'fs')),
    -- 'fs': path relative to the document root. 'db': the blob row's key (= id).
    storage_key   text        NOT NULL CHECK (length(storage_key) BETWEEN 1 AND 500),
    uploaded_by   text,
    created_at    timestamptz NOT NULL DEFAULT now(),
    updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX plant_documents_plant_idx    ON plant_documents (plant_id, created_at DESC);
CREATE INDEX plant_documents_category_idx ON plant_documents (category);
CREATE INDEX plant_documents_sha256_idx   ON plant_documents (sha256);
-- One file per plant per name and category; re-uploading replaces it explicitly.
CREATE UNIQUE INDEX plant_documents_unique_file ON plant_documents (plant_id, category, lower(file_name));

-- File bytes. Separate table so listing documents never reads them, and so the
-- audit trigger below (on plant_documents only) never copies a file into change_log.
CREATE TABLE plant_document_blobs (
    document_id  bigint PRIMARY KEY REFERENCES plant_documents (id) ON DELETE CASCADE,
    bytes        bytea  NOT NULL
);

CREATE TRIGGER plant_documents_set_updated_at BEFORE UPDATE ON plant_documents
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Upper-case name so it fires before the RI cascade triggers (see log_change).
CREATE TRIGGER AUDIT_plant_documents AFTER INSERT OR UPDATE OR DELETE ON plant_documents
    FOR EACH ROW EXECUTE FUNCTION log_change();

-- -----------------------------------------------------------------------------
-- Cross-plant equipment search
--
-- The search matches make / model / name across every equipment table at once
-- (see api/pdm_api/equipment.py). `make` columns were already indexed by
-- schema.sql; these add the model and name columns the search also groups by.
-- -----------------------------------------------------------------------------

CREATE INDEX pumps_and_motors_pump_model_idx ON pumps_and_motors (lower(pump_model));
CREATE INDEX instruments_model_idx           ON instruments (lower(model));
CREATE INDEX instruments_name_idx            ON instruments (lower(name));
CREATE INDEX hmi_plc_model_idx               ON hmi_plc (lower(model));
CREATE INDEX hmi_plc_name_idx                ON hmi_plc (lower(name));
CREATE INDEX vfds_model_idx                  ON vfds (lower(model));
CREATE INDEX vfds_name_idx                   ON vfds (lower(name));
CREATE INDEX dosing_pumps_model_idx          ON dosing_pumps (lower(model));
CREATE INDEX dosing_pumps_for_idx            ON dosing_pumps (lower(dosing_pump_for));
CREATE INDEX filters_name_idx                ON filters (lower(name));
CREATE INDEX hp_pump_accessory_groups_name_idx ON hp_pump_accessory_groups (lower(group_name));
CREATE INDEX hp_pump_accessory_entries_group_idx ON hp_pump_accessory_entries (group_id);

COMMIT;
