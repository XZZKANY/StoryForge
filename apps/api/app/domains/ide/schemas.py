from __future__ import annotations

from pydantic import BaseModel, Field


class IdeTreeNode(BaseModel):
    """IDE Explorer 使用的统一树节点。"""

    id: str
    type: str
    title: str
    ref_id: int | None = None
    children: list[IdeTreeNode] = Field(default_factory=list)


class IdeWorkspaceTree(BaseModel):
    """工作区树响应，root 用于渲染，nodes 用于快速索引。"""

    root: IdeTreeNode
    nodes: list[IdeTreeNode] = Field(default_factory=list)


class IdeSceneRead(BaseModel):
    """IDE 章节编辑器读取的场景正文。"""

    id: int
    chapter_id: int
    book_id: int
    title: str
    status: str
    content: str


class IdeDiagnosticRange(BaseModel):
    """诊断在章节或场景正文中的字符范围。"""

    start: int
    end: int


class IdeQuickFix(BaseModel):
    """Problems 面板展示的快捷修复命令。"""

    command_id: str
    title: str
    args: dict[str, object] = Field(default_factory=dict)


class IdeDiagnostic(BaseModel):
    """IDE Problems 面板统一诊断契约。"""

    id: str
    severity: str
    code: str
    message: str
    range: IdeDiagnosticRange
    source: str = "judge"
    evidence: list[dict[str, str]] = Field(default_factory=list)
    quickFixes: list[IdeQuickFix] = Field(default_factory=list)


class IdeCommandRequest(BaseModel):
    """IDE 命令执行请求，所有写操作通过 args 传入参数。"""

    args: dict[str, object] = Field(default_factory=dict)


class IdeCommandResult(BaseModel):
    """IDE 命令执行结果，供前端统一处理审计与载荷。"""

    command_id: str
    status: str
    audit_event_id: str | None = None
    payload: dict[str, object] = Field(default_factory=dict)

class IdeContextBudget(BaseModel):
    """Context Inspector 使用的 token 预算信息。"""

    token_budget: int
    used_tokens: int
    dropped_tokens: int
    truncated: bool


class IdeContextBlockRef(BaseModel):
    """Context Inspector 使用的上下文块引用。"""

    block_id: str
    kind: str
    source_ref: str
    token_count: int
    priority: str
    reason: str
    order: int | None = None


class IdeContextSnapshot(BaseModel):
    """IDE Context Inspector 快照响应。"""

    compiled_context_id: str
    book_id: int
    chapter_id: int
    scene_id: int
    budget: IdeContextBudget
    injected_blocks: list[IdeContextBlockRef] = Field(default_factory=list)
    dropped_blocks: list[IdeContextBlockRef] = Field(default_factory=list)
    debug_summary: list[str] = Field(default_factory=list)

class IdeStoryMemoryQuery(BaseModel):
    """IDE Story Memory Explorer 查询条件。"""

    book_id: int = Field(gt=0)
    entity_type: str | None = None
    entity_id: str | None = None
    fact_type: str | None = None
    chapter: int | None = Field(default=None, ge=1)
    conflict_status: str = "all"


class IdeStoryMemoryItem(BaseModel):
    """IDE 展示的长效记忆条目。"""

    memory_id: str
    entity_type: str
    entity_id: str
    fact_type: str
    value: str
    source_ref: str
    source_chapter_id: int | None = None
    valid_from_chapter: int
    valid_to_chapter: int | None = None
    confidence: float
    immutable: bool
    revision: int
    conflict_ids: list[str] = Field(default_factory=list)


class IdeStoryMemoryConflict(BaseModel):
    """IDE 展示的长效记忆冲突。"""

    conflict_id: str
    entity_id: str
    fact_type: str
    left_memory_id: str
    right_memory_id: str
    severity: str
    reason: str
    source_refs: list[str] = Field(default_factory=list)


class IdeStoryMemoryQueryResult(BaseModel):
    """Story Memory Explorer 查询结果。"""

    filters: IdeStoryMemoryQuery
    items: list[IdeStoryMemoryItem] = Field(default_factory=list)
    conflict_queue: list[IdeStoryMemoryConflict] = Field(default_factory=list)
    total: int
    conflicted_count: int

class IdeRunEvent(BaseModel):
    """IDE Run Panel 消费的 BookRun 事件。"""

    event: str
    data: dict[str, object] = Field(default_factory=dict)



class IdeArtifactPreviewContent(BaseModel):
    """IDE Artifact Viewer 使用的预览内容。"""

    format: str
    content_preview: str
    summary: dict[str, object] = Field(default_factory=dict)


class IdeArtifactVersion(BaseModel):
    """同一谱系下可比较的制品版本。"""

    id: int
    version: int
    name: str
    status: str
    created_at: str


class IdeArtifactTraceLink(BaseModel):
    """制品反向追溯中的单个跳转节点。"""

    id: int | None = None
    href: str | None = None
    context_href: str | None = None
    label: str


class IdeArtifactTrace(BaseModel):
    """制品到 BookRun、ModelRun、Judge 和 Approve 的反向追溯链。"""

    book_run: IdeArtifactTraceLink
    model_run: IdeArtifactTraceLink
    judge_report: IdeArtifactTraceLink
    approve: IdeArtifactTraceLink


class IdeArtifactPreview(BaseModel):
    """IDE Artifact Viewer 聚合响应。"""

    artifact: dict[str, object]
    preview: IdeArtifactPreviewContent
    download: dict[str, object]
    versions: list[IdeArtifactVersion] = Field(default_factory=list)
    trace: IdeArtifactTrace
