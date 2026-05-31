# StoryForge Novel Skill Framework 后续总阶段 Implementation Plan

> **给执行代理的要求：** 必须使用 `superpowers:subagent-driven-development`（推荐）或 `superpowers:executing-plans` 按任务执行。所有步骤使用复选框跟踪。所有验证必须在本地完成，并写入 `D:\StoryForge\.codex\verification-report.md`。

**目标：** 在第一阶段“静态技能定义与只读审计映射”完成后，继续完成 Novel Skill Framework 的运行器适配、BookRun 审计集成、Web 展示、题材技能包扩展和总验证交付，让 StoryForge 能按技能链记录、回放和扩展长篇小说生成闭环。

**架构：** 继续以 `NovelLoop` / `BookLoop` 为运行事实源，技能框架只包装既有 `NovelLoopPorts`、记录引用化 `NovelSkillRun`、派生审计摘要，并把摘要追加到 BookRun 审计报告。不得新增第二套编排器，不得改变单章 `approved` / `awaiting_review` 与整书 `completed` / `awaiting_review` / `paused_by_budget` / `paused_by_provider_degradation` 状态契约。

**Tech Stack:** Python 3.13、pytest、frozen dataclass、现有 workflow 端口注入模式、FastAPI BookRun 域服务、Next.js/Vitest 页面测试、pnpm/uv 本地验证链路。

---

## 一、前置事实与执行边界

### 1.1 第一阶段完成前提

用户已确认第一阶段完成。执行后续阶段前仍必须在当前工作区核验以下文件存在且测试通过：

- `D:\StoryForge\apps\workflow\storyforge_workflow\skills\definitions.py`
- `D:\StoryForge\apps\workflow\storyforge_workflow\skills\audit.py`
- `D:\StoryForge\apps\workflow\storyforge_workflow\skills\generate\SKILL.md`
- `D:\StoryForge\apps\workflow\storyforge_workflow\skills\judge\SKILL.md`
- `D:\StoryForge\apps\workflow\storyforge_workflow\skills\repair\SKILL.md`
- `D:\StoryForge\apps\workflow\storyforge_workflow\skills\approve\SKILL.md`
- `D:\StoryForge\apps\workflow\storyforge_workflow\skills\memory_extract\SKILL.md`
- `D:\StoryForge\apps\workflow\storyforge_workflow\skills\export\SKILL.md`
- `D:\StoryForge\apps\workflow\tests\test_novel_skill_registry.py`
- `D:\StoryForge\apps\workflow\tests\test_skill_audit_summary.py`

若任一文件缺失，后续实现必须暂停，先恢复第一阶段产物或切换到包含第一阶段成果的工作区。

### 1.2 禁止变更

- 禁止新增动态插件市场、任意用户代码执行或目录扫描式技能加载。
- 禁止把完整 prompt、完整 Scene Packet 或完整正文写入 workflow checkpoint。
- 禁止新增 `repair_required`、`repair_limit_exceeded`、`provider_failed`、`budget_exceeded` 等虚构 NovelLoop / BookLoop 终态。
- 禁止让题材技能包自动污染所有 BookRun；必须显式选择。
- 禁止使用 CI、远程流水线或人工验证代替本地命令。

---

## 二、文件职责总览

### 2.1 预计新增文件

- `D:\StoryForge\apps\workflow\storyforge_workflow\skills\runner.py`
  - 定义 `NovelSkillRun`、`NovelSkillRunner`、引用摘要构造与端口包装结果。
- `D:\StoryForge\apps\workflow\tests\test_novel_skill_runner.py`
  - 覆盖 runner 成功、失败、引用化记录、预算字段、禁止完整正文入记录。
- `D:\StoryForge\apps\workflow\tests\test_novel_loop_skill_runner_integration.py`
  - 覆盖通过 runner 执行后 `run_single_chapter_loop()` 对外结果等价。
- `D:\StoryForge\apps\workflow\storyforge_workflow\skills\genre_mystery\clue_fairness_judge\SKILL.md`
  - 悬疑线索公平性题材技能定义。
- `D:\StoryForge\apps\workflow\storyforge_workflow\skills\genre_xuanhuan\power_scale_guard\SKILL.md`
  - 玄幻战力等级守卫题材技能定义。
- `D:\StoryForge\apps\workflow\storyforge_workflow\skills\genre_romance\relationship_arc_judge\SKILL.md`
  - 言情关系弧评审题材技能定义。
