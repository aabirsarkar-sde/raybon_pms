-- =============================================================================
-- Plant Data Management System — PostgreSQL schema (v1)
--
-- Source pipeline:  legacy HTML -> plantdata_export/structured/*.json -> here
--
-- Design rules
--   * Legacy values are stored as TEXT exactly as extracted. Placeholders such
--     as 'N/A', 'NA', '-', 'NIL', 'Nil', 'na', 'nA' are kept verbatim; NULL only
--     means the legacy element was empty/absent.
--   * Every legacy-derived row keeps an immutable copy of its original JSON in
--     `source` (and `source_value` where requested). Working columns start out
--     identical to the source and may be corrected later; the source may not.
--     Rows created by the new application have source = NULL.
--   * The complete original record for each plant is kept, immutable, in
--     legacy_plant_records.
--   * Row order from the legacy page is kept in `position` (1-based).
--   * legacy_plant_id is the authoritative legacy identity. serial_number is
--     NOT unique (three legacy serials are shared by two plants each).
--   * Derived columns (value_numeric, quantity, ...) are only filled when the
--     source text is unambiguous; otherwise NULL. They never replace the text.
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- Helper functions
-- -----------------------------------------------------------------------------

CREATE FUNCTION set_updated_at() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    NEW.updated_at := now();
    RETURN NEW;
END $$;

-- Rejects changes to the named columns once they hold a non-NULL value.
-- Usage: ... EXECUTE FUNCTION protect_source_columns('source', 'source_value')
CREATE FUNCTION protect_source_columns() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
    col text;
    o   jsonb := to_jsonb(OLD);
    n   jsonb := to_jsonb(NEW);
BEGIN
    FOREACH col IN ARRAY TG_ARGV LOOP
        IF o->col <> 'null'::jsonb AND o->col IS DISTINCT FROM n->col THEN
            RAISE EXCEPTION '%.% holds immutable legacy source data', TG_TABLE_NAME, col
                USING ERRCODE = 'integrity_constraint_violation';
        END IF;
    END LOOP;
    RETURN NEW;
END $$;

CREATE FUNCTION forbid_modification() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION '% rows are immutable legacy snapshots (% not allowed)', TG_TABLE_NAME, TG_OP
        USING ERRCODE = 'integrity_constraint_violation';
END $$;

-- True for the placeholder spellings found in the legacy data. For querying
-- only; the stored text is never rewritten.
CREATE FUNCTION is_placeholder(v text) RETURNS boolean
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
    SELECT lower(btrim(v)) IN ('n/a', 'na', '-', 'nil', 'none', 'null')
$$;

-- Numeric view of a text value, only when the whole string is a plain number
-- ("87.5" -> 87.5; "<10", "6-8", "NA", "15 MAX" -> NULL).
CREATE FUNCTION strict_numeric(v text) RETURNS numeric
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
    SELECT CASE WHEN btrim(v) ~ '^[+-]?([0-9]+(\.[0-9]*)?|\.[0-9]+)$'
                THEN btrim(v)::numeric END
$$;

-- -----------------------------------------------------------------------------
-- Change log: append-only, written by trigger on INSERT / UPDATE / DELETE of
-- every data table. Writers set, per transaction:
--   SET LOCAL pdm.changed_by    = '<user>';
--   SET LOCAL pdm.change_reason = '<why>';
--   SET LOCAL pdm.request_id    = '<id grouping one API request>';
-- The initial legacy import sets pdm.bulk_import = 'on' so its INSERTs are not
-- logged row by row (the import is recorded in import_batches instead).
-- -----------------------------------------------------------------------------

CREATE TABLE change_log (
    id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    table_name   text        NOT NULL,
    row_id       bigint      NOT NULL,
    plant_id     bigint,                     -- plant the row belongs to (no FK: survives deletes)
    operation    text        NOT NULL CHECK (operation IN ('INSERT', 'UPDATE', 'DELETE')),
    column_name  text,                       -- UPDATE only
    old_value    jsonb,                      -- UPDATE only
    new_value    jsonb,                      -- UPDATE only
    old_row      jsonb,                      -- DELETE: full row
    new_row      jsonb,                      -- INSERT: full row
    changed_by   text,
    reason       text,
    request_id   text,
    changed_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX change_log_row_idx ON change_log (table_name, row_id);
CREATE INDEX change_log_plant_idx ON change_log (plant_id, id);
CREATE INDEX change_log_changed_at_idx ON change_log (changed_at);
CREATE INDEX change_log_request_idx ON change_log (request_id);

-- SECURITY DEFINER so application roles need no write privilege on change_log.
CREATE FUNCTION log_change() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    o      jsonb := to_jsonb(OLD);
    n      jsonb := to_jsonb(NEW);
    r      jsonb := coalesce(to_jsonb(NEW), to_jsonb(OLD));
    k      text;
    pid    bigint;
    who    text := nullif(current_setting('pdm.changed_by', true), '');
    why    text := nullif(current_setting('pdm.change_reason', true), '');
    req    text := nullif(current_setting('pdm.request_id', true), '');
BEGIN
    IF TG_OP = 'INSERT' AND current_setting('pdm.bulk_import', true) = 'on' THEN
        RETURN NEW;
    END IF;

    -- Resolve the owning plant. Grandchild rows removed by ON DELETE CASCADE can
    -- no longer see their parent, so fall back to the parent's own DELETE entry
    -- (logged first because the audit trigger name sorts before the RI triggers).
    pid := CASE
        WHEN TG_TABLE_NAME = 'plants' THEN (r->>'id')::bigint
        WHEN r ? 'plant_id' THEN (r->>'plant_id')::bigint
        WHEN TG_TABLE_NAME = 'filter_values' THEN coalesce(
            (SELECT f.plant_id FROM filters f WHERE f.id = (r->>'filter_id')::bigint),
            (SELECT c.plant_id FROM change_log c WHERE c.table_name = 'filters'
                AND c.row_id = (r->>'filter_id')::bigint ORDER BY c.id DESC LIMIT 1))
        WHEN TG_TABLE_NAME = 'hp_pump_accessory_entries' THEN coalesce(
            (SELECT g.plant_id FROM hp_pump_accessory_groups g WHERE g.id = (r->>'group_id')::bigint),
            (SELECT c.plant_id FROM change_log c WHERE c.table_name = 'hp_pump_accessory_groups'
                AND c.row_id = (r->>'group_id')::bigint ORDER BY c.id DESC LIMIT 1))
    END;

    IF TG_OP = 'INSERT' THEN
        INSERT INTO change_log (table_name, row_id, plant_id, operation, new_row, changed_by, reason, request_id)
        VALUES (TG_TABLE_NAME, (n->>'id')::bigint, pid, 'INSERT', n, who, why, req);
        RETURN NEW;
    ELSIF TG_OP = 'DELETE' THEN
        INSERT INTO change_log (table_name, row_id, plant_id, operation, old_row, changed_by, reason, request_id)
        VALUES (TG_TABLE_NAME, (o->>'id')::bigint, pid, 'DELETE', o, who, why, req);
        RETURN OLD;
    END IF;
    FOR k IN SELECT key FROM jsonb_each(n)
             WHERE key <> 'updated_at' AND n->key IS DISTINCT FROM o->key LOOP
        INSERT INTO change_log (table_name, row_id, plant_id, operation, column_name, old_value, new_value,
                                changed_by, reason, request_id)
        VALUES (TG_TABLE_NAME, (o->>'id')::bigint, pid, 'UPDATE', k, o->k, n->k, who, why, req);
    END LOOP;
    RETURN NEW;
END $$;

CREATE TRIGGER change_log_append_only BEFORE UPDATE OR DELETE ON change_log
    FOR EACH ROW EXECUTE FUNCTION forbid_modification();

-- -----------------------------------------------------------------------------
-- Import provenance
-- -----------------------------------------------------------------------------

CREATE TABLE import_batches (
    id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    source_path     text        NOT NULL,     -- e.g. plantdata_export/structured
    schema_version  text        NOT NULL,     -- structured-JSON schema version
    record_count    integer     NOT NULL,
    notes           text,
    imported_at     timestamptz NOT NULL DEFAULT now()
);

-- -----------------------------------------------------------------------------
-- Zones
-- -----------------------------------------------------------------------------

CREATE TABLE zones (
    id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    name        text        NOT NULL UNIQUE,  -- lookup value; one row per zone
    created_at  timestamptz NOT NULL DEFAULT now(),
    updated_at  timestamptz NOT NULL DEFAULT now()
);

-- -----------------------------------------------------------------------------
-- Plants
-- -----------------------------------------------------------------------------

CREATE TABLE plants (
    id                   bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    legacy_plant_id      integer UNIQUE,          -- NULL for plants created in the new app
    name                 text    NOT NULL,        -- as stored by legacy page (lower-case there)
    display_name         text,                    -- legacy dropdown label, verbatim
    serial_number        text,                    -- NOT unique: legacy has shared serials
    capacity             text,                    -- verbatim, e.g. '400', '40w'
    site_contact_number  text,
    zone_id              bigint REFERENCES zones (id) ON DELETE RESTRICT,
    source               jsonb,                   -- original plant/zone/modules/source blocks
    created_at           timestamptz NOT NULL DEFAULT now(),
    updated_at           timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX plants_serial_number_idx ON plants (serial_number);
CREATE INDEX plants_zone_id_idx       ON plants (zone_id);
CREATE INDEX plants_name_lower_idx    ON plants (lower(name));

-- Immutable full legacy record, one per plant per import batch.
CREATE TABLE legacy_plant_records (
    id               bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    import_batch_id  bigint  NOT NULL REFERENCES import_batches (id) ON DELETE RESTRICT,
    plant_id         bigint  NOT NULL REFERENCES plants (id) ON DELETE RESTRICT,
    legacy_plant_id  integer NOT NULL,
    record           jsonb   NOT NULL,            -- structured JSON record, exactly as imported
    raw_file         text,                        -- path of the scraped HTML
    raw_sha256       text,                        -- hash of that HTML at import time
    metadata_file    text,
    endpoint         text,
    http_status      integer,
    imported_at      timestamptz NOT NULL DEFAULT now(),
    UNIQUE (import_batch_id, legacy_plant_id)
);
CREATE INDEX legacy_plant_records_plant_id_idx ON legacy_plant_records (plant_id);

-- Which sections the legacy page rendered, and its own row counter.
-- rendered_in_legacy = false  <=>  JSON value null (section absent)
-- rendered_in_legacy = true with no child rows  <=>  JSON value []
CREATE TABLE plant_sections (
    id                  bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    plant_id            bigint  NOT NULL REFERENCES plants (id) ON DELETE CASCADE,
    section             text    NOT NULL CHECK (section IN (
                            'design_parameters', 'pumps_and_motors', 'instruments', 'hmi_plc',
                            'vfds', 'dosing_pumps', 'hp_pump_accessories', 'filters')),
    rendered_in_legacy  boolean NOT NULL,
    legacy_count        integer,                  -- setText() counter; NULL if none emitted
    created_at          timestamptz NOT NULL DEFAULT now(),
    updated_at          timestamptz NOT NULL DEFAULT now(),
    UNIQUE (plant_id, section)
);

-- -----------------------------------------------------------------------------
-- Modules: one row per stage (1..5) plus one 'total' row.
-- quantity / module_type are parsed from value_text only when it has the
-- form  <int>  |  <int>(<type>)  |  <int> (<type>)  |  <int> <type>
-- -----------------------------------------------------------------------------

CREATE TABLE plant_modules (
    id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    plant_id      bigint  NOT NULL REFERENCES plants (id) ON DELETE CASCADE,
    position      integer NOT NULL,
    stage         smallint CHECK (stage BETWEEN 1 AND 5),   -- NULL on the total row
    is_total      boolean NOT NULL DEFAULT false,
    value_text    text,                          -- working value, e.g. '3(HPRO)'
    quantity      integer,                       -- parsed, e.g. 3
    module_type   text,                          -- parsed, verbatim, e.g. 'HPRO', 'NA'
    source_value  text,                          -- immutable legacy text
    source        jsonb,                         -- {"field": "stage_1", "value": "3(HPRO)"}
    created_at    timestamptz NOT NULL DEFAULT now(),
    updated_at    timestamptz NOT NULL DEFAULT now(),
    CHECK ((is_total AND stage IS NULL) OR (NOT is_total AND stage IS NOT NULL)),
    UNIQUE (plant_id, position) DEFERRABLE INITIALLY IMMEDIATE,
    UNIQUE (plant_id, stage)
);
CREATE UNIQUE INDEX plant_modules_one_total_per_plant ON plant_modules (plant_id) WHERE is_total;

-- -----------------------------------------------------------------------------
-- Design parameters: ordered name/unit/value rows; duplicate names allowed.
-- -----------------------------------------------------------------------------

CREATE TABLE plant_design_parameters (
    id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    plant_id        bigint  NOT NULL REFERENCES plants (id) ON DELETE CASCADE,
    position        integer NOT NULL,
    parameter_name  text,
    value           text,                        -- working value, e.g. '20', '<10', 'NA'
    unit            text,                        -- working unit, parentheses removed
    value_numeric   numeric GENERATED ALWAYS AS (strict_numeric(value)) STORED,
    source_value    text,                        -- immutable legacy value
    source          jsonb,                       -- {"position","name","unit","unit_raw","value"}
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now(),
    UNIQUE (plant_id, position) DEFERRABLE INITIALLY IMMEDIATE
);
CREATE INDEX plant_design_parameters_name_idx ON plant_design_parameters (parameter_name);

-- -----------------------------------------------------------------------------
-- Equipment tables (row order preserved in `position`)
-- -----------------------------------------------------------------------------

CREATE TABLE pumps_and_motors (
    id                 bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    plant_id           bigint  NOT NULL REFERENCES plants (id) ON DELETE CASCADE,
    position           integer NOT NULL,
    equipment_code     text,                     -- legacy "Pump Code", verbatim (PK121, PK122(S), FE183 ...)
    pump_make          text,
    pump_model         text,
    motor_make         text,
    motor_kw           text,
    motor_amp          text,
    motor_kw_numeric   numeric GENERATED ALWAYS AS (strict_numeric(motor_kw)) STORED,
    motor_amp_numeric  numeric GENERATED ALWAYS AS (strict_numeric(motor_amp)) STORED,
    source             jsonb,
    created_at         timestamptz NOT NULL DEFAULT now(),
    updated_at         timestamptz NOT NULL DEFAULT now(),
    UNIQUE (plant_id, position) DEFERRABLE INITIALLY IMMEDIATE
);
CREATE INDEX pumps_and_motors_code_idx       ON pumps_and_motors (equipment_code);
CREATE INDEX pumps_and_motors_pump_make_idx  ON pumps_and_motors (lower(pump_make));
CREATE INDEX pumps_and_motors_motor_make_idx ON pumps_and_motors (lower(motor_make));

CREATE TABLE instruments (
    id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    plant_id    bigint  NOT NULL REFERENCES plants (id) ON DELETE CASCADE,
    position    integer NOT NULL,
    name        text,                            -- e.g. 'Feed Flow Trans.', 'PS131'
    make        text,
    model       text,
    source      jsonb,
    created_at  timestamptz NOT NULL DEFAULT now(),
    updated_at  timestamptz NOT NULL DEFAULT now(),
    UNIQUE (plant_id, position) DEFERRABLE INITIALLY IMMEDIATE
);
CREATE INDEX instruments_make_idx ON instruments (lower(make));

CREATE TABLE hmi_plc (
    id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    plant_id    bigint  NOT NULL REFERENCES plants (id) ON DELETE CASCADE,
    position    integer NOT NULL,
    name        text,                            -- e.g. 'HMI & PLC', 'Module 1'
    make        text,
    model       text,
    source      jsonb,
    created_at  timestamptz NOT NULL DEFAULT now(),
    updated_at  timestamptz NOT NULL DEFAULT now(),
    UNIQUE (plant_id, position) DEFERRABLE INITIALLY IMMEDIATE
);
CREATE INDEX hmi_plc_make_idx ON hmi_plc (lower(make));

CREATE TABLE vfds (
    id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    plant_id    bigint  NOT NULL REFERENCES plants (id) ON DELETE CASCADE,
    position    integer NOT NULL,
    name        text,
    make        text,
    model       text,
    source      jsonb,
    created_at  timestamptz NOT NULL DEFAULT now(),
    updated_at  timestamptz NOT NULL DEFAULT now(),
    UNIQUE (plant_id, position) DEFERRABLE INITIALLY IMMEDIATE
);
CREATE INDEX vfds_make_idx ON vfds (lower(make));

CREATE TABLE dosing_pumps (
    id               bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    plant_id         bigint  NOT NULL REFERENCES plants (id) ON DELETE CASCADE,
    position         integer NOT NULL,
    dosing_pump_for  text,                       -- e.g. 'ANTISCALANT', 'HCL'
    make             text,
    model            text,
    source           jsonb,
    created_at       timestamptz NOT NULL DEFAULT now(),
    updated_at       timestamptz NOT NULL DEFAULT now(),
    UNIQUE (plant_id, position) DEFERRABLE INITIALLY IMMEDIATE
);
CREATE INDEX dosing_pumps_make_idx ON dosing_pumps (lower(make));

-- Filters: legacy shows a name plus unlabelled values. Values are kept in
-- order; `label` stays NULL until a person assigns a meaning.
CREATE TABLE filters (
    id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    plant_id    bigint  NOT NULL REFERENCES plants (id) ON DELETE CASCADE,
    position    integer NOT NULL,
    name        text,                            -- e.g. 'Sand Filter', 'Cartridge Filter'
    source      jsonb,                           -- {"position","name","values":[...]}
    created_at  timestamptz NOT NULL DEFAULT now(),
    updated_at  timestamptz NOT NULL DEFAULT now(),
    UNIQUE (plant_id, position) DEFERRABLE INITIALLY IMMEDIATE
);

CREATE TABLE filter_values (
    id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    filter_id     bigint  NOT NULL REFERENCES filters (id) ON DELETE CASCADE,
    position      integer NOT NULL,
    label         text,                          -- NULL = unknown; legacy had no label
    value         text,
    source_value  text,                          -- immutable legacy text
    source        jsonb,                         -- {"value": ...}; NULL = created in the new app
    created_at    timestamptz NOT NULL DEFAULT now(),
    updated_at    timestamptz NOT NULL DEFAULT now(),
    UNIQUE (filter_id, position) DEFERRABLE INITIALLY IMMEDIATE
);

-- HP pump accessories: grid columns (groups) of label/value entries.
-- Entries without a legacy label have label NULL.
CREATE TABLE hp_pump_accessory_groups (
    id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    plant_id    bigint  NOT NULL REFERENCES plants (id) ON DELETE CASCADE,
    position    integer NOT NULL,
    group_name  text,                            -- verbatim: 'Motor', 'MOTOR PULLEY', 'PD130' ...
    source      jsonb,                           -- {"position","group","entries":[...]}
    created_at  timestamptz NOT NULL DEFAULT now(),
    updated_at  timestamptz NOT NULL DEFAULT now(),
    UNIQUE (plant_id, position) DEFERRABLE INITIALLY IMMEDIATE
);

CREATE TABLE hp_pump_accessory_entries (
    id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    group_id    bigint  NOT NULL REFERENCES hp_pump_accessory_groups (id) ON DELETE CASCADE,
    position    integer NOT NULL,
    label       text,                            -- verbatim: 'Pully', 'Tapper', 'V-Belt'; NULL if none
    value       text,
    source      jsonb,                           -- {"label", "value"}
    created_at  timestamptz NOT NULL DEFAULT now(),
    updated_at  timestamptz NOT NULL DEFAULT now(),
    UNIQUE (group_id, position) DEFERRABLE INITIALLY IMMEDIATE
);

-- -----------------------------------------------------------------------------
-- Triggers
-- -----------------------------------------------------------------------------

DO $$
DECLARE
    t text;
BEGIN
    FOREACH t IN ARRAY ARRAY[
        'zones', 'plants', 'plant_sections', 'plant_modules', 'plant_design_parameters',
        'pumps_and_motors', 'instruments', 'hmi_plc', 'vfds', 'dosing_pumps',
        'filters', 'filter_values', 'hp_pump_accessory_groups', 'hp_pump_accessory_entries'
    ] LOOP
        EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE ON %I
                        FOR EACH ROW EXECUTE FUNCTION set_updated_at()', t || '_set_updated_at', t);
        -- Upper-case name: AFTER ROW triggers fire in name order, and this must
        -- run before the "RI_ConstraintTrigger_*" cascade triggers (see log_change).
        EXECUTE format('CREATE TRIGGER %I AFTER INSERT OR UPDATE OR DELETE ON %I
                        FOR EACH ROW EXECUTE FUNCTION log_change()', 'AUDIT_' || t, t);
    END LOOP;
END $$;

-- Legacy source columns are write-once.
CREATE TRIGGER plants_protect_source BEFORE UPDATE ON plants
    FOR EACH ROW EXECUTE FUNCTION protect_source_columns('source', 'legacy_plant_id');
CREATE TRIGGER plant_sections_protect_source BEFORE UPDATE ON plant_sections
    FOR EACH ROW EXECUTE FUNCTION protect_source_columns('rendered_in_legacy', 'legacy_count');
CREATE TRIGGER plant_modules_protect_source BEFORE UPDATE ON plant_modules
    FOR EACH ROW EXECUTE FUNCTION protect_source_columns('source', 'source_value');
CREATE TRIGGER plant_design_parameters_protect_source BEFORE UPDATE ON plant_design_parameters
    FOR EACH ROW EXECUTE FUNCTION protect_source_columns('source', 'source_value');
CREATE TRIGGER filter_values_protect_source BEFORE UPDATE ON filter_values
    FOR EACH ROW EXECUTE FUNCTION protect_source_columns('source', 'source_value');
DO $$
DECLARE
    t text;
BEGIN
    FOREACH t IN ARRAY ARRAY[
        'pumps_and_motors', 'instruments', 'hmi_plc', 'vfds', 'dosing_pumps',
        'filters', 'hp_pump_accessory_groups', 'hp_pump_accessory_entries'
    ] LOOP
        EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE ON %I
                        FOR EACH ROW EXECUTE FUNCTION protect_source_columns(''source'')',
                       t || '_protect_source', t);
    END LOOP;
END $$;

CREATE TRIGGER legacy_plant_records_immutable BEFORE UPDATE OR DELETE ON legacy_plant_records
    FOR EACH ROW EXECUTE FUNCTION forbid_modification();
CREATE TRIGGER import_batches_immutable BEFORE UPDATE OR DELETE ON import_batches
    FOR EACH ROW EXECUTE FUNCTION forbid_modification();

-- Row triggers do not fire on TRUNCATE; block it separately.
CREATE TRIGGER legacy_plant_records_no_truncate BEFORE TRUNCATE ON legacy_plant_records
    FOR EACH STATEMENT EXECUTE FUNCTION forbid_modification();
CREATE TRIGGER import_batches_no_truncate BEFORE TRUNCATE ON import_batches
    FOR EACH STATEMENT EXECUTE FUNCTION forbid_modification();
CREATE TRIGGER change_log_no_truncate BEFORE TRUNCATE ON change_log
    FOR EACH STATEMENT EXECUTE FUNCTION forbid_modification();

COMMIT;
