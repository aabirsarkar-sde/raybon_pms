import json

import psycopg
import pytest

from conftest import ROOT, auth, structured

P = "/api/v1"


def plant_by_legacy(client, legacy_id):
    r = client.get(f"{P}/plants/by-legacy-id/{legacy_id}", headers=auth("viewer"))
    assert r.status_code == 200, r.text
    return r.json()


# ============================================================ authentication / authorization
def test_auth_required_and_roles(client):
    assert client.get(f"{P}/plants").status_code == 401
    assert client.get(f"{P}/plants", headers={"Authorization": "Bearer nope"}).status_code == 401
    assert client.get(f"{P}/plants", headers=auth("viewer")).status_code == 200
    assert client.get(f"{P}/me", headers=auth("editor")).json() == {"name": "editor-user", "role": "editor"}
    pid = plant_by_legacy(client, 1)["id"]
    assert client.patch(f"{P}/plants/{pid}", json={"capacity": "x"}, headers=auth("viewer")).status_code == 403
    assert client.post(f"{P}/plants", json={"name": "x"}, headers=auth("editor")).status_code == 403
    assert client.post(f"{P}/zones", json={"name": "x"}, headers=auth("editor")).status_code == 403
    assert client.get("/health").json() == {"status": "ok"}


def test_request_id_echoed(client):
    r = client.get(f"{P}/zones", headers={**auth("viewer"), "X-Request-ID": "abc-123"})
    assert r.headers["X-Request-ID"] == "abc-123"
    assert len(client.get(f"{P}/zones", headers=auth("viewer")).headers["X-Request-ID"]) == 32


# ============================================================ listing / search
def test_list_and_search(client):
    h = auth("viewer")
    r = client.get(f"{P}/plants", params={"limit": 500}, headers=h).json()
    assert r["total"] == 172 and len(r["items"]) == 172
    assert r["items"][0]["legacy_plant_id"] == 1
    assert r["items"][0]["counts"]["pumps_and_motors"] == 17

    r = client.get(f"{P}/plants", params={"serial_number": "3256"}, headers=h).json()
    assert sorted(i["legacy_plant_id"] for i in r["items"]) == [1024, 1108]      # not merged

    r = client.get(f"{P}/plants", params={"q": "tagros", "limit": 500}, headers=h).json()
    found = [i["legacy_plant_id"] for i in r["items"]]
    assert {1095, 1106} <= set(found) and len(found) == len(set(found))          # both kept, separately

    r = client.get(f"{P}/plants", params={"zone": "dahej", "limit": 500}, headers=h).json()
    assert r["total"] == 33 and all(i["zone"]["name"] == "Dahej" for i in r["items"])

    r = client.get(f"{P}/plants", params={"equipment": "PK122(S)"}, headers=h).json()
    assert 1 in [i["legacy_plant_id"] for i in r["items"]]

    r = client.get(f"{P}/plants", params={"q": "100%_"}, headers=h).json()        # wildcards escaped
    assert r["total"] == 0

    r = client.get(f"{P}/plants", params={"sort": "-legacy_plant_id", "limit": 2, "offset": 1}, headers=h).json()
    all_ids = sorted((i["legacy_plant_id"] for i in client.get(f"{P}/plants", params={"limit": 500}, headers=h).json()["items"]), reverse=True)
    assert [i["legacy_plant_id"] for i in r["items"]] == all_ids[1:3]
    assert client.get(f"{P}/plants", params={"sort": "bogus"}, headers=h).status_code == 422
    assert client.get(f"{P}/plants", params={"modified": True}, headers=h).json()["total"] == 0