- `D:\StoryForge\apps\workflow\tests\test_genre_skill_registry.py`
  - 覆盖题材技能包显式选择、默认不加载、状态契约不越界。

### 2.2 预计修改文件

- `D:\StoryForge\apps\workflow\storyforge_workflow\orchestrators\novel_loop.py`
  - 阶段二可选接入 runner；接入后对外 `NovelLoopResult` 必须等价。
- `D:\StoryForge\apps\workflow\storyforge_workflow\skills\definitions.py`
  - 增加题材技能包显式注册或选择接口。
- `D:\StoryForge\apps\workflow\storyforge_workflow\skills\audit.py`
  - 从 runner 记录补充更完整 skill_chain 摘要；保持只读派生。
- `D:\StoryForge\apps\api\app\domains\book_runs\schemas.py`
  - 追加 skill_chain 审计报告 schema；缺失数据时可空退化。
- `D:\StoryForge\apps\api\app\domains\book_runs\service.py`
  - 导出 `audit_report.json` 时追加技能链摘要，不覆盖现有字段。
- `D:\StoryForge\apps\api\tests\test_book_runs.py`
  - 若现有审计报告测试在此文件，追加 skill_chain 覆盖；实际文件以搜索结果为准。
- `D:\StoryForge\apps\web\app\book-runs\[id]\audit\...`
  - 展示技能链、状态、模型运行、评审、批准、记忆抽取与导出摘要。
- `D:\StoryForge\apps\web\tests\...`
  - 追加审计页技能链渲染测试；实际文件以搜索结果为准。
- `D:\StoryForge\.codex\operations-log.md`
  - 记录关键决策、失败补救、验证结果。
- `D:\StoryForge\.codex\verification-report.md`
  - 记录最终本地验证、评分与结论。

---

## 三、总任务清单

### Task 0：后续阶段基线核验

**目标：** 确认第一阶段成果已经在当前工作区可用，避免在缺少 registry / audit 基线时直接实施阶段二。

**Files:**
- Read: `D:\StoryForge\docs\superpowers\specs\2026-05-31-storyforge-novel-skill-framework-design.md`
- Read: `D:\StoryForge\apps\workflow\storyforge_workflow\skills\definitions.py`
- Read: `D:\StoryForge\apps\workflow\storyforge_workflow\skills\audit.py`
- Modify: `D:\StoryForge\.codex\operations-log.md`

- [x] **Step 0.1：核验第一阶段文件**

```powershell
cd D:\StoryForge
Test-Path apps\workflow\storyforge_workflow\skills\definitions.py
Test-Path apps\workflow\storyforge_workflow\skills\audit.py
Test-Path apps\workflow\tests\test_novel_skill_registry.py
Test-Path apps\workflow\tests\test_skill_audit_summary.py
```

Expected: 四行均为 `True`。

- [x] **Step 0.2：运行第一阶段回归测试**

```powershell
cd D:\StoryForge\apps\workflow
uv run pytest tests/test_novel_skill_registry.py tests/test_skill_audit_summary.py tests/test_novel_loop_single_chapter.py tests/test_book_loop_three_chapters.py tests/test_provider_degradation_pause.py -v
```

Expected: 全部通过。

- [x] **Step 0.3：失败处理**

若 Step 0.1 或 Step 0.2 失败：

1. 停止阶段二实现。
2. 在 `D:\StoryForge\.codex\operations-log.md` 记录缺失文件或失败测试。
3. 先恢复第一阶段成果，再重新运行 Task 0。

- [x] **Step 0.4：记录基线通过**

在 `operations-log.md` 写入：

```markdown
## Novel Skill Framework 后续阶段基线核验

时间：YYYY-MM-DD HH:mm:ss

- 第一阶段文件核验：通过
- 第一阶段回归测试：通过
- 允许进入阶段二 Skill Runner 适配
```

---

### Task 1：新增 NovelSkillRun 数据模型与 Runner 单元测试

**目标：** 先定义技能运行记录的最小结构和本地 deterministic 测试，不接入 NovelLoop。

**Files:**
- Create: `D:\StoryForge\apps\workflow\storyforge_workflow\skills\runner.py`
- Create: `D:\StoryForge\apps\workflow\tests\test_novel_skill_runner.py`
- Reference: `D:\StoryForge\apps\workflow\storyforge_workflow\skills\definitions.py`

