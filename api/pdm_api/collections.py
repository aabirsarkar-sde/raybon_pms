"""
Declarative description of every ordered, editable child collection.

Each collection maps to one table in database/schema.sql. `fields` are the
editable working columns; `source_key` names the matching key inside the
row's immutable `source` JSONB (the legacy original), when it differs.
"""
from dataclasses import dataclass


@dataclass(frozen=True)
class Field:
    name: str
    source_key: str | None = None  # key in `source` JSONB; defaults to `name`

    @property
    def src(self) -> str:
        return self.source_key or self.name


@dataclass(frozen=True)
class Collection:
    slug: str                      # URL segment
    table: str
    parent_table: str
    parent_fk: str
    fields: tuple[Field, ...]
    title: str
    section: str | None = None     # plant_sections.section / key in the plant document
    derived: tuple[str, ...] = ()  # read-only generated columns
    original_extra: tuple[str, ...] = ()  # extra source keys shown in `original` (not editable)
    child: "Collection | None" = None
    child_key: str | None = None   # name of the child list in documents / create bodies

    @property
    def field_names(self) -> list[str]:
        return [f.name for f in self.fields]


FILTER_VALUES = Collection(
    slug="values", table="filter_values", parent_table="filters", parent_fk="filter_id",
    fields=(Field("label"), Field("value")), title="Filter value",
)
HP_ENTRIES = Collection(
    slug="entries", table="hp_pump_accessory_entries", parent_table="hp_pump_accessory_groups",
    parent_fk="group_id", fields=(Field("label"), Field("value")), title="HP pump accessory entry",
)

PLANT_COLLECTIONS: tuple[Collection, ...] = (
    Collection(
        slug="design-parameters", table="plant_design_parameters", parent_table="plants",
        parent_fk="plant_id", section="design_parameters", title="Design parameter",
        fields=(Field("parameter_name", "name"), Field("value"), Field("unit")),
        derived=("value_numeric",), original_extra=("unit_raw",),
    ),
    Collection(
        slug="pumps-and-motors", table="pumps_and_motors", parent_table="plants", parent_fk="plant_id",
        section="pumps_and_motors", title="Pump and motor",
        fields=(Field("equipment_code", "pump_code"), Field("pump_make"), Field("pump_model"),
                Field("motor_make"), Field("motor_kw"), Field("motor_amp")),
        derived=("motor_kw_numeric", "motor_amp_numeric"),
    ),
    Collection(
        slug="instruments", table="instruments", parent_table="plants", parent_fk="plant_id",
        section="instruments", title="Instrument",
        fields=(Field("name"), Field("make"), Field("model")),
    ),
    Collection(
        slug="hmi-plc", table="hmi_plc", parent_table="plants", parent_fk="plant_id",
        section="hmi_plc", title="HMI / PLC",
        fields=(Field("name"), Field("make"), Field("model")),
    ),
    Collection(
        slug="vfds", table="vfds", parent_table="plants", parent_fk="plant_id",
        section="vfds", title="VFD",
        fields=(Field("name"), Field("make"), Field("model")),
    ),
    Collection(
        slug="dosing-pumps", table="dosing_pumps", parent_table="plants", parent_fk="plant_id",
        section="dosing_pumps", title="Dosing pump",
        fields=(Field("dosing_pump_for"), Field("make"), Field("model")),
    ),
    Collection(
        slug="filters", table="filters", parent_table="plants", parent_fk="plant_id",
        section="filters", title="Filter",
        fields=(Field("name"),), child=FILTER_VALUES, child_key="values",
    ),
    Collection(
        slug="hp-pump-accessories", table="hp_pump_accessory_groups", parent_table="plants",
        parent_fk="plant_id", section="hp_pump_accessories", title="HP pump accessory group",
        fields=(Field("group_name", "group"),), child=HP_ENTRIES, child_key="entries",
    ),
)
BY_SLUG = {c.slug: c for c in PLANT_COLLECTIONS}
