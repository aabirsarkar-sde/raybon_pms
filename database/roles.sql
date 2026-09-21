-- =============================================================================
-- Least-privilege database role for the API.  Run as the schema owner after
-- schema.sql (and after seeding).  Set a password separately:
--     ALTER ROLE pdm_api PASSWORD '...';
--
-- The API role can read everything, but can write only the editable working
-- tables. It has no write access to the legacy provenance tables
-- (legacy_plant_records, import_batches, plant_sections), no write access to
-- change_log (rows are written by the SECURITY DEFINER trigger log_change),
-- and no TRUNCATE anywhere.
-- =============================================================================

DO $$
BEGIN
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'pdm_api') THEN
        CREATE ROLE pdm_api LOGIN;
    END IF;
END $$;

REVOKE ALL ON ALL TABLES IN SCHEMA public FROM pdm_api;
GRANT USAGE ON SCHEMA public TO pdm_api;

GRANT SELECT ON ALL TABLES IN SCHEMA public TO pdm_api;

GRANT INSERT, UPDATE, DELETE ON
    zones, plants, plant_modules, plant_design_parameters,
    pumps_and_motors, instruments, hmi_plc, vfds, dosing_pumps,
    filters, filter_values, hp_pump_accessory_groups, hp_pump_accessory_entries
TO pdm_api;

GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO pdm_api;