- [x] **Step 1.1：写失败测试：NovelSkillRun 只保存引用化字段**

在 `test_novel_skill_runner.py` 新增：

```python
from __future__ import annotations

from storyforge_workflow.skills.runner import NovelSkillRun


def test_skill_run_keeps_reference_fields_without_full_payload() -> None:
    run = NovelSkillRun(
        skill_name="generate",
        skill_version="1.0.0",
        status="generated",
        book_id=10,
        chapter_index=1,
        input_refs={"compiled_context_id": "ctx-1"},
        output_refs={"model_run_id": 55, "draft_hash": "sha256:abc"},
        budget={"token_usage": 120, "elapsed_time_sec": 2, "cost_estimate": 0.01},
    )

    payload = run.to_audit_dict()

    assert payload["skill_name"] == "generate"
    assert payload["output_refs"] == {"model_run_id": 55, "draft_hash": "sha256:abc"}
    assert "draft" not in payload
    assert "prompt" not in payload
    assert "scene_packet" not in payload
```

- [x] **Step 1.2：运行红灯测试**

```powershell
cd D:\StoryForge\apps\workflow
uv run pytest tests/test_novel_skill_runner.py::test_skill_run_keeps_reference_fields_without_full_payload -v
```

Expected: 失败，提示 `storyforge_workflow.skills.runner` 不存在或 `NovelSkillRun` 不存在。

- [x] **Step 1.3：实现最小 NovelSkillRun**

在 `runner.py` 新增：

```python
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any


@dataclass(frozen=True)
class NovelSkillRun:
    """一次技能运行的引用化审计记录，不保存完整正文或 prompt。"""

    skill_name: str
    skill_version: str
    status: str
    book_id: int
    chapter_index: int | None = None
    input_refs: dict[str, Any] = field(default_factory=dict)
    output_refs: dict[str, Any] = field(default_factory=dict)
    budget: dict[str, int | float] = field(default_factory=dict)
    error_summary: str | None = None

    def to_audit_dict(self) -> dict[str, Any]:
        return {
            "skill_name": self.skill_name,
            "skill_version": self.skill_version,
            "status": self.status,
            "book_id": self.book_id,
            "chapter_index": self.chapter_index,
            "input_refs": dict(self.input_refs),
            "output_refs": dict(self.output_refs),
            "budget": dict(self.budget),
            "error_summary": self.error_summary,
        }
```

- [x] **Step 1.4：运行绿灯测试**

```powershell
cd D:\StoryForge\apps\workflow
uv run pytest tests/test_novel_skill_runner.py::test_skill_run_keeps_reference_fields_without_full_payload -v
```

Expected: 通过。

- [x] **Step 1.5：新增 runner 查 registry 测试**

追加测试：

```python
from storyforge_workflow.skills.definitions import NovelSkillRegistry
from storyforge_workflow.skills.runner import NovelSkillRunner


def test_skill_runner_resolves_definition_by_name() -> None:
    runner = NovelSkillRunner(registry=NovelSkillRegistry.default())

    definition = runner.definition_for("judge")

    assert definition.name == "judge"
    assert definition.version == "1.0.0"
```

- [x] **Step 1.6：实现 NovelSkillRunner.definition_for() 并验证**

```powershell
cd D:\StoryForge\apps\workflow
uv run pytest tests/test_novel_skill_runner.py -v
```

Expected: `test_novel_skill_runner.py` 全部通过。

---

### Task 2：让 Runner 包装 NovelLoopPorts 调用

**目标：** Skill Runner 能包装 `generate`、`judge`、`repair`、`approve`、`memory_extract` 五个单章技能端口，并产出 `NovelSkillRun` 列表。

**Files:**
- Modify: `D:\StoryForge\apps\workflow\storyforge_workflow\skills\runner.py`
- Modify: `D:\StoryForge\apps\workflow\tests\test_novel_skill_runner.py`
- Reference: `D:\StoryForge\apps\workflow\storyforge_workflow\orchestrators\novel_loop.py`

- [x] **Step 2.1：写失败测试：generate 包装记录 model_run_id**