# ============================================================ full plant document
def rebuild_structured(doc: dict) -> dict:
    """Reconstruct the structured-JSON shape from the API's *current* values."""
    s = doc["sections"]
    cur = doc["current"]

    def items(sec, fn):
        return fn(s[sec]["items"]) if s[sec]["legacy"]["rendered"] else None

    rename = {"equipment_code": "pump_code"}
    simple = lambda its: [{rename.get(k, k): v for k, v in i["current"].items()} for i in its]
    return {
        "plant": {k: cur[k] for k in ("name", "serial_number", "capacity", "site_contact_number")},
        "dropdown_label": cur["display_name"],
        "zone": cur["zone_name"],
        "modules": {("total" if m["stage"] == "total" else f"stage_{m['stage']}"): m["current"]["value_text"]
                    for m in doc["modules"]},
        "design_parameters": items("design_parameters", lambda its: [
            {"position": i["position"], "name": i["current"]["parameter_name"], "unit": i["current"]["unit"],
             "unit_raw": i["original"]["unit_raw"], "value": i["current"]["value"]} for i in its]),
        "pump_and_motor": items("pumps_and_motors", simple),
        "instruments": items("instruments", simple),
        "hmi_and_plc": items("hmi_plc", simple),
        "vfd": items("vfds", simple),
        "dosing_pumps": items("dosing_pumps", simple),
        "filters": items("filters", lambda its: [
            {"position": i["position"], "name": i["current"]["name"],
             "values": [v["current"]["value"] for v in i["values"]]} for i in its]),
        "hp_pump_accessories": items("hp_pump_accessories", lambda its: [
            {"position": i["position"], "group": i["current"]["group_name"],
             "entries": [e["current"] for e in i["entries"]]} for i in its]),
        "legacy_counts": {k: s[sec]["legacy"]["count"] for k, sec in [
            ("pump_and_motor", "pumps_and_motors"), ("instruments", "instruments"), ("hmi_and_plc", "hmi_plc"),
            ("vfd", "vfds"), ("dosing_pumps", "dosing_pumps"), ("hp_pump_accessories", "hp_pump_accessories"),
            ("filters", "filters")]},
    }


def test_every_plant_complete_and_lossless(client):
    """All 172 plants: the API document carries every structured-JSON value, unmodified."""
    all_json = json.loads((ROOT / "plantdata_export/all_plants.json").read_text())
    for rec in all_json:
        doc = plant_by_legacy(client, rec["plant_id"])
        expected = {k: rec[k] for k in ("plant", "zone", "modules", "design_parameters", "pump_and_motor",
                                        "instruments", "hmi_and_plc", "vfd", "dosing_pumps", "filters",
                                        "hp_pump_accessories", "legacy_counts")}
        expected["dropdown_label"] = rec["source"]["dropdown_label"]
        assert rebuild_structured(doc) == expected, rec["plant_id"]
        assert doc["origin"] == "legacy" and doc["modified_fields"] == []


def test_plant_document_shape(client):
    doc = plant_by_legacy(client, 1)
    pumps = doc["sections"]["pumps_and_motors"]["items"]
    assert [p["current"]["equipment_code"] for p in pumps[:3]] == ["PK121", "PK122(S)", "PK131"]
    pk161 = next(p for p in pumps if p["current"]["equipment_code"] == "PK161")
    assert pk161["current"]["pump_make"] == "N/A"                       # placeholder kept verbatim
    assert pk161["current"]["motor_kw"] is None and pk161["derived"]["motor_kw_numeric"] is None
    assert pumps[0]["derived"] == {"motor_kw_numeric": 7.5, "motor_amp_numeric": 12.2}
    assert pumps[0]["original"] == pumps[0]["current"] and pumps[0]["origin"] == "legacy"
    f = doc["sections"]["filters"]["items"][0]
    assert f["current"]["name"] == "Sand Filter"
    assert [v["current"] for v in f["values"]] == [
        {"label": None, "value": "4272"}, {"label": None, "value": "2 Nos."},
        {"label": None, "value": "Both Inline"}, {"label": None, "value": "FRP"}]
    assert doc["modules"][0]["current"]["value_text"] == structured(1)["modules"]["stage_1"]
    dholka = plant_by_legacy(client, 10)["modules"][0]
    assert dholka["current"] == {"value_text": "3(HPRO)", "quantity": 3, "module_type": "HPRO"} == dholka["original"]

    dup = plant_by_legacy(client, 1071)["sections"]["design_parameters"]["items"]
    assert [d["current"]["parameter_name"] for d in dup[:4]] == ["Feed Flow", "Feed Flow", "Feed Conductivity", "Feed Flow"]

    minimal = plant_by_legacy(client, 1173)["sections"]
    assert minimal["instruments"] == {**minimal["instruments"], "legacy": {"rendered": False, "count": None}, "items": []}
    assert minimal["pumps_and_motors"]["legacy"] == {"rendered": True, "count": 0}


def test_legacy_snapshot_endpoint(client):
    doc = plant_by_legacy(client, 1)
    snap = client.get(f"{P}/plants/{doc['id']}/legacy", headers=auth("viewer")).json()
    assert snap["immutable"] is True
    assert snap["records"][0]["record"] == structured(1)
    assert len(snap["records"][0]["raw_sha256"]) == 64


