"""
Parse the scraped legacy PlantData HTML (plantdata_export/raw/*.html) into
clean structured JSON.  Read-only with respect to raw/, metadata/,
plant_list.json and failed_plants.json.

Outputs:
  plantdata_export/structured/plant_<id>.json
  plantdata_export/all_plants.json
  plantdata_export/schema.json
  plantdata_export/validation_report.json

Conventions:
  * Text is preserved exactly as it appears in the HTML (entities decoded,
    leading/trailing whitespace stripped).  No case changes, no unit
    conversion, no numeric coercion.  "N/A", "NA", "na", "-" etc. are kept
    verbatim.
  * An element that exists but is empty -> null.
  * A section that is not rendered for a plant -> null.
    A section that is rendered with zero rows -> [].
"""
import json
import re
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path

from bs4 import BeautifulSoup, Comment, Tag

SCHEMA_VERSION = "1.0.0"
ROOT = Path("plantdata_export")
RAW_DIR = ROOT / "raw"
META_DIR = ROOT / "metadata"
OUT_DIR = ROOT / "structured"

# Heading text (whitespace-normalised) -> section key
SECTION_HEADINGS = {
    "Plant": "plant",
    "Modules": "modules",
    "Design Parameters": "design_parameters",
    "Pump And Motor": "pump_and_motor",
    "Instruments": "instruments",
    "HMI and PLC": "hmi_and_plc",
    "VFD": "vfd",
    "Dosing Pump": "dosing_pumps",
    "HP Pump Accessories": "hp_pump_accessories",
    "Filters": "filters",
}
OPTIONAL_SECTIONS = [
    "design_parameters", "pump_and_motor", "instruments", "hmi_and_plc",
    "vfd", "dosing_pumps", "hp_pump_accessories", "filters",
]

# Table sections: expected header cells and the output field names per body column
TABLE_SECTIONS = {
    "pump_and_motor": (
        ["Pump Code", "Pump", "Motor", "Make", "Model", "Make", "Kw", "Amp."],
        ["pump_code", "pump_make", "pump_model", "motor_make", "motor_kw", "motor_amp"],
    ),
    "instruments": (["Name", "Make", "Model"], ["name", "make", "model"]),
    "hmi_and_plc": (["Name", "Make", "Model"], ["name", "make", "model"]),
    "vfd": (["Name", "Make", "Model"], ["name", "make", "model"]),
    "dosing_pumps": (["Dosing Pump for", "Make", "Model"], ["dosing_pump_for", "make", "model"]),
}

# setText("<id>", n) counters rendered by the legacy page -> section key
COUNTER_IDS = {
    "pumpCount": "pump_and_motor",
    "instrumentCount": "instruments",
    "hmiAndPlcCount": "hmi_and_plc",
    "vfdCount": "vfd",
    "dosingPumpCount": "dosing_pumps",
    "hpPumpAccessoriesCount": "hp_pump_accessories",
    "filtersCount": "filters",
}

PLANT_FIELDS = {
    "PlantDetails_PlantName": "name",
    "PlantDetails_PlantSerialNumber": "serial_number",
    "PlantDetails_PlantCapacity": "capacity",
    "PlantDetails_SiteContactNumber": "site_contact_number",
}
MODULE_FIELDS = {
    "PlantDetails_FirstStageModules": "stage_1",
    "PlantDetails_SecondStageModules": "stage_2",
    "PlantDetails_ThirdStageModules": "stage_3",
    "PlantDetails_FourthStageModules": "stage_4",
    "PlantDetails_FifthStageModules": "stage_5",
    "PlantDetails_Total": "total",
}

# Static template text that appears on every page and is not data
TEMPLATE_TEXT = {
    "Zone:", "Pump:", "Instruments:", "HMI And PLC:", "VFD:", "Dosing Pump:",
    "Filters:", "HP Pump Accessories:",
}
# Template strings that occur a fixed number of times per page beyond any data use:
# seven "0" counter placeholders (overwritten by JS) and a "Total" caption over them.
TEMPLATE_REPEATS = {"0": 7, "Total": 1}