```python
from storyforge_workflow.orchestrators.novel_loop import NovelLoopRequest
from storyforge_workflow.skills.runner import NovelSkillRunner


def test_runner_records_generate_skill_run() -> None:
    runner = NovelSkillRunner.default()
    request = NovelLoopRequest(book_id=1, chapter_id=2, chapter_index=3, chapter_goal="揭示灯塔异常")

    draft, model_run_id = runner.run_generate(
        request=request,
        context_id="ctx-1",
        generate_scene=lambda req, context_id: "林岚推开灯塔铁门。",
        record_model_run=lambda req, draft: 99,
    )

    assert draft == "林岚推开灯塔铁门。"
    assert model_run_id == 99
    assert runner.runs[-1].skill_name == "generate"
    assert runner.runs[-1].output_refs["model_run_id"] == 99
    assert "draft_hash" in runner.runs[-1].output_refs
```

- [x] **Step 2.2：写失败测试：judge/repair/approve/memory_extract 顺序记录**

测试应断言：

- judge run 保存 `judge_report_id`、`repair_patch_id`、`decision`。
- repair run 保存 `source_judge_report_id`、`attempt`、`repair_patch_id`。
- approve run 保存 `approved_scene_id`、`source_model_run_id`、`judge_report_id`。
- memory_extract 返回空列表时状态为 `memory_extract_skipped`，非空时为 `memory_updated`。

- [x] **Step 2.3：运行红灯测试**

```powershell
cd D:\StoryForge\apps\workflow
uv run pytest tests/test_novel_skill_runner.py -v
```

Expected: 新增 runner 方法不存在导致失败。

- [x] **Step 2.4：实现 runner 包装方法**

在 `NovelSkillRunner` 中实现：

```python
class NovelSkillRunner:
    def run_generate(...): ...
    def run_judge(...): ...
    def run_repair(...): ...
    def run_approve(...): ...
    def run_memory_extract(...): ...
```

实现约束：

- `run_generate()` 调用 `generate_scene()` 后再调用 `record_model_run()`。
- `run_judge()` 不吞异常；异常由调用方决定是否转人工审查。
- `run_repair()` 只记录修复尝试，不自行制造 NovelLoop 终态。
- `run_approve()` 只能在上层确认 judge pass 后调用。
- `run_memory_extract()` 返回空列表时记录 `memory_extract_skipped`。

- [x] **Step 2.5：运行绿灯测试**

```powershell
cd D:\StoryForge\apps\workflow
uv run pytest tests/test_novel_skill_runner.py -v
```

Expected: 全部通过。

---

### Task 3：NovelLoop 接入 Skill Runner 并保持结果等价

**目标：** `run_single_chapter_loop()` 可通过 runner 包装现有端口，同时返回值与接入前一致。

**Files:**
- Modify: `D:\StoryForge\apps\workflow\storyforge_workflow\orchestrators\novel_loop.py`
- Create: `D:\StoryForge\apps\workflow\tests\test_novel_loop_skill_runner_integration.py`
- Reference: `D:\StoryForge\apps\workflow\tests\test_novel_loop_single_chapter.py`

- [x] **Step 3.1：写失败测试：approved 路径结果等价且记录技能链**

```python
from storyforge_workflow.orchestrators.novel_loop import NovelLoopPorts, NovelLoopRequest, run_single_chapter_loop
from storyforge_workflow.skills.runner import NovelSkillRunner


def test_novel_loop_with_skill_runner_keeps_approved_result_contract() -> None:
    runner = NovelSkillRunner.default()
    ports = NovelLoopPorts(
        compile_context=lambda request: "ctx-1",
        generate_scene=lambda request, context_id: "林岚抵达雾港。",
        record_model_run=lambda request, draft: 31,
        judge_scene=lambda draft, attempt: {"status": "pass", "judge_report_id": 41},
        repair_scene=lambda draft, report, attempt: draft,
        approve_scene=lambda request, draft, refs: 51,
        extract_memory=lambda request, draft, approved_scene_id: ["mem-1"],
    )

    result = run_single_chapter_loop(
        NovelLoopRequest(book_id=1, chapter_id=2, chapter_index=1, chapter_goal="开场"),
        ports,
        max_repairs=1,
        skill_runner=runner,
    )

    assert result.status == "approved"
    assert result.source_model_run_id == 31
    assert result.judge_report_id == 41
    assert result.approved_scene_id == 51
    assert [run.skill_name for run in runner.runs] == ["generate", "judge", "approve", "memory_extract"]
```

- [x] **Step 3.2：写失败测试：repair 路径记录 generate/judge/repair/judge/approve**

