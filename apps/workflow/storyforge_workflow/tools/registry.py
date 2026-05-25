from __future__ import annotations

from collections.abc import Iterable, Mapping, Sequence
from dataclasses import dataclass, field
from types import MappingProxyType

JSONSchema = Mapping[str, object]


def _freeze_value(value: object) -> object:
    """递归冻结 JSON schema 值，保证注册表只暴露只读快照。"""

    if isinstance(value, Mapping):
        return MappingProxyType({str(key): _freeze_value(item) for key, item in value.items()})
    if isinstance(value, list | tuple):
        return tuple(_freeze_value(item) for item in value)
    if isinstance(value, set | frozenset):
        return frozenset(_freeze_value(item) for item in value)
    return value


def _freeze_schema(schema: Mapping[str, object]) -> JSONSchema:
    """复制并冻结 schema，避免调用方保留原始 dict 后污染注册表。"""

    frozen = _freeze_value(schema)
    if not isinstance(frozen, Mapping):
        raise TypeError("工具 schema 必须是 mapping。")
    return frozen


def _normalize_values(values: Sequence[str]) -> tuple[str, ...]:
    """清理字符串序列，保持静态字段稳定且无空项。"""

    return tuple(value.strip() for value in values if value.strip())


@dataclass(frozen=True)
class CreativeToolReferences:
    """创作工具与页面、API、workflow 节点之间的静态对应关系。"""

    page_refs: Sequence[str] = field(default_factory=tuple)
    api_paths: Sequence[str] = field(default_factory=tuple)
    workflow_nodes: Sequence[str] = field(default_factory=tuple)

    def __post_init__(self) -> None:
        object.__setattr__(self, "page_refs", _normalize_values(self.page_refs))
        object.__setattr__(self, "api_paths", _normalize_values(self.api_paths))
        object.__setattr__(self, "workflow_nodes", _normalize_values(self.workflow_nodes))


@dataclass(frozen=True)
class CreativeToolSpec:
    """workflow 内部统一创作工具能力说明。"""

    name: str
    domain: str
    input_schema: JSONSchema
    output_schema: JSONSchema
    required_capabilities: Sequence[str] = field(default_factory=tuple)
    evidence_fields: Sequence[str] = field(default_factory=tuple)
    references: CreativeToolReferences = field(default_factory=CreativeToolReferences)

    def __post_init__(self) -> None:
        name = self.name.strip()
        domain = self.domain.strip()
        if not name:
            raise ValueError("工具名称不能为空。")
        if not domain:
            raise ValueError("工具 domain 不能为空。")
        object.__setattr__(self, "name", name)
        object.__setattr__(self, "domain", domain)
        object.__setattr__(self, "input_schema", _freeze_schema(self.input_schema))
        object.__setattr__(self, "output_schema", _freeze_schema(self.output_schema))
        object.__setattr__(self, "required_capabilities", _normalize_values(self.required_capabilities))
        object.__setattr__(self, "evidence_fields", _normalize_values(self.evidence_fields))


class CreativeToolRegistry:
    """静态创作工具注册表，负责按名称、domain 和能力查询元数据。"""

    def __init__(self, tools: Iterable[CreativeToolSpec]) -> None:
        self._tools = tuple(tools)
        index: dict[str, CreativeToolSpec] = {}
        for tool in self._tools:
            if tool.name in index:
                raise ValueError(f"工具名称重复：{tool.name}")
            index[tool.name] = tool
        self._by_name = MappingProxyType(index)

    def all(self) -> tuple[CreativeToolSpec, ...]:
        """按注册顺序返回全部工具说明。"""

        return self._tools

    def get(self, name: str) -> CreativeToolSpec | None:
        """按名称读取工具；缺失时返回 None，便于调用方自行降级。"""

        return self._by_name.get(name)

    def require(self, name: str) -> CreativeToolSpec:
        """按名称读取工具；缺失时抛出明确错误。"""

        tool = self.get(name)
        if tool is None:
            raise KeyError(f"创作工具不存在：{name}")
        return tool

    def by_domain(self, domain: str) -> tuple[CreativeToolSpec, ...]:
        """返回指定 domain 下的全部工具。"""

        normalized_domain = domain.strip()
        return tuple(tool for tool in self._tools if tool.domain == normalized_domain)

    def by_capability(self, capability: str) -> tuple[CreativeToolSpec, ...]:
        """返回声明需要指定能力的全部工具。"""

        normalized_capability = capability.strip()
        return tuple(tool for tool in self._tools if normalized_capability in tool.required_capabilities)