def norm_ws(s):
    return " ".join(s.split())


def text_or_none(el):
    """Exact element text (entities decoded), stripped; empty -> None."""
    if el is None:
        return None
    t = el.get_text("", strip=False).strip()
    return t if t != "" else None


def direct_divs(el):
    return [c for c in el.children if isinstance(c, Tag) and c.name == "div"]


class PlantParser:
    def __init__(self, plant_id, html):
        self.plant_id = plant_id
        self.html = html
        self.soup = BeautifulSoup(html, "html.parser")
        self.anomalies = []          # parsing problems / irregularities
        self.consumed = []           # template strings consumed (for text conservation check)

    def anomaly(self, code, detail, **extra):
        self.anomalies.append({"code": code, "detail": detail, **extra})

    # ------------------------------------------------------------------ top card
    def parse_labelled(self, mapping, value_lookup):
        out = {}
        for for_id, key in mapping.items():
            label = self.soup.find("label", attrs={"for": for_id})
            if label is None:
                self.anomaly("missing_label", f"label[for={for_id}] not found", field=key)
                out[key] = None
                continue
            self.consumed.append(label.get_text(strip=True))
            span = value_lookup(label)
            if span is None:
                self.anomaly("missing_value_element", f"no value element for {for_id}", field=key)
            out[key] = text_or_none(span)
        return out

    def parse_plant(self):
        def lookup(label):
            li = label.find_parent("li")
            if li is None:
                return None
            spans = li.find_all("span")
            return spans[-1] if spans else None
        return self.parse_labelled(PLANT_FIELDS, lookup)

    def parse_modules(self):
        return self.parse_labelled(MODULE_FIELDS, lambda lab: lab.find_next_sibling("span"))

    def parse_zone(self):
        for h in self.soup.find_all("h6"):
            if norm_ws(h.get_text(" ")).startswith("Zone:"):
                strong = h.find("strong")
                if strong is None:
                    self.anomaly("zone_format", "Zone heading without <strong>")
                    return norm_ws(h.get_text(" "))[len("Zone:"):].strip() or None
                return text_or_none(strong)
        self.anomaly("missing_zone", "Zone heading not found")
        return None

    # ------------------------------------------------------------ design params
    def parse_design_parameters(self, h6):
        container = h6.find_next_sibling("div")
        row = container.find("div", class_="row") if container else None
        if row is None:
            self.anomaly("structure", "Design Parameters: no grid row found", section="design_parameters")
            return []
        params = []
        for i, col in enumerate(direct_divs(row)):
            cells = direct_divs(col)
            if len(cells) != 3 or cells[0].find("label") is None:
                self.anomaly("structure", f"Design parameter #{i} has {len(cells)} cells",
                             section="design_parameters",
                             raw=[text_or_none(c) for c in cells])
            name = text_or_none(cells[0]) if cells else None
            unit_raw = text_or_none(cells[1]) if len(cells) > 1 else None
            value = text_or_none(cells[2]) if len(cells) > 2 else None
            unit = None
            if unit_raw is not None:
                m = re.fullmatch(r"\((.*)\)", unit_raw, re.S)
                unit = m.group(1).strip() if m else unit_raw
                if not m:
                    self.anomaly("unit_format", f"unit not wrapped in parentheses: {unit_raw!r}",
                                 section="design_parameters", parameter=name)
                if unit == "":
                    unit = None
            params.append({"position": i + 1, "name": name, "unit": unit,
                           "unit_raw": unit_raw, "value": value})
        return params

    # ------------------------------------------------------------ table sections
    def parse_table(self, h6, key):
        expected_hdr, fields = TABLE_SECTIONS[key]
        table = h6.find_next("table")
        nxt = h6.find_next("h6")
        if table is None or (nxt is not None and nxt.sourceline and table.sourceline
                             and table.sourceline > nxt.sourceline):
            self.anomaly("structure", f"{key}: heading without a table", section=key)
            return []
        hdr = [th.get_text(" ", strip=True) for th in table.find_all("th")]
        self.consumed.extend(hdr)
        if hdr != expected_hdr:
            self.anomaly("unexpected_header", f"{key}: header {hdr} != {expected_hdr}", section=key)
        rows = []
        tbody = table.find("tbody") or table
        for r_i, tr in enumerate(tbody.find_all("tr", recursive=False)):
            tds = tr.find_all("td", recursive=False)
            if len(tds) != len(fields):
                self.anomaly("row_width", f"{key} row {r_i + 1}: {len(tds)} cells, expected {len(fields)}",
                             section=key, raw=[text_or_none(td) for td in tds])
            row = {f: (text_or_none(tds[i]) if i < len(tds) else None) for i, f in enumerate(fields)}
            if len(tds) > len(fields):
                row["_extra_cells"] = [text_or_none(td) for td in tds[len(fields):]]
            rows.append(row)
        return rows

    # ------------------------------------------------------------ grid sections
    def grid_row(self, h6, key):
        container = h6.find_next_sibling("div", class_="container")
        row = container.find("div", class_="row") if container else None
        if row is None:
            self.anomaly("structure", f"{key}: no grid row found", section=key)
        return row

    def parse_hp_accessories(self, h6):
        row = self.grid_row(h6, "hp_pump_accessories")
        if row is None:
            return []
        groups = []
        for g_i, col in enumerate(direct_divs(row)):
            cells = direct_divs(col)
            if not cells or "border-bottom" not in cells[0].get("class", []):
                self.anomaly("structure", f"HP accessory column {g_i + 1} has no title cell",
                             section="hp_pump_accessories")
                title, body = None, cells
            else:
                title, body = text_or_none(cells[0]), cells[1:]
            entries, pending_label = [], None
            for c in body:
                if c.find("label") is not None:
                    if pending_label is not None:  # label followed by label
                        entries.append({"label": pending_label[0], "value": None})
                    pending_label = (text_or_none(c),)
                else:
                    lbl = pending_label[0] if pending_label else None
                    entries.append({"label": lbl, "value": text_or_none(c)})
                    pending_label = None
            if pending_label is not None:
                entries.append({"label": pending_label[0], "value": None})
                self.anomaly("structure", f"HP accessory group {title!r}: trailing label without value",
                             section="hp_pump_accessories")
            groups.append({"position": g_i + 1, "group": title, "entries": entries})
        return groups

    def parse_filters(self, h6):
        row = self.grid_row(h6, "filters")
        if row is None:
            return []
        out = []
        for f_i, col in enumerate(direct_divs(row)):
            cells = direct_divs(col)
            if not cells or cells[0].find("label") is None:
                self.anomaly("structure", f"filter column {f_i + 1} has no title label", section="filters")
                name, vals = None, cells
            else:
                name, vals = text_or_none(cells[0]), cells[1:]
            if any(v.find("label") for v in vals):
                self.anomaly("structure", f"filter {name!r}: label inside value cells", section="filters")
            if len(vals) != 4:
                self.anomaly("filter_value_count", f"filter {name!r} has {len(vals)} values (majority: 4)",
                             section="filters")
            out.append({"position": f_i + 1, "name": name, "values": [text_or_none(v) for v in vals]})
        return out

    # ------------------------------------------------------------ driver
    def parse(self):
        headings = []
        sections = {k: None for k in OPTIONAL_SECTIONS}
        seen = Counter()
        for h6 in self.soup.find_all("h6"):
            raw = norm_ws(h6.get_text(" "))
            headings.append(raw)
            if raw.startswith("Zone:"):
                continue
            key = SECTION_HEADINGS.get(raw)
            if key is None:
                self.anomaly("unexpected_section", f"Unknown heading {raw!r}")
                continue
            self.consumed.append(h6.get_text(strip=True))
            seen[key] += 1
            if seen[key] > 1:
                self.anomaly("duplicate_section", f"Section {raw!r} appears {seen[key]} times", section=key)
            if key in TABLE_SECTIONS:
                sections[key] = self.parse_table(h6, key)
            elif key == "design_parameters":
                sections[key] = self.parse_design_parameters(h6)
            elif key == "hp_pump_accessories":
                sections[key] = self.parse_hp_accessories(h6)
            elif key == "filters":
                sections[key] = self.parse_filters(h6)

        counters = {}
        for cid, n in re.findall(r'setText\("(\w+)",\s*(\d+)\)', self.html):
            if cid not in COUNTER_IDS:
                self.anomaly("unexpected_counter", f"setText id {cid!r}")
                continue
            counters[COUNTER_IDS[cid]] = int(n)

        return {
            "plant": self.parse_plant(),
            "zone": self.parse_zone(),
            "modules": self.parse_modules(),
            **sections,
            "legacy_counts": {k: counters.get(k) for k in COUNTER_IDS.values()},
        }, headings

    # ------------------------------------------------------------ conservation
    def html_text_nodes(self):
        out = []
        for s in self.soup.find_all(string=True):
            if isinstance(s, Comment) or s.parent.name in ("script", "style"):
                continue
            t = s.strip()
            if t:
                out.append(t)
        return out