断言首次 judge 返回 `repair` 后进入 repair，再次 judge pass 后 approve；最终 `NovelLoopResult.status == "approved"`。

- [x] **Step 3.3：写失败测试：高危静态质量门不进入 judge**

断言 high severity 静态问题时：

- result.status == `awaiting_review`
- runner 记录 `generate`
- 不记录 `approve`
- 可记录 `judge` 的 `static_gate_blocked` 或专门的静态门记录，具体以实现选择为准，但不能调用 `judge_scene`

- [x] **Step 3.4：运行红灯测试**

```powershell
cd D:\StoryForge\apps\workflow
uv run pytest tests/test_novel_loop_skill_runner_integration.py -v
```

Expected: `run_single_chapter_loop()` 不支持 `skill_runner` 参数或未记录技能链。

- [x] **Step 3.5：最小接入 NovelLoop**

修改 `run_single_chapter_loop()` 签名：

```python
def run_single_chapter_loop(
    request: NovelLoopRequest,
    ports: NovelLoopPorts,
    *,
    max_repairs: int = 1,
    skill_runner: NovelSkillRunner | None = None,
) -> NovelLoopResult:
```

实现约束：

- `skill_runner is None` 时保持现有行为。
- `skill_runner` 存在时仅包装端口调用和记录，不改变分支判断。
- 所有现有测试无需修改语义。

- [x] **Step 3.6：运行 NovelLoop 与 BookLoop 回归**

```powershell
cd D:\StoryForge\apps\workflow
uv run pytest tests/test_novel_loop_skill_runner_integration.py tests/test_novel_loop_single_chapter.py tests/test_book_loop_three_chapters.py tests/test_provider_degradation_pause.py -v
```

Expected: 全部通过。

---

### Task 4：BookLoop / audit 派生使用真实 SkillRun 记录

**目标：** 让阶段一 `derive_skill_chain_summary()` 能消费 runner 产生的 `NovelSkillRun` 审计字典，同时继续支持仅从 progress 派生的旧路径。

**Files:**
- Modify: `D:\StoryForge\apps\workflow\storyforge_workflow\skills\audit.py`
- Modify: `D:\StoryForge\apps\workflow\tests\test_skill_audit_summary.py`

- [x] **Step 4.1：写失败测试：progress 中带 skill_runs 时优先使用真实记录**

```python
def test_skill_audit_summary_prefers_recorded_skill_runs() -> None:
    progress = {
        "completed_chapters": [
            {
                "chapter_index": 1,
                "status": "approved",
                "model_run_id": 31,
                "judge_report_id": 41,
                "approved_scene_id": 51,
                "skill_runs": [
                    {"skill_name": "generate", "status": "generated", "output_refs": {"model_run_id": 31}},
                    {"skill_name": "judge", "status": "pass", "output_refs": {"judge_report_id": 41}},
                    {"skill_name": "approve", "status": "approved", "output_refs": {"approved_scene_id": 51}},
                ],
            }
        ],
        "checkpoint": [],
        "budget": {},
    }

    summary = derive_skill_chain_summary(progress)

    assert summary["chapters"][0]["skills"][0]["skill_name"] == "generate"
    assert summary["chapters"][0]["skills"][1]["skill_name"] == "judge"
    assert summary["chapters"][0]["skills"][2]["skill_name"] == "approve"
```

- [x] **Step 4.2：写失败测试：无 skill_runs 时保持阶段一派生行为**

使用阶段一已有 progress fixture，断言输出不变。

- [x] **Step 4.3：实现兼容派生**

规则：

- 有 `skill_runs` 时，先使用记录内技能顺序。
- 缺少 `skill_runs` 时，继续使用 model_run_id / judge_report_id / approved_scene_id 派生。
- 始终不修改输入 progress。

- [x] **Step 4.4：验证**

```powershell
cd D:\StoryForge\apps\workflow
uv run pytest tests/test_skill_audit_summary.py tests/test_novel_skill_runner.py -v
```

Expected: 全部通过。

---

### Task 5：API audit_report.json 追加 skill_chain

**目标：** BookRun 导出的 `audit_report.json` 包含技能链摘要，且缺少技能数据时仍兼容旧报告。

**Files:**
- Modify: `D:\StoryForge\apps\api\app\domains\book_runs\schemas.py`
- Modify: `D:\StoryForge\apps\api\app\domains\book_runs\service.py`
- Modify or Create: `D:\StoryForge\apps\api\tests\test_book_runs.py`

