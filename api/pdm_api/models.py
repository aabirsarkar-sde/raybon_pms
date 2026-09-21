"""Request bodies and validation rules."""
import re
from typing import Annotated, Optional

from pydantic import (AfterValidator, AwareDatetime, BaseModel, ConfigDict, Field, StrictInt,
                      StringConstraints, create_model)

from .collections import Collection

MAX_TEXT = 1000
_CONTROL = re.compile(r"[\x00-\x08\x0a-\x1f\x7f]")  # tab (\x09) is allowed: legacy data contains it


def _check_text(v: str) -> str:
    # Values are stored exactly as sent. Anything that would need silent
    # rewriting is rejected instead.
    if v == "":
        raise ValueError("empty string is not allowed; send null for 'no value'")
    if v != v.strip():
        raise ValueError("leading/trailing whitespace is not allowed")
    if _CONTROL.search(v):
        raise ValueError("control characters other than tab are not allowed")
    return v


Text = Annotated[str, StringConstraints(max_length=MAX_TEXT, strict=True), AfterValidator(_check_text)]
Position = Annotated[StrictInt, Field(ge=1)]

_FORBID = ConfigDict(extra="forbid")


class _Body(BaseModel):
    model_config = _FORBID


class PatchBase(_Body):
    expected_updated_at: Optional[AwareDatetime] = Field(
        None, description="Optimistic concurrency: reject with 409 if the row changed since this value.")

    def changes(self) -> dict:
        data = {k: getattr(self, k) for k in self.model_fields_set if k != "expected_updated_at"}
        if not data:
            raise ValueError("no fields to update")
        return data


class PlantCreate(_Body):
    name: Text
    display_name: Optional[Text] = None
    serial_number: Optional[Text] = None
    capacity: Optional[Text] = None
    site_contact_number: Optional[Text] = None
    zone_id: Optional[StrictInt] = None


class PlantPatch(PatchBase):
    name: Text = None  # type: ignore[assignment]  # may be omitted, but not set to null
    display_name: Optional[Text] = None
    serial_number: Optional[Text] = None
    capacity: Optional[Text] = None
    site_contact_number: Optional[Text] = None
    zone_id: Optional[StrictInt] = None

    def changes(self) -> dict:
        data = super().changes()
        if "name" in data and data["name"] is None:
            raise ValueError("name cannot be null")
        return data


class ModulePatch(PatchBase):
    value_text: Optional[Text] = None
    quantity: Optional[Annotated[StrictInt, Field(ge=0)]] = None
    module_type: Optional[Text] = None


class ZoneCreate(_Body):
    name: Text


class Reorder(_Body):
    ids: list[StrictInt] = Field(..., description="Every item id of the list, in the new order.")


def _field_defs(coll: Collection) -> dict:
    return {f: (Optional[Text], None) for f in coll.field_names}


def build_models(coll: Collection) -> tuple[type[BaseModel], type[BaseModel]]:
    """(Create, Patch) models for a collection."""
    name = "".join(p.capitalize() for p in coll.table.split("_"))
    extra = {}
    if coll.child is not None:
        child_inline = create_model(f"{name}{coll.child_key.capitalize()}Inline", __config__=_FORBID,
                                    **_field_defs(coll.child))
        extra[coll.child_key] = (Optional[list[child_inline]], None)
    create = create_model(f"{name}Create", __config__=_FORBID,
                          position=(Optional[Position], None), **_field_defs(coll), **extra)
    patch = create_model(f"{name}Patch", __base__=PatchBase, **_field_defs(coll))
    return create, patch
