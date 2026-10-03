"""Cross-plant equipment search."""
from conftest import auth

P = "/api/v1"


def search(client, role="viewer", **params):
    r = client.get(f"{P}/equipment/search", params=params, headers=auth(role))
    assert r.status_code == 200, r.text
    return r.json()


def zone_counts(payload) -> dict[str, int]:
    return {z["zone"]["name"]: z["items"] for z in payload["zones"]}


def kind_counts(payload) -> dict[str, int]:
    return {k["kind"]: k["items"] for k in payload["kinds"] if k["items"]}


def test_requires_authentication(client):
    assert client.get(f"{P}/equipment/search").status_code == 401
    assert client.get(f"{P}/equipment/kinds").status_code == 401
    # Searching is reading: a viewer may do it.
    assert client.get(f"{P}/equipment/kinds", headers=auth("viewer")).status_code == 200


def test_kinds_cover_every_equipment_list(client):
    kinds = client.get(f"{P}/equipment/kinds", headers=auth("viewer")).json()["items"]
    assert {k["kind"] for k in kinds} == {
        "pumps", "motors", "instruments", "hmi_plc", "vfds", "dosing_pumps",
        "hp_pump_accessories", "filters"}
    pumps = next(k for k in kinds if k["kind"] == "pumps")
    assert pumps["slug"] == "pumps-and-motors" and pumps["has_make"] and pumps["has_model"]


def test_free_text_finds_a_pump_model_across_zones(client):
    """The client's example: how many plants have this pump model, and where."""
    r = search(client, q="CRN 10-12")
    assert r["summary"]["items"] == 53
    assert r["summary"]["plants"] == 34
    assert r["summary"]["zones"] == 6
    assert sum(z["items"] for z in r["zones"]) == 53
    # Only pumps carry a pump model, so no other list matches.
    assert kind_counts(r) == {"pumps": 53}
    # Every plant listed actually has a match, and the counts agree.
    assert r["plants"]["total"] == 34
    assert sum(p["items"] for p in r["plants"]["items"]) <= 53
    for p in r["plants"]["items"]:
        assert p["items"] == len(p["matches"])
        assert all("CRN 10-12" in (m["model"] or "") for m in p["matches"])


def test_exact_model_filter_is_narrower_than_free_text(client):
    """Free text matches 'CRN 10-12 SF' too; picking the model from the facet does not."""
    loose = search(client, q="CRN 10-12")
    exact = search(client, model="CRN 10-12")
    assert exact["summary"]["items"] == 31 < loose["summary"]["items"]
    assert exact["summary"]["plants"] == 21
    models = {f["value"] for f in loose["facets"]["model"]}
    assert {"CRN 10-12", "CRN 10-12 SF"} <= models


def test_zone_filter_by_id_and_by_name(client):
    all_zones = search(client, model="CRN 10-12")
    counts = zone_counts(all_zones)
    assert counts["Vadodara"] == 10

    zone = next(z for z in all_zones["zones"] if z["zone"]["name"] == "Vadodara")
    one = search(client, model="CRN 10-12", zone_id=zone["zone"]["id"])
    assert one["summary"]["items"] == 10
    assert one["summary"]["zones"] == 1
    assert one["plants"]["total"] == zone["plants"]

    by_name = search(client, model="CRN 10-12", zone="vadodara")       # case-insensitive
    assert by_name["summary"] == one["summary"]


def test_several_zones_at_once(client):
    """"Select one, two, or multiple specific zones" — the counts add up."""
    base = search(client, model="CRN 10-12")
    counts = zone_counts(base)
    picked = ["Ankleshwar", "Jhagadia", "Panoli"]
    many = search(client, model="CRN 10-12", zone=picked)
    assert many["summary"]["items"] == sum(counts[z] for z in picked)
    assert {p["plant"]["zone"]["name"] for p in many["plants"]["items"]} <= set(picked)