- [x] **Step 5.1：定位 audit_report 测试与生成函数**

```powershell
cd D:\StoryForge
Select-String -Path apps\api\**\*.py -Pattern "audit_report","book.md","artifacts" -CaseSensitive:$false
```

记录实际文件与函数到 `.codex\operations-log.md`。

- [x] **Step 5.2：写失败测试：audit_report 包含 skill_chain**

测试断言导出报告至少包含：

```json
{
  "skill_chain_version": "bookrun-default-v1",
  "chapters": [
    {
      "chapter_index": 1,
      "skills": [
        {"skill_name": "generate", "status": "generated"},
        {"skill_name": "judge", "status": "pass"},
        {"skill_name": "approve", "status": "approved"}
      ]
    }
  ]
}
```

- [x] **Step 5.3：写失败测试：旧 progress 无 skill_chain 时输出空摘要而不报错**

断言旧报告仍包含原字段，并追加：

```json
{
  "skill_chain_version": "bookrun-default-v1",
  "chapters": []
}
```

或按阶段一派生规则从 `completed_chapters` 生成摘要。

- [x] **Step 5.4：运行红灯测试**

```powershell
cd D:\StoryForge\apps\api
uv run pytest -k "audit_report or book_run" -v
```

Expected: 新增 skill_chain 断言失败。

- [x] **Step 5.5：实现 schema/service 追加逻辑**

约束：

- 只追加 `skill_chain` 字段，不删除旧字段。
- 不在 API 层重新解释 NovelLoop 状态；状态映射来自 workflow 的审计摘要结构。
- 无数据时空数组退化，不伪造 ID。

- [x] **Step 5.6：运行 API 验证**

```powershell
cd D:\StoryForge\apps\api
uv run pytest -k "audit_report or book_run" -v
uv run pytest -v
```

Expected: 全部通过。

---

### Task 6：Web 审计页展示技能链

**目标：** 在 BookRun 审计页展示每章技能链，让用户能看到 generate → judge → repair → approve → memory_extract → export 的审计路径。

**Files:**
- Modify: `D:\StoryForge\apps\web\app\book-runs\[id]\audit\...`
- Modify or Create: `D:\StoryForge\apps\web\tests\...`

- [x] **Step 6.1：定位审计页组件与测试**

```powershell
cd D:\StoryForge
Get-ChildItem -Path apps\web -Recurse -File | Select-String -Pattern "audit_report","skill_chain","BookRun","audit" -CaseSensitive:$false
```

记录页面入口、数据读取函数、测试文件到 `operations-log.md`。

- [x] **Step 6.2：写失败测试：有 skill_chain 时渲染技能链**

mock API 返回：

```json
{
  "skill_chain": {
    "skill_chain_version": "bookrun-default-v1",
    "chapters": [
      {
        "chapter_index": 1,
        "skills": [
          {"skill_name": "generate", "status": "generated", "model_run_id": 31},
          {"skill_name": "judge", "status": "pass", "judge_report_id": 41},
          {"skill_name": "approve", "status": "approved", "approved_scene_id": 51}
        ]
      }
    ]
  }
}
```

断言页面显示：

- `技能链`
- `generate`
- `judge`
- `approve`
- `model_run_id` 或对应中文标签
- `judge_report_id` 或对应中文标签

- [x] **Step 6.3：写失败测试：无 skill_chain 时显示空状态**

断言显示：`暂无技能链审计数据`，页面不崩溃。

- [x] **Step 6.4：实现 UI 展示**

约束：

- 沿用现有审计页视觉风格，不引入新 UI 库。
- 技能状态使用只读标签展示，不提供未实现操作按钮。
- repair 缺失时不显示虚假 repair 节点。

- [x] **Step 6.5：运行 Web 验证**

```powershell
cd D:\StoryForge
pnpm run test:web
```

Expected: 通过。

---

### Task 7：题材技能包显式选择

**目标：** 在通用技能链稳定后，增加题材技能包元数据与显式选择能力，不改变默认 BookRun 行为。

