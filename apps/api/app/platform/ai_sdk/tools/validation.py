from __future__ import annotations

from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from typing import Any


@dataclass(frozen=True)
class SchemaIssue:
    path: tuple[str | int, ...]
    code: str
    message: str


def _matches_type(value: Any, expected: str) -> bool:
    if expected == "object":
        return isinstance(value, Mapping)
    if expected == "array":
        return isinstance(value, Sequence) and not isinstance(value, str | bytes | bytearray)
    if expected == "string":
        return isinstance(value, str)
    if expected == "integer":
        return isinstance(value, int) and not isinstance(value, bool)
    if expected == "number":
        return isinstance(value, int | float) and not isinstance(value, bool)
    if expected == "boolean":
        return isinstance(value, bool)
    if expected == "null":
        return value is None
    return True


def validate_json_schema(
    value: Any,
    schema: Mapping[str, Any],
    *,
    path: tuple[str | int, ...] = (),
) -> tuple[SchemaIssue, ...]:
    """Validate the JSON Schema subset used by runtime tool contracts."""

    issues: list[SchemaIssue] = []
    enum = schema.get("enum")
    if isinstance(enum, Sequence) and not isinstance(enum, str | bytes) and value not in enum:
        issues.append(SchemaIssue(path, "enum", "Value is not one of the allowed choices."))
        return tuple(issues)

    raw_type = schema.get("type")
    expected_types = (
        tuple(item for item in raw_type if isinstance(item, str))
        if isinstance(raw_type, list | tuple)
        else (raw_type,) if isinstance(raw_type, str) else ()
    )
    if expected_types and not any(_matches_type(value, expected) for expected in expected_types):
        issues.append(
            SchemaIssue(path, "type", f"Expected {' or '.join(expected_types)}.")
        )
        return tuple(issues)

    if isinstance(value, Mapping):
        properties = schema.get("properties")
        property_schemas = properties if isinstance(properties, Mapping) else {}
        required = schema.get("required")
        if isinstance(required, Sequence) and not isinstance(required, str | bytes):
            for key in required:
                if isinstance(key, str) and key not in value:
                    issues.append(SchemaIssue((*path, key), "required", "Required property is missing."))
        for key, item in value.items():
            child_schema = property_schemas.get(key)
            if isinstance(child_schema, Mapping):
                issues.extend(validate_json_schema(item, child_schema, path=(*path, str(key))))
            elif schema.get("additionalProperties") is False:
                issues.append(
                    SchemaIssue((*path, str(key)), "additional_property", "Additional property is not allowed.")
                )

    if isinstance(value, Sequence) and not isinstance(value, str | bytes | bytearray):
        item_schema = schema.get("items")
        if isinstance(item_schema, Mapping):
            for index, item in enumerate(value):
                issues.extend(validate_json_schema(item, item_schema, path=(*path, index)))

    if isinstance(value, str):
        minimum = schema.get("minLength")
        maximum = schema.get("maxLength")
        if isinstance(minimum, int) and len(value) < minimum:
            issues.append(SchemaIssue(path, "min_length", f"String must contain at least {minimum} characters."))
        if isinstance(maximum, int) and len(value) > maximum:
            issues.append(SchemaIssue(path, "max_length", f"String must contain at most {maximum} characters."))

    if isinstance(value, int | float) and not isinstance(value, bool):
        minimum = schema.get("minimum")
        maximum = schema.get("maximum")
        if isinstance(minimum, int | float) and value < minimum:
            issues.append(SchemaIssue(path, "minimum", f"Number must be at least {minimum}."))
        if isinstance(maximum, int | float) and value > maximum:
            issues.append(SchemaIssue(path, "maximum", f"Number must be at most {maximum}."))
    return tuple(issues)