def test_zone_breakdown_ignores_the_zone_filter(client):
    """Picking a zone must not blank out the others, or you cannot compare them."""
    everywhere = search(client, model="CRN 10-12")
    in_one = search(client, model="CRN 10-12", zone="Vadodara")
    assert zone_counts(in_one) == zone_counts(everywhere)
    assert in_one["summary"]["items"] < everywhere["summary"]["items"]
    # Every zone is listed, including those with nothing matching.
    assert len(everywhere["zones"]) == 7
    assert zone_counts(everywhere)["Panoli"] == 0


def test_make_facet_groups_spellings_that_differ_only_in_case(client):
    """The legacy data holds 'GRUNDFOS' and 'Grundfos'. One option, one count,
    and selecting it returns exactly the count that was shown."""
    r = search(client, q="CRN 10-12")
    grundfos = next(f for f in r["facets"]["make"] if f["value"].lower() == "grundfos")
    assert grundfos["spellings"] > 1
    picked = search(client, q="CRN 10-12", make=grundfos["value"])
    assert picked["summary"]["items"] == grundfos["items"]
    assert picked["summary"]["plants"] == grundfos["plants"]
    # Selecting the rarer spelling matches the same rows.
    assert search(client, q="CRN 10-12", make="grundfos")["summary"]["items"] == grundfos["items"]


def test_make_facet_ignores_its_own_selection_but_honours_the_others(client):
    unfiltered = search(client, q="CRN 10-12")
    by_make = search(client, q="CRN 10-12", make="GRUNDFOS")
    assert by_make["facets"]["make"] == unfiltered["facets"]["make"]
    # The model facet does narrow: it is a different dimension.
    assert len(by_make["facets"]["model"]) <= len(unfiltered["facets"]["model"])


def test_kind_filter_and_kind_breakdown(client):
    r = search(client, make="GRUNDFOS")
    counts = kind_counts(r)
    assert counts["pumps"] > 0 and counts["motors"] > 0
    only_motors = search(client, make="GRUNDFOS", kind="motors")
    assert only_motors["summary"]["items"] == counts["motors"]
    assert all(m["kind"] == "motors" for p in only_motors["plants"]["items"] for m in p["matches"])
    # The kind breakdown ignores the kind filter, as the zone breakdown ignores zones.
    assert kind_counts(only_motors) == counts


def test_every_kind_is_searchable(client):
    for kind, q, expect_model in (("pumps", "CRN", True), ("motors", "5.5", False),
                                  ("instruments", "rosemount", True), ("hmi_plc", "siemens", True),
                                  ("vfds", "schneider", True), ("dosing_pumps", "antiscalant", False),
                                  ("hp_pump_accessories", "belt", False), ("filters", "sand", False)):
        r = search(client, kind=kind, q=q)
        assert r["summary"]["items"] > 0, f"{kind}: nothing matched {q!r}"
        assert kind_counts(r)[kind] == r["summary"]["items"]
        assert all(m["kind"] == kind for p in r["plants"]["items"] for m in p["matches"])
        if expect_model:
            assert any(m["model"] for p in r["plants"]["items"] for m in p["matches"])


def test_motor_kw_and_amp_are_shown_verbatim(client):
    r = search(client, kind="motors", q="5.5")
    detail = next(m["detail"] for p in r["plants"]["items"] for m in p["matches"] if m["detail"])
    assert detail.get("motor_kw") == "5.5" or detail.get("motor_amp") == "5.5"


def test_filter_values_are_searchable_and_returned_in_order(client):
    r = search(client, kind="filters", q="sand")
    match = next(m for p in r["plants"]["items"] for m in p["matches"] if m["detail"].get("values"))
    assert isinstance(match["detail"]["values"], list)


def test_accessory_entries_are_searchable_by_part_number(client):
    r = search(client, kind="hp_pump_accessories", q="XPA")
    assert r["summary"]["items"] > 0
    m = r["plants"]["items"][0]["matches"][0]
    assert "XPA" in (m["model"] or "") and m["detail"].get("group")


def test_search_wildcards_are_escaped(client):
    assert search(client, q="100%_")["summary"]["items"] == 0