**Files:**
- Create: `D:\StoryForge\apps\workflow\storyforge_workflow\skills\genre_mystery\clue_fairness_judge\SKILL.md`
- Create: `D:\StoryForge\apps\workflow\storyforge_workflow\skills\genre_xuanhuan\power_scale_guard\SKILL.md`
- Create: `D:\StoryForge\apps\workflow\storyforge_workflow\skills\genre_romance\relationship_arc_judge\SKILL.md`
- Modify: `D:\StoryForge\apps\workflow\storyforge_workflow\skills\definitions.py`
- Create: `D:\StoryForge\apps\workflow\tests\test_genre_skill_registry.py`

- [x] **Step 7.1：写失败测试：默认 registry 不包含题材技能**

```python
from storyforge_workflow.skills.definitions import NovelSkillRegistry


def test_default_registry_does_not_load_genre_skills() -> None:
    registry = NovelSkillRegistry.default()

    assert "clue_fairness_judge" not in registry.names()
    assert "power_scale_guard" not in registry.names()
    assert "relationship_arc_judge" not in registry.names()
```

- [x] **Step 7.2：写失败测试：显式选择 mystery 加载线索公平性技能**

```python
def test_registry_loads_mystery_pack_explicitly() -> None:
    registry = NovelSkillRegistry.with_genre_pack("mystery")

    assert "clue_fairness_judge" in registry.names()
    assert registry.get("clue_fairness_judge").version == "1.0.0"
```

- [x] **Step 7.3：实现题材 registry 选择接口**

约束：

- `with_genre_pack("mystery")` 只加载 mystery 包。
- 未知 genre 抛出 `KeyError` 或 `ValueError`，错误信息包含 genre 名称。
- 题材技能 `allowed_statuses` 只能使用技能阶段态，不新增 BookLoop 终态。

- [x] **Step 7.4：新增三个题材 SKILL.md**

每个文件包含：

```markdown
---
name: clue_fairness_judge
version: 1.0.0
description: 检查悬疑章节是否公平埋设线索、误导与揭示。
genre: mystery
---

## 触发条件

## 输入契约

## 输出契约

## 硬门禁

## 审计字段

## 下一步
```

- [x] **Step 7.5：运行题材技能测试**

```powershell
cd D:\StoryForge\apps\workflow
uv run pytest tests/test_genre_skill_registry.py tests/test_novel_skill_registry.py -v
```

Expected: 全部通过。

---

### Task 8：端到端本地总验证与报告

**目标：** 运行 workflow、api、web 和根级验证，生成最终审查报告。

**Files:**
- Modify: `D:\StoryForge\.codex\verification-report.md`
- Modify: `D:\StoryForge\.codex\operations-log.md`

- [x] **Step 8.1：运行 workflow 全量测试**

```powershell
cd D:\StoryForge\apps\workflow
uv run pytest -v
```

Expected: 全部通过。

- [x] **Step 8.2：运行 API 全量测试**

```powershell
cd D:\StoryForge\apps\api
uv run pytest -v
```

Expected: 全部通过。

- [x] **Step 8.3：运行 Web 与 shared 测试**

```powershell
cd D:\StoryForge
pnpm run test:web
```

Expected: 全部通过。

- [x] **Step 8.4：运行根级总测试**

```powershell
cd D:\StoryForge
pnpm test
```

Expected: 全部通过。

- [x] **Step 8.5：运行本地总门禁**

```powershell
cd D:\StoryForge
pnpm verify
```

Expected: 通过。

- [x] **Step 8.6：生成验证报告**

在 `verification-report.md` 写入：

```markdown
# Novel Skill Framework 后续阶段验证报告

生成时间：YYYY-MM-DD HH:mm:ss

## 验证命令

- apps/workflow: uv run pytest -v → 通过
- apps/api: uv run pytest -v → 通过
- web/shared: pnpm run test:web → 通过
- root: pnpm test → 通过
- root verify: pnpm verify → 通过

## 评分

- 代码质量：__ / 100
- 测试覆盖：__ / 100
- 规范遵循：__ / 100
- 需求匹配：__ / 100
- 架构一致：__ / 100
- 风险评估：__ / 100

综合评分：__ / 100
建议：通过
```

评分必须基于真实本地命令结果。低于 90 分不得建议通过。

---

## 四、阶段交付顺序

### 第二阶段：Skill Runner 适配

- [x] Task 0：后续阶段基线核验
- [x] Task 1：新增 NovelSkillRun 数据模型与 Runner 单元测试
- [x] Task 2：让 Runner 包装 NovelLoopPorts 调用
- [x] Task 3：NovelLoop 接入 Skill Runner 并保持结果等价
- [x] Task 4：BookLoop / audit 派生使用真实 SkillRun 记录