# ============================================================ editing plants
def test_edit_plant_keeps_original_and_logs(client):
    doc = plant_by_legacy(client, 1)
    pid = doc["id"]
    r = client.patch(f"{P}/plants/{pid}", json={"capacity": "400 m3/day", "expected_updated_at": doc["updated_at"]},
                     headers={**auth("editor", "Confirmed with site"), "X-Request-ID": "req-1"})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["current"]["capacity"] == "400 m3/day"
    assert body["original"]["capacity"] == structured(1)["plant"]["capacity"]
    assert body["modified_fields"] == ["capacity"]

    hist = client.get(f"{P}/plants/{pid}/history", headers=auth("viewer")).json()["items"]
    assert hist[0]["operation"] == "UPDATE" and hist[0]["column_name"] == "capacity"
    assert (hist[0]["changed_by"], hist[0]["reason"], hist[0]["request_id"]) == ("editor-user", "Confirmed with site", "req-1")
    assert hist[0]["old_value"] == structured(1)["plant"]["capacity"]

    snap = client.get(f"{P}/plants/{pid}/legacy", headers=auth("viewer")).json()
    assert snap["records"][0]["record"] == structured(1)                 # provenance untouched

    stale = client.patch(f"{P}/plants/{pid}", json={"capacity": "1", "expected_updated_at": doc["updated_at"]},
                         headers=auth("editor"))
    assert stale.status_code == 409

    assert client.get(f"{P}/plants", params={"modified": True}, headers=auth("viewer")).json()["total"] == 1


@pytest.mark.parametrize("body", [
    {"name": None}, {"name": ""}, {"capacity": " padded"}, {"capacity": "line\nbreak"},
    {"source": {}}, {"legacy_plant_id": 5}, {"id": 1}, {}, {"zone_id": "3"}, {"zone_id": 999999},
    {"capacity": "x" * 1001},
])
def test_plant_validation(client, body):
    pid = plant_by_legacy(client, 1)["id"]
    assert client.patch(f"{P}/plants/{pid}", json=body, headers=auth("editor")).status_code == 422


def test_tab_inside_value_allowed(client):
    pid = plant_by_legacy(client, 1)["id"]
    assert client.patch(f"{P}/plants/{pid}", json={"display_name": "A\tB"}, headers=auth("editor")).status_code == 200


def test_create_and_delete_app_plant(client):
    zone_id = client.get(f"{P}/zones", headers=auth("viewer")).json()["items"][0]["id"]
    r = client.post(f"{P}/plants", json={"name": "New Plant", "serial_number": "2094", "zone_id": zone_id},
                    headers=auth("admin", "Commissioned"))
    assert r.status_code == 201, r.text
    doc = r.json()
    assert doc["origin"] == "app" and doc["original"] is None and doc["legacy_plant_id"] is None
    assert len(doc["modules"]) == 6 and all(s["legacy"] is None for s in doc["sections"].values())
    assert client.delete(f"{P}/plants/{doc['id']}", headers=auth("admin")).status_code == 204
    legacy = plant_by_legacy(client, 1)["id"]
    assert client.delete(f"{P}/plants/{legacy}", headers=auth("admin")).status_code == 409


# ============================================================ modules
def test_edit_module(client):
    pid = plant_by_legacy(client, 1)["id"]
    r = client.patch(f"{P}/plants/{pid}/modules/2", json={"value_text": "4 (PT)"}, headers=auth("editor"))
    assert r.status_code == 200, r.text
    m = r.json()
    assert m["current"] == {"value_text": "4 (PT)", "quantity": 4, "module_type": "PT"}
    assert m["original"]["value_text"] == structured(1)["modules"]["stage_2"]
    assert set(m["modified_fields"]) >= {"value_text"}
    r = client.patch(f"{P}/plants/{pid}/modules/total", json={"quantity": -1}, headers=auth("editor"))
    assert r.status_code == 422
    assert client.patch(f"{P}/plants/{pid}/modules/6", json={"quantity": 1}, headers=auth("editor")).status_code == 422