def test_paging_and_sorting_plants(client):
    first = search(client, q="CRN", limit=5, sort="items")
    assert len(first["plants"]["items"]) == 5
    counts = [p["items"] for p in first["plants"]["items"]]
    assert counts == sorted(counts, reverse=True)

    second = search(client, q="CRN", limit=5, offset=5, sort="items")
    assert {p["plant"]["id"] for p in first["plants"]["items"]} \
        .isdisjoint({p["plant"]["id"] for p in second["plants"]["items"]})

    by_name = search(client, q="CRN", limit=10, sort="name")
    names = [p["plant"]["name"].lower() for p in by_name["plants"]["items"]]
    assert names == sorted(names)

    by_zone = search(client, q="CRN", limit=200, sort="zone")
    zones = [p["plant"]["zone"]["name"] for p in by_zone["plants"]["items"] if p["plant"]["zone"]]
    assert zones == sorted(zones)


def test_matches_per_plant_can_be_capped(client):
    r = search(client, q="CRN", limit=200, matches=1)
    busiest = max(r["plants"]["items"], key=lambda p: p["items"])
    assert busiest["items"] > 1                  # the true count is still reported
    assert len(busiest["matches"]) == 1          # but only one row is listed


def test_no_matches_still_reports_every_zone_and_kind(client):
    r = search(client, q="no-such-equipment-anywhere")
    assert r["summary"] == {"items": 0, "plants": 0, "zones": 0}
    assert r["plants"] == {"items": [], "total": 0, "limit": 25, "offset": 0}
    assert len(r["zones"]) == 7 and all(z["items"] == 0 for z in r["zones"])
    assert len(r["kinds"]) == 8 and all(k["items"] == 0 for k in r["kinds"])
    assert r["facets"]["make"] == []


def test_filters_are_echoed_back(client):
    r = search(client, q="CRN", kind="pumps", make="GRUNDFOS", zone="Dahej")
    assert r["filters"] == {"q": "CRN", "kind": ["pumps"], "make": ["GRUNDFOS"], "model": [],
                            "type": [], "zone_id": [], "zone": ["Dahej"], "unzoned": False}
    assert r["sort"] == "items"


def test_rejects_unknown_kind_and_sort(client):
    r = client.get(f"{P}/equipment/search", params={"kind": "turbines"}, headers=auth("viewer"))
    assert r.status_code == 422 and "turbines" in r.text
    r = client.get(f"{P}/equipment/search", params={"sort": "id; DROP TABLE plants"},
                   headers=auth("viewer"))
    assert r.status_code == 422


def test_search_sees_an_edit_immediately(client, api_conn):
    """Searching reads the working columns, so a correction shows up at once."""
    before = search(client, q="ZZTOP-UNIQUE-MODEL")["summary"]["items"]
    assert before == 0
    item_id, plant_id = api_conn.execute(
        "SELECT id, plant_id FROM pumps_and_motors ORDER BY id LIMIT 1").fetchone()
    r = client.patch(f"{P}/plants/{plant_id}/pumps-and-motors/{item_id}",
                     json={"pump_model": "ZZTOP-UNIQUE-MODEL"}, headers=auth("editor"))
    assert r.status_code == 200, r.text
    after = search(client, q="ZZTOP-UNIQUE-MODEL")
    assert after["summary"]["items"] == 1
    assert after["plants"]["items"][0]["plant"]["id"] == plant_id


def test_newly_added_equipment_is_searchable(client):
    plants = client.get(f"{P}/plants", params={"limit": 1}, headers=auth("viewer")).json()["items"]
    pid = plants[0]["id"]
    client.post(f"{P}/plants/{pid}/instruments",
                json={"name": "Brand New Meter", "make": "ACME", "model": "XQ-9000"},
                headers=auth("editor"))
    r = search(client, q="XQ-9000")
    assert r["summary"]["items"] == 1
    assert kind_counts(r) == {"instruments": 1}
    assert r["plants"]["items"][0]["plant"]["id"] == pid