def _object_schema(title: str, properties: Mapping[str, object], required: Sequence[str] = ()) -> JSONSchema:
    """构造注册表内使用的轻量 JSON Schema。"""

    schema: dict[str, object] = {
        "title": title,
        "type": "object",
        "properties": dict(properties),
    }
    if required:
        schema["required"] = tuple(required)
    return schema


def _array_schema(title: str, items: Mapping[str, object]) -> JSONSchema:
    """构造数组响应 schema，保持输出契约可读。"""

    return {"title": title, "type": "array", "items": dict(items)}


def _refs(
    *,
    page_refs: Sequence[str] = (),
    api_paths: Sequence[str] = (),
    workflow_nodes: Sequence[str] = (),
) -> CreativeToolReferences:
    """用简短工厂保持默认注册表条目可读。"""

    return CreativeToolReferences(page_refs=page_refs, api_paths=api_paths, workflow_nodes=workflow_nodes)


DEFAULT_CREATIVE_TOOL_REGISTRY = CreativeToolRegistry(
    [
        CreativeToolSpec(
            name="retrieval.search",
            domain="retrieval",
            input_schema=_object_schema(
                "RetrievalSearchCreate",
                {
                    "query": {"type": "string", "minLength": 1},
                    "book_id": {"type": ["integer", "null"], "minimum": 1},
                    "series_id": {"type": ["integer", "null"], "minimum": 1},
                    "limit": {"type": "integer", "minimum": 1, "maximum": 20},
                },
                required=("query",),
            ),
            output_schema=_array_schema(
                "RetrievalHitReadList",
                {
                    "title": "RetrievalHitRead",
                    "type": "object",
                    "required": ("source_ref", "excerpt", "score", "rank"),
                },
            ),
            required_capabilities=("embedding", "reranker"),
            evidence_fields=("source_ref", "source_id", "chunk_id", "score", "rank", "score_source"),
            references=_refs(
                page_refs=("apps/web/app/retrieval/page.tsx",),
                api_paths=("POST /api/retrieval/search", "POST /api/retrieval/workbench/search"),
                workflow_nodes=("scene_packets.retrieval_context",),
            ),
        ),
        CreativeToolSpec(
            name="scene_packets.assemble",
            domain="scene_packets",
            input_schema=_object_schema(
                "ScenePacketCreate",
                {
                    "book_id": {"type": "integer", "minimum": 1},
                    "chapter_id": {"type": "integer", "minimum": 1},
                    "scene_goal": {"type": "string", "minLength": 1},
                    "active_asset_ids": {"type": "array", "items": {"type": "integer"}, "minItems": 1},
                    "token_budget": {"type": "integer", "minimum": 1},
                    "retrieval_snippets": {"type": "array", "items": {"type": "string"}},
                },
                required=("book_id", "chapter_id", "scene_goal", "active_asset_ids", "token_budget"),
            ),
            output_schema=_object_schema(
                "ScenePacketRead",
                {
                    "packet": {"type": "object"},
                    "budget_statistics": {"type": "object"},
                    "evidence_links": {"type": "array"},
                },
            ),
            required_capabilities=("retrieval",),
            evidence_fields=("evidence_links", "budget_statistics", "compiled_context_id", "retrieval_hits"),
            references=_refs(
                page_refs=(
                    "apps/web/app/studio/api.ts",
                    "apps/web/components/scene-packet/ScenePacketPanel.tsx",
                ),
                api_paths=("POST /api/scene-packets", "GET /api/studio/scene-packets"),
                workflow_nodes=("scene_architect.chapter_plan", "scene_architect.scene_beats"),
            ),
        ),
        CreativeToolSpec(
            name="judge.create_issues",
            domain="judge",
            input_schema=_object_schema(
                "JudgeIssueCreate",
                {
                    "scene_id": {"type": "integer", "minimum": 1},
                    "scene_packet_id": {"type": ["integer", "null"], "minimum": 1},
                    "content": {"type": "string", "minLength": 1},
                    "required_facts": {"type": "array", "items": {"type": "string"}},
                    "style_rules": {"type": "array", "items": {"type": "string"}},
                    "evidence_links": {"type": "array", "items": {"type": "object"}},
                },
                required=("scene_id", "content"),
            ),
            output_schema=_array_schema(
                "JudgeIssueReadList",
                {"title": "JudgeIssueRead", "type": "object", "required": ("category", "severity", "status")},
            ),
            required_capabilities=("llm",),
            evidence_fields=("span_start", "span_end", "evidence_links", "recommended_repair_mode", "status"),
            references=_refs(
                page_refs=("apps/web/app/studio/api.ts", "apps/web/components/judge-panel/JudgeIssueList.tsx"),
                api_paths=("POST /api/judge/issues", "GET /api/studio/judge-reviews"),
                workflow_nodes=("draft_writer", "human_approval"),
            ),
        ),
        CreativeToolSpec(
            name="repair.create_patch",
            domain="repair",
            input_schema=_object_schema(
                "RepairPatchCreate",
                {
                    "issue_id": {"type": "integer", "minimum": 1},
                    "content": {"type": "string", "minLength": 1},
                },
                required=("issue_id", "content"),
            ),
            output_schema=_object_schema(
                "RepairPatchRead",
                {
                    "target_span": {"type": "string"},
                    "replacement_text": {"type": "string"},
                    "requires_rejudge": {"type": "boolean"},
                },
            ),
            required_capabilities=(),
            evidence_fields=("target_span", "replacement_text", "reason", "requires_rejudge", "status"),
            references=_refs(
                page_refs=("apps/web/app/studio/api.ts", "apps/web/components/diff-viewer/RepairDiffViewer.tsx"),
                api_paths=("POST /api/repair/patches", "GET /api/studio/repair-patches"),
                workflow_nodes=("human_approval",),
            ),
        ),
        CreativeToolSpec(
            name="artifacts.create",
            domain="artifacts",
            input_schema=_object_schema(
                "ArtifactCreate",
                {
                    "workspace_id": {"type": ["integer", "null"], "minimum": 1},
                    "book_id": {"type": ["integer", "null"], "minimum": 1},
                    "artifact_type": {"type": "string", "minLength": 1},
                    "lineage_key": {"type": ["string", "null"]},
                    "name": {"type": "string", "minLength": 1},
                    "storage_uri": {"type": "string", "minLength": 1},
                    "payload": {"type": "object"},
                },
                required=("artifact_type", "name", "storage_uri"),
            ),
            output_schema=_object_schema(
                "ArtifactRead",
                {
                    "id": {"type": "integer"},
                    "lineage_key": {"type": "string"},
                    "version": {"type": "integer"},
                    "payload": {"type": "object"},
                },
            ),
            required_capabilities=(),
            evidence_fields=("lineage_key", "storage_uri", "version", "payload", "artifact_type"),
            references=_refs(
                page_refs=("apps/web/app/artifacts/page.tsx",),
                api_paths=("POST /api/artifacts", "GET /api/artifacts/{artifact_id}/download"),
                workflow_nodes=("draft_writer",),
            ),
        ),
        CreativeToolSpec(
            name="evaluations.create_run",
            domain="evaluations",
            input_schema=_object_schema(
                "EvaluationRunCreate",
                {
                    "case_id": {"type": ["integer", "null"], "minimum": 1},
                    "workspace_id": {"type": ["integer", "null"], "minimum": 1},
                    "book_id": {"type": ["integer", "null"], "minimum": 1},
                    "observed_payload": {"type": "object"},
                },
            ),
            output_schema=_object_schema(
                "EvaluationRunRead",
                {
                    "status": {"type": "string"},
                    "metrics": {"type": "object"},
                    "summary": {"type": "string"},
                },
            ),
            required_capabilities=(),
            evidence_fields=("metrics", "summary", "failed_sample_count", "studio_feedback_href"),
            references=_refs(
                page_refs=("apps/web/app/evaluations/page.tsx",),
                api_paths=("POST /api/evaluations/runs", "GET /api/evaluations/runs/{run_id}"),
                workflow_nodes=("human_approval",),
            ),
        ),
        CreativeToolSpec(
            name="provider_gateway.resolve",
            domain="provider_gateway",
            input_schema=_object_schema(
                "ProviderResolutionQuery",
                {
                    "capability": {"type": "string", "enum": ("llm", "embedding", "reranker")},
                    "workspace_id": {"type": ["integer", "null"], "minimum": 1},
                },
                required=("capability",),
            ),
            output_schema=_object_schema(
                "ProviderResolutionRead",
                {
                    "provider_name": {"type": "string"},
                    "capability": {"type": "string"},
                    "model_aliases": {"type": "object"},
                    "credential_status": {"type": "string"},
                },
            ),
            required_capabilities=("llm", "embedding", "reranker"),
            evidence_fields=("provider_name", "model_aliases", "resolution_source", "credential_status"),
            references=_refs(
                page_refs=("apps/web/app/providers/page.tsx",),
                api_paths=("GET /api/provider-gateway/resolve",),
                workflow_nodes=("provider_execution",),
            ),
        ),
    ]
)


def list_creative_tools() -> tuple[CreativeToolSpec, ...]:
    """返回默认静态创作工具注册表中的全部工具。"""

    return DEFAULT_CREATIVE_TOOL_REGISTRY.all()


def get_creative_tool(name: str) -> CreativeToolSpec | None:
    """从默认静态创作工具注册表按名称读取工具。"""

    return DEFAULT_CREATIVE_TOOL_REGISTRY.get(name)