# ============================================================ equipment
def test_equipment_add_edit_reorder_delete(client, admin_conn):
    pid = plant_by_legacy(client, 1)["id"]
    base = f"{P}/plants/{pid}/pumps-and-motors"
    before = client.get(base, headers=auth("viewer")).json()
    assert before["legacy"] == {"rendered": True, "count": 17}
    ids = [i["id"] for i in before["items"]]

    r = client.post(base, json={"equipment_code": "PK999", "pump_make": "GRUNDFOS", "motor_kw": "7.5", "position": 2},
                    headers={**auth("editor", "Added spare"), "X-Request-ID": "req-add"})
    assert r.status_code == 201, r.text
    new = r.json()
    assert new["position"] == 2 and new["origin"] == "app" and new["original"] is None
    assert new["derived"]["motor_kw_numeric"] == 7.5
    items = client.get(base, headers=auth("viewer")).json()["items"]
    assert [i["position"] for i in items] == list(range(1, 19))
    assert [i["id"] for i in items] == [ids[0], new["id"], *ids[1:]]

    r = client.patch(f"{base}/{ids[0]}", json={"motor_kw": "N/A"}, headers=auth("editor"))
    assert r.json()["current"]["motor_kw"] == "N/A" and r.json()["original"]["motor_kw"] == "7.5"
    assert r.json()["modified_fields"] == ["motor_kw"]
    # immutable source column untouched
    src = admin_conn.execute("SELECT source->>'motor_kw' FROM pumps_and_motors WHERE id = %s", (ids[0],)).fetchone()[0]
    assert src == "7.5"

    new_order = list(reversed([i["id"] for i in items]))
    r = client.put(f"{base}/order", json={"ids": new_order}, headers=auth("editor"))
    assert [i["id"] for i in r.json()["items"]] == new_order
    assert client.put(f"{base}/order", json={"ids": new_order[1:]}, headers=auth("editor")).status_code == 422
    assert client.put(f"{base}/order", json={"ids": new_order + [new_order[0]]}, headers=auth("editor")).status_code == 422

    assert client.delete(f"{base}/{new['id']}", headers=auth("editor")).status_code == 204
    items = client.get(base, headers=auth("viewer")).json()["items"]
    assert [i["position"] for i in items] == list(range(1, 18))

    hist = client.get(f"{P}/plants/{pid}/history", params={"request_id": "req-add"}, headers=auth("viewer")).json()
    ops = {(h["table_name"], h["operation"]) for h in hist["items"]}
    assert ("pumps_and_motors", "INSERT") in ops and ("pumps_and_motors", "UPDATE") in ops  # insert + shifts
    assert all(h["reason"] == "Added spare" for h in hist["items"])

    assert client.post(base, json={}, headers=auth("editor")).status_code == 422
    assert client.post(base, json={"pump_make": "X", "position": 99}, headers=auth("editor")).status_code == 422
    assert client.post(base, json={"pump_make": "X", "source": {}}, headers=auth("editor")).status_code == 422
    other = plant_by_legacy(client, 10)["id"]
    assert client.patch(f"{P}/plants/{other}/pumps-and-motors/{ids[0]}", json={"pump_make": "X"},
                        headers=auth("editor")).status_code == 404


def test_design_parameters(client, admin_conn):
    pid = plant_by_legacy(client, 1)["id"]
    base = f"{P}/plants/{pid}/design-parameters"
    items = client.get(base, headers=auth("viewer")).json()["items"]
    first = items[0]
    assert first["original"] == {"parameter_name": "Feed Flow", "value": "20", "unit": "m³/Hr.", "unit_raw": "(m³/Hr.)"}
    r = client.patch(f"{base}/{first['id']}", json={"value": "<25", "unit": "m3/h"}, headers=auth("editor"))
    body = r.json()
    assert body["current"]["value"] == "<25" and body["derived"]["value_numeric"] is None
    assert body["original"]["value"] == "20" and body["original"]["unit_raw"] == "(m³/Hr.)"
    assert sorted(body["modified_fields"]) == ["unit", "value"]
    row = admin_conn.execute("SELECT source_value, source->>'unit_raw' FROM plant_design_parameters WHERE id = %s",
                             (first["id"],)).fetchone()
    assert row == ("20", "(m³/Hr.)")
    # duplicates are allowed
    r = client.post(base, json={"parameter_name": "Feed Flow", "value": "21", "unit": "m³/Hr."}, headers=auth("editor"))
    assert r.status_code == 201 and r.json()["position"] == len(items) + 1


