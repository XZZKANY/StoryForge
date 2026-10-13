"""Agent tool catalog oracle: every tool spec, the loop function schemas the model sees (exact bytes),
derived name maps / patch / confirmation sets, and the runtime argument helpers."""

from __future__ import annotations

import hashlib
import json
import os

from golden_fs import isolated_fs_oracle

SECRET = "sk-oracle-secret-123456"
SOURCES = [
    "app/domains/agent_runs/tools/spec_models.py",
    "app/domains/agent_runs/tools/spec_roles.py",
    "app/domains/agent_runs/tools/catalog.py",
    "app/domains/agent_runs/tools/loop_schema.py",
    "app/domains/agent_runs/tools/runtime_arguments.py",
    "app/domains/agent_runs/tools/specs/chapter_specs.py",
    "app/domains/agent_runs/tools/specs/context_fs_specs.py",
    "app/domains/agent_runs/tools/specs/hook_specs.py",
    "app/domains/agent_runs/tools/specs/patch_specs.py",
    "app/domains/agent_runs/tools/specs/project_canon_specs.py",
    "app/domains/agent_runs/tools/specs/project_consistency_specs.py",
    "app/domains/agent_runs/tools/specs/project_specs.py",
]


def p3_tool_catalog_snapshot() -> dict:
    with isolated_fs_oracle("storyforge-golden-tools-") as (api, _run):
        os.environ["STORYFORGE_LLM_API_KEY"] = SECRET
        from app.domains.agent_runs.errors import AgentOrchestrationError
        from app.domains.agent_runs.llm_context import build_llm_context_snapshot
        from app.domains.agent_runs.tools import runtime_arguments as ra
        from app.domains.agent_runs.tools.catalog import confirming_tool_names, list_agent_runtime_tool_specs
        from app.domains.agent_runs.tools.loop_schema import (
            build_loop_tool_name_map,
            build_loop_tool_schemas,
            llm_tool_name,
            loop_patch_tool_specs,
        )
        from app.domains.agent_runs.tools.spec_models import derive_permission_level, derive_requires_confirmation

        specs = []
        for spec in list_agent_runtime_tool_specs():
            specs.append({
                "name": spec.name, "description": spec.description, "domain": spec.domain,
                "input_schema": spec.input_schema, "output_schema": spec.output_schema,
                "allowed_roles": list(spec.allowed_roles), "risk_level": spec.risk_level,
                "retry_safe": spec.retry_safe, "idempotent": spec.idempotent, "execution_mode": spec.execution_mode,
                "artifact_kinds": list(spec.artifact_kinds), "required_capabilities": list(spec.required_capabilities),
                "evidence_fields": list(spec.evidence_fields),
                "references": {key: list(getattr(spec.references, key))
                               for key in ("page_refs", "api_paths", "workflow_nodes")},
                "loop_schema": None if spec.loop_schema is None else {
                    "description": spec.loop_schema.description, "parameters": spec.loop_schema.parameters},
                "loop_input_mode": spec.loop_input_mode, "loop_trusted_context": spec.loop_trusted_context,
                "loop_trace_owner": spec.loop_trace_owner,
                "requires_confirmation": spec.requires_confirmation, "permission_level": spec.permission_level,
            })
        records: list[dict] = []

        def record(fn, args, run):
            row = {"fn": fn, "args": args}
            try:
                row["output"] = json.loads(json.dumps(run(), ensure_ascii=False))
            except AgentOrchestrationError as error:
                row["error"] = str(error)
            records.append(row)

        payloads = [{}, {"offset": 5}, {"offset": True}, {"offset": " 12 "}, {"offset": "-3"}, {"offset": "1.5"},
                    {"offset": "abc"}, {"offset": 2.5}, {"offset": None}, {"offset": ""}, {"offset": "007"}]
        for payload in payloads:
            record("fs_int_arg", {"payload": payload}, lambda p=payload: ra.fs_int_arg(p, "offset", 9))
        bundles = [{}, {"context_bundle": "x"}, {"context_bundle": {"files": "x"}},
                   {"context_bundle": {"files": [1, {"excerpt": "  "}, {"excerpt": "第一段\n\n  第二段  ", "relative_path":
                                                                            " 人物/主角.md ", "kind": "character"},
                                                 {"excerpt": "x" * 1600, "path": "a.md"}, {"excerpt": "无名"},
                                                 {"excerpt": "种类空", "relative_path": "b.md", "kind": " "}]}}]
        for args in bundles:
            record("chat_context_block", {"args": args}, lambda a=args: ra.chat_context_block(a))
        for value in [None, "", "  ", "x", " y ", 3, True, 0, -1, 2]:
            args = {"k": value}
            record("required_string", {"args": args}, lambda a=args: ra.required_string(a, "k"))
            record("required_text", {"args": args}, lambda a=args: ra.required_text(a, "k"))
            record("required_int", {"args": args}, lambda a=args: ra.required_int(a, "k"))
            record("optional_positive_int", {"value": value}, lambda v=value: ra.optional_positive_int(v))
            record("optional_int", {"value": value}, lambda v=value: ra.optional_int(v))
        for percent in (15, 1, 50):
            record("trim_prose_instruction", {"percent": percent}, lambda p=percent: ra.trim_prose_instruction(p))
        summaries = [{"api_key": "x", "content": "正文𠀀", "note": "  多  空白  " + "长" * 300,
                      "token_hint": f"token={SECRET}", "count": 3, "ratio": 0.5, "flag": False, "none": None,
                      "items": [1, 2], "obj": {"b": 1, "a": 2, "中": 3, "Z": 4}, "content_extra": "x"},
                     {"content": 3, "Authorization": "Bearer abc", "has_token": True, "obj": {str(i): i for i in range(25)}},
                     {"obj": {"𠀀": 1, chr(0xE000): 2, "z": 3}}]
        for payload in summaries:
            record("safe_summary", {"payload": payload}, lambda p=payload: ra.safe_summary(p))
        for args in [{"path": "a.md", "query": "q", "content": "c", "file_path": "f", "confirmed": True,
                      "project_root": "r", "_trace_file_path": "t", "llm_context_snapshot": {}, "extra": 1}]:
            record("sanitize_loop_tool_arguments", {"args": args},
                   lambda a=args: ra.sanitize_loop_tool_arguments(a))
        for value in [None, "x", [" a ", "", 3, "b"], [{"rule": " r1 "}, {"rule": ""}, "s", {"x": 1}, 4]]:
            record("string_list", {"value": value}, lambda v=value: ra.string_list(v))
            record("dict_list", {"value": value}, lambda v=value: ra.dict_list(v))
            record("payload_list", {"value": value}, lambda v=value: ra.payload_list(v))
            record("style_rules", {"value": value}, lambda v=value: ra.style_rules(v))
        snapshots = [
            build_llm_context_snapshot(run_state=None, intent="file.revise", user_message="改一下", file_path="正文/第1章.md",
                                       content="正文内容", context_bundle={"files": [
                                           {"relative_path": "人物/主角.md", "kind": "character", "excerpt": "林舟"},
                                           {"relative_path": "设定/城.md", "excerpt": "铁城"}]}),
            build_llm_context_snapshot(run_state=None, intent="file.review", user_message="审稿", file_path="a.md",
                                       content="", context_bundle=None),
        ]
        crafted = {**snapshots[0], "context_files": [*snapshots[0]["context_files"], {
            "relative_path": "设定/知识.md", "knowledge_id": "k-1", "selection_source": "retrieval",
            "evidence_state": "current", "warning_count": 2}]}
        for snapshot in [None, {}, {"snapshot_id": ""}, *snapshots, crafted]:
            record("llm_context_input_summary", {"snapshot": snapshot},
                   lambda s=snapshot: ra.llm_context_input_summary(s))
        for risk in ("read", "analyze", "write_pending", "high_cost", "propose_patch", "network", "long_running",
                     "write", "confirm"):
            for mode in ("sync", "control", "managed_run"):
                record("derive_requires_confirmation", {"risk": risk, "mode": mode},
                       lambda r=risk, m=mode: derive_requires_confirmation(r, m))
                record("derive_permission_level", {"risk": risk, "mode": mode},
                       lambda r=risk, m=mode: derive_permission_level(r, m))
        for name in ("fs.read", "a.b.c", "plain"):
            record("llm_tool_name", {"name": name}, lambda n=name: llm_tool_name(n))
        return {
            "format_version": 1,
            "suite": "p3-tool-catalog",
            "secret": SECRET,
            "sources": {path: hashlib.sha256((api / path).read_bytes()).hexdigest() for path in SOURCES},
            "platform": "windows" if os.name == "nt" else "posix",
            "specs": specs,
            "loop_schemas_wire": json.dumps(build_loop_tool_schemas(), ensure_ascii=False),
            "loop_name_map": build_loop_tool_name_map(),
            "loop_patch_tools": [spec.name for spec in loop_patch_tool_specs()],
            "confirming_tool_names": sorted(confirming_tool_names()),
            "protected_keys": sorted(ra.PROTECTED_LOOP_TOOL_ARGUMENT_KEYS),
            "trusted_writing_context_tools": sorted(ra.TRUSTED_WRITING_CONTEXT_TOOL_NAMES),
            "handler_owned_trace_tools": sorted(ra.HANDLER_OWNED_TRACE_TOOL_NAMES),
            "records": records,
        }