def leaf_strings(obj, skip=("source", "legacy_counts", "_parse")):
    if isinstance(obj, dict):
        for k, v in obj.items():
            if k in skip:
                continue
            yield from leaf_strings(v, skip)
    elif isinstance(obj, list):
        for v in obj:
            yield from leaf_strings(v, skip)
    elif isinstance(obj, str):
        yield obj


def check_conservation(parser, record):
    """Every non-empty HTML text node must be accounted for by a JSON value or a
    known template string (multiset comparison)."""
    html_nodes = Counter(parser.html_text_nodes())
    accounted = Counter(leaf_strings(record)) + Counter(parser.consumed)
    missing = []
    for t, n in html_nodes.items():
        have = accounted.get(t, 0)
        if t in TEMPLATE_TEXT:
            continue
        have += TEMPLATE_REPEATS.get(t, 0)
        if have < n:
            missing.append({"text": t, "html_count": n, "json_count": accounted.get(t, 0)})
    return missing


def main():
    OUT_DIR.mkdir(exist_ok=True)
    plant_list = json.loads((ROOT / "plant_list.json").read_text(encoding="utf-8"))
    dropdown = {p["id"]: p["name"] for p in plant_list}

    files = sorted(RAW_DIR.glob("plant_*.html"), key=lambda p: int(p.stem.split("_")[1]))
    records, per_plant = [], {}
    heading_sigs = Counter()
    parse_errors = []

    for f in files:
        pid = f.stem.split("_")[1]
        meta_path = META_DIR / f"plant_{pid}.json"
        meta = json.loads(meta_path.read_text(encoding="utf-8")) if meta_path.exists() else None
        html = f.read_text(encoding="utf-8")
        try:
            p = PlantParser(pid, html)
            body, headings = p.parse()
            missing_text = check_conservation(p, body)
        except Exception as e:  # keep going; report
            parse_errors.append({"plant_id": pid, "error": repr(e)})
            continue

        record = {
            "schema_version": SCHEMA_VERSION,
            "plant_id": int(pid),
            "source": {
                "raw_file": f"raw/{f.name}",
                "metadata_file": f"metadata/{meta_path.name}" if meta else None,
                "endpoint": meta.get("endpoint") if meta else None,
                "http_status": meta.get("http_status") if meta else None,
                "dropdown_label": dropdown.get(pid),
            },
            **body,
        }
        if missing_text:
            p.anomaly("text_not_captured", f"{len(missing_text)} HTML text value(s) not present in JSON",
                      items=missing_text)
        records.append(record)
        # section signature ignoring the zone value
        sig = tuple("Zone:*" if h.startswith("Zone:") else h for h in headings)
        heading_sigs[sig] += 1
        per_plant[pid] = {"record": record, "anomalies": p.anomalies, "sig": sig}

    for r in records:
        (OUT_DIR / f"plant_{r['plant_id']}.json").write_text(
            json.dumps(r, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    (ROOT / "all_plants.json").write_text(
        json.dumps(records, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    (ROOT / "schema.json").write_text(
        json.dumps(build_schema(), indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    report = build_report(files, plant_list, records, per_plant, heading_sigs, parse_errors)
    (ROOT / "validation_report.json").write_text(
        json.dumps(report, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(json.dumps(report["summary"], indent=2))


# ====================================================================== report
def build_report(files, plant_list, records, per_plant, heading_sigs, parse_errors):
    by_id = {str(r["plant_id"]): r for r in records}
    majority_sig, _ = heading_sigs.most_common(1)[0]
    full_sig = ("Plant", "Modules", "Zone:*", "Design Parameters", "Pump And Motor", "Instruments",
                "HMI and PLC", "VFD", "Dosing Pump", "HP Pump Accessories", "Filters")

    # --- identity checks
    missing_names = [pid for pid, r in by_id.items() if not r["plant"]["name"]]
    missing_serials = [pid for pid, r in by_id.items() if not r["plant"]["serial_number"]]
    id_counts = Counter(p["id"] for p in plant_list)
    dup_ids = sorted([i for i, n in id_counts.items() if n > 1], key=int)
    file_ids = [f.stem.split("_")[1] for f in files]
    serials = defaultdict(list)
    for pid, r in by_id.items():
        if r["plant"]["serial_number"]:
            serials[r["plant"]["serial_number"]].append(int(pid))
    dup_serials = {s: sorted(ids) for s, ids in serials.items() if len(ids) > 1}

    # --- field-level missing values
    missing_fields = defaultdict(list)
    for pid, r in by_id.items():
        for k, v in r["plant"].items():
            if v is None:
                missing_fields[f"plant.{k}"].append(int(pid))
        if r["zone"] is None:
            missing_fields["zone"].append(int(pid))
        for k, v in r["modules"].items():
            if v is None:
                missing_fields[f"modules.{k}"].append(int(pid))

    # --- sections
    missing_sections = defaultdict(list)
    empty_sections = defaultdict(list)
    for pid, r in by_id.items():
        for s in OPTIONAL_SECTIONS:
            if r[s] is None:
                missing_sections[s].append(int(pid))
            elif r[s] == []:
                empty_sections[s].append(int(pid))

    # --- legacy count vs parsed rows
    count_mismatch = []
    for pid, r in by_id.items():
        for s, n in r["legacy_counts"].items():
            rows = r[s]
            if n is None and rows is None:
                continue
            got = len(rows) if rows is not None else None
            if n != got:
                count_mismatch.append({"plant_id": int(pid), "section": s,
                                       "legacy_count": n, "parsed_rows": got})

    # --- design parameters irregularities
    std_dp = ["Feed Flow", "Feed Conductivity", "Feed TDS", "Feed COD", "Feed Hardness", "Feed Turbidity",
              "Permeate Flow", "Permeate Conductivity", "Permeate TDS", "Permeate COD",
              "Permeate Hardness", "Recovery"]
    dp_dups, dp_order, dp_unknown, dp_missing = [], [], [], defaultdict(list)
    unit_variants = defaultdict(Counter)
    for pid, r in by_id.items():
        dps = r["design_parameters"]
        if not dps:
            continue
        names = [d["name"] for d in dps]
        c = Counter(names)
        dups = {n: k for n, k in c.items() if k > 1}
        if dups:
            dp_dups.append({"plant_id": int(pid), "duplicates": dups,
                            "occurrences": [d for d in dps if d["name"] in dups]})
        uniq = list(dict.fromkeys(n for n in names if n in std_dp))
        if uniq != [n for n in std_dp if n in uniq]:
            dp_order.append({"plant_id": int(pid), "order": names})
        for n in names:
            if n not in std_dp:
                dp_unknown.append({"plant_id": int(pid), "name": n})
        for n in std_dp:
            if n not in c:
                dp_missing[n].append(int(pid))
        for d in dps:
            unit_variants[d["name"]][d["unit_raw"]] += 1

    # --- N/A-style placeholders (preserved verbatim; reported for awareness)
    placeholder_re = re.compile(r"^(n/?a|-+|nil|none|null)$", re.I)
    placeholder_counts = Counter()
    for r in records:
        for s in leaf_strings(r):
            if placeholder_re.match(s.strip()):
                placeholder_counts[s] += 1

    # --- dropdown label cross-check (serial number appears in the dropdown label)
    dropdown_serial_mismatch = []
    for pid, r in by_id.items():
        lbl, serial = r["source"]["dropdown_label"], r["plant"]["serial_number"]
        if lbl and serial and not re.search(rf"(?<![\w]){re.escape(serial)}(?![\w])", lbl):
            dropdown_serial_mismatch.append({"plant_id": int(pid), "serial_number": serial,
                                             "dropdown_label": lbl})

    # --- values with embedded newlines/tabs (preserved but flagged)
    embedded_ws = []
    for r in records:
        for s in leaf_strings(r):
            if "\n" in s or "\t" in s:
                embedded_ws.append({"plant_id": r["plant_id"], "value": s})

    # --- HTML structure vs majority
    structural_variants = []
    for pid, d in per_plant.items():
        if d["sig"] != full_sig:
            structural_variants.append({
                "plant_id": int(pid),
                "missing_sections_vs_full_layout": [h for h in full_sig if h not in d["sig"]],
            })
    structural_variants.sort(key=lambda x: x["plant_id"])

    anomalies = {pid: d["anomalies"] for pid, d in per_plant.items() if d["anomalies"]}
    unexpected_fields = [dict(plant_id=int(pid), **a) for pid, al in anomalies.items() for a in al
                         if a["code"] in ("unexpected_section", "unexpected_header", "row_width",
                                          "unexpected_counter")]
    text_loss = [dict(plant_id=int(pid), **a) for pid, al in anomalies.items() for a in al
                 if a["code"] == "text_not_captured"]

    plants_with_missing_fields = sorted({p for ids in missing_fields.values() for p in ids})
    plants_with_anomalies = sorted(int(p) for p in anomalies)

    def as_ints(d):
        return {k: sorted(v) for k, v in sorted(d.items())}

    return {
        "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "schema_version": SCHEMA_VERSION,
        "summary": {
            "raw_html_files": len(files),
            "plants_in_plant_list": len(plant_list),
            "plants_parsed": len(records) + len(parse_errors),
            "plants_structured": len(records),
            "parse_errors": len(parse_errors),
            "plants_with_parsing_anomalies": len(plants_with_anomalies),
            "plants_with_missing_core_fields": len(plants_with_missing_fields),
            "plants_with_missing_sections": len({p for v in missing_sections.values() for p in v}),
            "plants_with_full_layout": sum(1 for d in per_plant.values() if d["sig"] == full_sig),
            "distinct_section_layouts": len(heading_sigs),
            "text_conservation_failures": len(text_loss),
            "legacy_count_mismatches": len(count_mismatch),
            "missing_plant_names": len(missing_names),
            "missing_serial_numbers": len(missing_serials),
            "duplicate_plant_ids": len(dup_ids),
            "duplicate_serial_numbers": len(dup_serials),
        },
        "checks": {
            "missing_plant_names": sorted(map(int, missing_names)),
            "missing_serial_numbers": sorted(map(int, missing_serials)),
            "duplicate_plant_ids": dup_ids,
            "plant_list_ids_without_raw_file": sorted(set(id_counts) - set(file_ids), key=int),
            "raw_files_without_plant_list_entry": sorted(set(file_ids) - set(id_counts), key=int),
            "duplicate_serial_numbers": dup_serials,
            "missing_core_fields": as_ints(missing_fields),
            "missing_sections": {
                "_note": "Section heading not rendered at all by the legacy page (value null in JSON).",
                **as_ints(missing_sections),
            },
            "empty_sections": {
                "_note": "Section rendered but contained no rows/items (value [] in JSON).",
                **as_ints(empty_sections),
            },
            "unexpected_fields": unexpected_fields,
            "parsing_errors": parse_errors,
            "text_conservation": {
                "_note": "Every non-empty HTML text node was compared (as a multiset) against the "
                         "JSON values plus static template labels. Entries here mean data was lost.",
                "failures": text_loss,
            },
            "legacy_count_vs_parsed_rows": {
                "_note": "The legacy page sets section counters via setText(); compared to parsed rows.",
                "mismatches": count_mismatch,
            },
            "dropdown_label_serial_mismatch": dropdown_serial_mismatch,
            "values_with_embedded_tabs_or_newlines": embedded_ws,
            "placeholder_values_preserved_verbatim": dict(placeholder_counts.most_common()),
        },
        "design_parameters": {
            "standard_names_in_majority_order": std_dp,
            "duplicate_parameter_names": dp_dups,
            "non_standard_order": dp_order,
            "unknown_parameter_names": dp_unknown,
            "plants_missing_standard_parameter": as_ints(dp_missing),
            "unit_spellings_by_parameter": {k: dict(v.most_common()) for k, v in sorted(unit_variants.items())},
        },
        "structure": {
            "full_layout_sections": list(full_sig),
            "majority_layout": list(majority_sig),
            "layouts": [{"sections": list(s), "plant_count": n} for s, n in heading_sigs.most_common()],
            "plants_differing_from_full_layout": structural_variants,
        },
        "anomalies_by_plant": {int(k): v for k, v in sorted(anomalies.items(), key=lambda x: int(x[0]))},
    }


# ====================================================================== schema
def build_schema():
    s_nullable = {"type": ["string", "null"]}
    equip = lambda fields, desc: {
        "type": ["array", "null"],
        "description": desc + " null = section not rendered for this plant; [] = rendered with no rows. "
                              "Row order is preserved from the source.",
        "items": {"type": "object", "additionalProperties": False, "required": fields,
                  "properties": {f: s_nullable for f in fields}},
    }
    return {
        "$schema": "https://json-schema.org/draft/2020-12/schema",
        "$id": "plantdata_export/schema.json",
        "title": "Legacy PlantData plant record",
        "description": (
            "One record per plant, parsed from the legacy /Home/GetDashboardData HTML. "
            "All data values are strings exactly as they appear in the source (HTML entities decoded, "
            "outer whitespace stripped). Nothing is case-normalised, unit-converted or coerced to numbers. "
            "Placeholders such as 'N/A', 'NA', 'na' are preserved verbatim. null means the element was "
            "empty or absent in the source. Equipment codes (e.g. PK121, PK122(S), PK1601, FE183) are kept "
            "exactly as written and no meaning is inferred from them."
        ),
        "version": SCHEMA_VERSION,
        "type": "object",
        "additionalProperties": False,
        "required": ["schema_version", "plant_id", "source", "plant", "zone", "modules",
                     *OPTIONAL_SECTIONS, "legacy_counts"],
        "properties": {
            "schema_version": {"type": "string"},
            "plant_id": {"type": "integer", "description": "Legacy system plant ID (the plantId query parameter / dropdown option value)."},
            "source": {
                "type": "object",
                "description": "Provenance. Not part of the plant data itself.",
                "properties": {
                    "raw_file": {"type": "string"},
                    "metadata_file": s_nullable,
                    "endpoint": s_nullable,
                    "http_status": {"type": ["integer", "null"]},
                    "dropdown_label": {**s_nullable, "description": "Text of the plant's option in the legacy dropdown (original casing; the page itself renders the name in lowercase and capitalises via CSS)."},
                },
            },
            "plant": {
                "type": "object", "additionalProperties": False,
                "properties": {
                    "name": {**s_nullable, "description": "As stored in HTML (lowercase in the source; the legacy UI capitalises via CSS text-capitalize)."},
                    "serial_number": s_nullable,
                    "capacity": {**s_nullable, "description": "Raw text, e.g. '40w'."},
                    "site_contact_number": s_nullable,
                },
            },
            "zone": s_nullable,
            "modules": {
                "type": "object", "additionalProperties": False,
                "description": "Module counts per stage as raw text, e.g. '3(HPRO)', '0'.",
                "properties": {k: s_nullable for k in MODULE_FIELDS.values()},
            },
            "design_parameters": {
                "type": ["array", "null"],
                "description": "Ordered list, exactly as rendered. Order varies between plants and a parameter "
                               "name can appear more than once, so this is NOT a keyed map.",
                "items": {
                    "type": "object", "additionalProperties": False,
                    "properties": {
                        "position": {"type": "integer", "description": "1-based position on the page."},
                        "name": {**s_nullable, "description": "e.g. Feed Flow, Feed Conductivity, Feed TDS, Feed COD, Feed Hardness, Feed Turbidity, Permeate Flow, Permeate Conductivity, Permeate TDS, Permeate COD, Permeate Hardness, Recovery"},
                        "unit": {**s_nullable, "description": "unit_raw without the surrounding parentheses."},
                        "unit_raw": {**s_nullable, "description": "Unit exactly as shown, e.g. '(m³/Hr.)'. Spellings vary."},
                        "value": s_nullable,
                    },
                },
            },
            "pump_and_motor": equip(TABLE_SECTIONS["pump_and_motor"][1],
                                    "Columns: Pump Code | Pump Make | Pump Model | Motor Make | Motor Kw | Motor Amp."),
            "instruments": equip(TABLE_SECTIONS["instruments"][1], "Columns: Name | Make | Model."),
            "hmi_and_plc": equip(TABLE_SECTIONS["hmi_and_plc"][1], "Columns: Name | Make | Model."),
            "vfd": equip(TABLE_SECTIONS["vfd"][1], "Columns: Name | Make | Model."),
            "dosing_pumps": equip(TABLE_SECTIONS["dosing_pumps"][1], "Columns: Dosing Pump for | Make | Model."),
            "hp_pump_accessories": {
                "type": ["array", "null"],
                "description": "One item per column of the legacy grid. Each column has a title (e.g. Motor, "
                               "Pump, Pulsation Damper) followed by label/value pairs. Values that have no "
                               "label in the source have label null. Labels are kept verbatim (e.g. 'Pully', "
                               "'Tapper', 'V-Belt').",
                "items": {
                    "type": "object", "additionalProperties": False,
                    "properties": {
                        "position": {"type": "integer"},
                        "group": s_nullable,
                        "entries": {"type": "array", "items": {
                            "type": "object", "additionalProperties": False,
                            "properties": {"label": s_nullable, "value": s_nullable}}},
                    },
                },
            },
            "filters": {
                "type": ["array", "null"],
                "description": "One item per filter column. The legacy page shows the values WITHOUT field "
                               "labels, so they are kept as an ordered list (normally 4 values); their meaning "
                               "is not inferred.",
                "items": {
                    "type": "object", "additionalProperties": False,
                    "properties": {
                        "position": {"type": "integer"},
                        "name": s_nullable,
                        "values": {"type": "array", "items": s_nullable},
                    },
                },
            },
            "legacy_counts": {
                "type": "object",
                "description": "Section counters the legacy page set via setText(...). null = no counter emitted.",
                "properties": {k: {"type": ["integer", "null"]} for k in COUNTER_IDS.values()},
            },
        },
    }


if __name__ == "__main__":
    main()