def test_filters_nested_values_and_cascade_audit(client):
    pid = plant_by_legacy(client, 1)["id"]
    base = f"{P}/plants/{pid}/filters"
    r = client.post(base, json={"name": "Carbon Filter", "values": [{"value": "1 Nos."}, {"value": "NA"}]},
                    headers=auth("editor"))
    assert r.status_code == 201, r.text
    f = r.json()
    assert [v["current"] for v in f["values"]] == [{"label": None, "value": "1 Nos."}, {"label": None, "value": "NA"}]
    assert all(v["origin"] == "app" for v in f["values"])

    legacy_filter = client.get(base, headers=auth("viewer")).json()["items"][0]
    v0 = legacy_filter["values"][0]
    assert v0["origin"] == "legacy" and v0["original"] == {"label": None, "value": "4272"}
    r = client.patch(f"{base}/{legacy_filter['id']}/values/{v0['id']}", json={"label": "size"}, headers=auth("editor"))
    assert r.json()["current"] == {"label": "size", "value": "4272"} and r.json()["modified_fields"] == ["label"]

    vals = f"{base}/{f['id']}/values"
    ids = [v["id"] for v in client.get(vals, headers=auth("viewer")).json()["items"]]
    assert [v["id"] for v in client.put(f"{vals}/order", json={"ids": ids[::-1]}, headers=auth("editor")).json()["items"]] == ids[::-1]
    # a value id under the wrong filter is not found
    assert client.patch(f"{base}/{legacy_filter['id']}/values/{ids[0]}", json={"value": "x"},
                        headers=auth("editor")).status_code == 404

    # deleting the filter cascades to its values; audit keeps plant_id for all of them
    assert client.delete(f"{base}/{f['id']}", headers={**auth("editor"), "X-Request-ID": "req-del"}).status_code == 204
    hist = client.get(f"{P}/plants/{pid}/history", params={"request_id": "req-del"}, headers=auth("viewer")).json()
    deleted = {(h["table_name"], h["row_id"]) for h in hist["items"] if h["operation"] == "DELETE"}
    assert ("filters", f["id"]) in deleted and all(("filter_values", i) in deleted for i in ids)


def test_hp_accessory_entries(client):
    doc = plant_by_legacy(client, 1)
    pid = doc["id"]
    g = doc["sections"]["hp_pump_accessories"]["items"][2]
    assert g["current"]["group_name"] == "Pulsation Damper"
    assert [e["current"]["label"] for e in g["entries"]] == [None, None, "V-Belt"]
    base = f"{P}/plants/{pid}/hp-pump-accessories/{g['id']}/entries"
    r = client.post(base, json={"label": "Qty", "value": "2", "position": 1}, headers=auth("editor"))
    assert r.status_code == 201 and r.json()["position"] == 1
    other = plant_by_legacy(client, 10)["id"]
    assert client.get(f"{P}/plants/{other}/hp-pump-accessories/{g['id']}/entries",
                      headers=auth("viewer")).status_code == 404


# ============================================================ provenance protection (database level)
def test_api_role_cannot_touch_provenance(api_conn, admin_conn):
    def fails(conn, stmt, err):
        with pytest.raises(err):
            conn.execute(stmt)

    fails(api_conn, "UPDATE legacy_plant_records SET raw_file = 'x'", psycopg.errors.InsufficientPrivilege)
    fails(api_conn, "DELETE FROM legacy_plant_records", psycopg.errors.InsufficientPrivilege)
    fails(api_conn, "TRUNCATE legacy_plant_records", psycopg.errors.InsufficientPrivilege)
    fails(api_conn, "UPDATE plant_sections SET legacy_count = 0", psycopg.errors.InsufficientPrivilege)
    fails(api_conn, "INSERT INTO change_log (table_name, row_id, operation) VALUES ('x', 1, 'INSERT')",
          psycopg.errors.InsufficientPrivilege)
    fails(api_conn, "DELETE FROM change_log", psycopg.errors.InsufficientPrivilege)
    # working tables are writable, but their source columns are not
    fails(api_conn, "UPDATE pumps_and_motors SET source = '{}' WHERE id = (SELECT min(id) FROM pumps_and_motors)",
          psycopg.errors.IntegrityConstraintViolation)
    fails(api_conn, "UPDATE filter_values SET source_value = 'x' WHERE id = (SELECT min(id) FROM filter_values)",
          psycopg.errors.IntegrityConstraintViolation)
    fails(api_conn, "UPDATE plants SET legacy_plant_id = 99999 WHERE legacy_plant_id = 1",
          psycopg.errors.IntegrityConstraintViolation)
    # even the owner cannot rewrite the snapshot or the audit log
    fails(admin_conn, "UPDATE legacy_plant_records SET raw_file = 'x'", psycopg.errors.IntegrityConstraintViolation)
    fails(admin_conn, "TRUNCATE legacy_plant_records CASCADE", psycopg.errors.IntegrityConstraintViolation)
    fails(admin_conn, "TRUNCATE change_log", psycopg.errors.IntegrityConstraintViolation)
    fails(admin_conn, "UPDATE import_batches SET notes = 'x'", psycopg.errors.IntegrityConstraintViolation)


def test_seed_does_not_flood_change_log(admin_conn):
    assert admin_conn.execute("SELECT count(*) FROM change_log").fetchone()[0] == 0