阶段验收命令：

```powershell
cd D:\StoryForge\apps\workflow
uv run pytest tests/test_novel_skill_runner.py tests/test_novel_loop_skill_runner_integration.py tests/test_skill_audit_summary.py tests/test_novel_loop_single_chapter.py tests/test_book_loop_three_chapters.py tests/test_provider_degradation_pause.py -v
```

### 第三阶段：审计报告与前端展示

- [x] Task 5：API audit_report.json 追加 skill_chain
- [x] Task 6：Web 审计页展示技能链

阶段验收命令：

```powershell
cd D:\StoryForge\apps\api
uv run pytest -v

cd D:\StoryForge
pnpm run test:web
```

### 第四阶段：题材技能包扩展

- [x] Task 7：题材技能包显式选择

阶段验收命令：

```powershell
cd D:\StoryForge\apps\workflow
uv run pytest tests/test_genre_skill_registry.py tests/test_novel_skill_registry.py -v
```

### 第五阶段：总验证与交付

- [x] Task 8：端到端本地总验证与报告

最终验收命令：

```powershell
cd D:\StoryForge
pnpm test
pnpm verify
```

---

## 五、回滚策略

### 5.1 阶段二回滚

- 删除 `apps/workflow/storyforge_workflow/skills/runner.py`。
- 删除 `apps/workflow/tests/test_novel_skill_runner.py` 与 `test_novel_loop_skill_runner_integration.py`。
- 从 `novel_loop.py` 移除 `skill_runner` 可选参数与包装调用。
- 验证：

```powershell
cd D:\StoryForge\apps\workflow
uv run pytest tests/test_novel_loop_single_chapter.py tests/test_book_loop_three_chapters.py tests/test_provider_degradation_pause.py -v
```

### 5.2 阶段三回滚

- 从 API 审计报告移除 `skill_chain` 追加逻辑。
- 从 Web 审计页移除技能链展示组件。
- 保留 workflow 阶段二能力不动。
- 验证：

```powershell
cd D:\StoryForge\apps\api
uv run pytest -v

cd D:\StoryForge
pnpm run test:web
```

### 5.3 阶段四回滚

- 删除 `genre_*` 技能包目录。
- 删除 `test_genre_skill_registry.py`。
- 从 registry 移除 `with_genre_pack()` 或恢复到只支持默认技能链。
- 验证：

```powershell
cd D:\StoryForge\apps\workflow
uv run pytest tests/test_novel_skill_registry.py tests/test_novel_loop_single_chapter.py -v
```

---

## 六、完成定义

全部条件满足后，才能声明后续总阶段完成：

- [x] 第一阶段基线文件与测试在当前工作区通过。
- [x] `NovelSkillRun` 与 `NovelSkillRunner` 能记录引用化技能运行记录。
- [x] `run_single_chapter_loop()` 接入 runner 后保持 `NovelLoopResult` 对外契约等价。
- [x] `derive_skill_chain_summary()` 能消费真实 `skill_runs`，也兼容阶段一 progress 派生。
- [x] `audit_report.json` 追加 `skill_chain`，且旧数据可空退化。
- [x] Web 审计页能展示技能链，无数据时显示明确空状态。
- [x] 题材技能包只能显式选择，默认 BookRun 不加载题材扩展。
- [x] `apps/workflow` 全量 pytest 通过。
- [x] `apps/api` 全量 pytest 通过。
- [x] `pnpm run test:web` 通过。
- [x] `pnpm test` 通过。
- [x] `pnpm verify` 通过。
- [x] `.codex/verification-report.md` 综合评分 ≥ 90，建议为“通过”。

---

## 七、自审结论

- **需求覆盖：** 已覆盖第一阶段之后的 Skill Runner、审计报告、Web 展示、题材技能包、总验证与回滚。
- **架构一致：** 计划明确复用 NovelLoop / BookLoop / NovelLoopPorts，不新增第二套编排器。
- **测试优先：** 每个实现任务均先写失败测试，再实现，再运行本地验证。
- **风险控制：** 对第一阶段基线缺失、状态虚构、checkpoint 膨胀、题材技能污染默认链路均给出约束。
- **执行结论：** Task 0 到 Task 8 已完成，当前工作区第一阶段到后续总阶段均已通过本地验证；真实 LLM 长篇发布门禁作为后续独立事项保留。
