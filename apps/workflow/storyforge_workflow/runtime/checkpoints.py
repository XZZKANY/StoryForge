from __future__ import annotations

import sqlite3 as sqlite3

from storyforge_workflow.runtime import checkpoint_records as _records
from storyforge_workflow.runtime import model_run_sink as _model_runs
from storyforge_workflow.runtime import sqlite_checkpoint_store as _sqlite_store
from storyforge_workflow.runtime.memory_checkpoint_store import InMemoryRuntimeCheckpointStore

RuntimeModelRunRecord = _records.RuntimeModelRunRecord
RuntimeRecord = _records.RuntimeRecord
RuntimeStateSnapshot = _records.RuntimeStateSnapshot
_format_datetime = _records.format_datetime
_model_run_from_row = _records.model_run_from_row
_parse_datetime = _records.parse_datetime
_record_from_row = _records.record_from_row
_snapshot_from_latest_state_row = _records.snapshot_from_latest_state_row
_snapshot_from_state = _records.snapshot_from_state
_state_snapshot_from_row = _records.state_snapshot_from_row

ApiModelRunAdapter = _model_runs.ApiModelRunAdapter
ModelRunPayload = _model_runs.ModelRunPayload
ModelRunSink = _model_runs.ModelRunSink
_optional_nonnegative_float = _model_runs.optional_nonnegative_float
_optional_nonnegative_int = _model_runs.optional_nonnegative_int
_optional_text = _model_runs.optional_text
_promote_observability_fields = _model_runs.promote_observability_fields
_validate_api_job_run_id = _model_runs.validate_api_job_run_id

RuntimeCheckpointStore = _sqlite_store.RuntimeCheckpointStore
_configure_sqlite_connection = _sqlite_store.configure_sqlite_connection
_default_sqlite_path = _sqlite_store.default_sqlite_path
_float_env = _sqlite_store.float_env
_truthy_env = _sqlite_store.truthy_env

__all__ = [
    "ApiModelRunAdapter",
    "InMemoryRuntimeCheckpointStore",
    "ModelRunPayload",
    "ModelRunSink",
    "RuntimeCheckpointStore",
    "RuntimeModelRunRecord",
    "RuntimeRecord",
    "RuntimeStateSnapshot",
    "_configure_sqlite_connection",
    "_default_sqlite_path",
    "_float_env",
    "_format_datetime",
    "_model_run_from_row",
    "_optional_nonnegative_float",
    "_optional_nonnegative_int",
    "_optional_text",
    "_parse_datetime",
    "_promote_observability_fields",
    "_record_from_row",
    "_snapshot_from_latest_state_row",
    "_snapshot_from_state",
    "_state_snapshot_from_row",
    "_truthy_env",
    "_validate_api_job_run_id",
    "sqlite3",
]
