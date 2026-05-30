# 小说质量提升总实施计划

> **给执行代理的要求：** 按任务逐项执行，推荐使用 `superpowers:subagent-driven-development`；如需在当前会话内执行，则使用 `superpowers:executing-plans`。所有步骤使用复选框跟踪，所有验证必须在本地完成并记录到 `D:\StoryForge\1-renovel-ai-ai-rag-tavern\.codex\verification-report.md`。

**目标：** 在不推翻现有 StoryForge BookRun / NovelLoop / Prompt Builder 架构的前提下，补齐小说质量评分、静态坏味道检查、生成前场景质量计划、分级修订、黄金样例回归和整书质量审计，让生成小说更连贯、更少说明腔、更能维持人物与风格一致性。

**架构：** 沿用现有 `NarrativeContext -> build_draft_prompt -> NovelLoop Judge/Repair/Approve -> BookLoop` 主链路。新增质量能力以独立模块和 dataclass 注入，不让静态检查、LLM Judge、审计展示互相耦合。所有新增能力必须能在缺少真实 LLM 时通过 deterministic pytest 验证。

**技术栈：** Python 3.13、pytest、dataclass、现有 workflow prompt 模块、现有 API BookRun 域服务、现有 Next.js 审计页面、pnpm/uv 本地验证链路。

---

## 一、文件职责总览

### 新增文件

- `D:\StoryForge\1-renovel-ai-ai-rag-tavern\apps\workflow\storyforge_workflow\quality\__init__.py`
  - 导出质量检查公共模型与函数。
- `D:\StoryForge\1-renovel-ai-ai-rag-tavern\apps\workflow\storyforge_workflow\quality\prose_static_check.py`
  - 本地 deterministic 小说坏味道检查：套话、说明腔、抽象情绪、句长、对白密度、重复表达。
- `D:\StoryForge\1-renovel-ai-ai-rag-tavern\apps\workflow\tests\test_prose_static_check.py`
  - 覆盖静态检查的正常、边界与坏样例。
- `D:\StoryForge\1-renovel-ai-ai-rag-tavern\tests\fixtures\quality_cases\good_scene_01.json`
  - 好正文回归样例。
- `D:\StoryForge\1-renovel-ai-ai-rag-tavern\tests\fixtures\quality_cases\bad_telling_01.json`
  - 说明腔坏样例。
- `D:\StoryForge\1-renovel-ai-ai-rag-tavern\tests\fixtures\quality_cases\bad_ooc_01.json`
  - 角色偏移坏样例。
- `D:\StoryForge\1-renovel-ai-ai-rag-tavern\tests\fixtures\quality_cases\bad_continuity_01.json`
  - 连续性矛盾坏样例。
- `D:\StoryForge\1-renovel-ai-ai-rag-tavern\tests\fixtures\quality_cases\bad_pacing_01.json`
  - 节奏塌陷坏样例。

### 修改文件

- `D:\StoryForge\1-renovel-ai-ai-rag-tavern\apps\workflow\storyforge_workflow\prompts\models.py`
  - 增加 `SceneQualityPlan`、`QualityScore`、`QualityIssue`、`QualityReport` 等结构化模型。
- `D:\StoryForge\1-renovel-ai-ai-rag-tavern\apps\workflow\storyforge_workflow\prompts\context.py`
  - 从 state 映射 `scene_quality_plan` 和质量阈值相关注入键。
- `D:\StoryForge\1-renovel-ai-ai-rag-tavern\apps\workflow\storyforge_workflow\prompts\builder.py`
  - 将场景质量计划注入 draft / critique / revision prompt，并增强结构化评分与分级修订契约。
- `D:\StoryForge\1-renovel-ai-ai-rag-tavern\apps\workflow\storyforge_workflow\orchestrators\novel_loop.py`
  - 在 Judge 前接入静态检查结果；根据质量严重级别选择轻修、场景补丁、重写或人工审查。
- `D:\StoryForge\1-renovel-ai-ai-rag-tavern\apps\workflow\tests\test_prompt_builder.py`
  - 覆盖新 prompt 分层、评分契约、修订契约。
- `D:\StoryForge\1-renovel-ai-ai-rag-tavern\apps\workflow\tests\test_novel_loop_single_chapter.py`
  - 覆盖静态质量问题进入 Repair、严重问题进入 awaiting_review、修订通过等路径。
- `D:\StoryForge\1-renovel-ai-ai-rag-tavern\apps\api\app\domains\book_runs\schemas.py`
  - 扩展审计报告质量摘要 schema。
- `D:\StoryForge\1-renovel-ai-ai-rag-tavern\apps\api\app\domains\book_runs\service.py`
  - 导出 BookRun 级质量摘要到 `audit_report.json`。
- `D:\StoryForge\1-renovel-ai-ai-rag-tavern\apps\api\tests\...`
  - 增加或扩展 BookRun 审计报告测试，具体测试文件以现有 BookRun 测试命名为准。
- `D:\StoryForge\1-renovel-ai-ai-rag-tavern\apps\web\app\book-runs\[id]\audit\...`
  - 展示质量摘要、章节分数、主要问题和人工审查建议。
- `D:\StoryForge\1-renovel-ai-ai-rag-tavern\.codex\operations-log.md`
  - 记录每个阶段的上下文、决策、验证与失败补救。
- `D:\StoryForge\1-renovel-ai-ai-rag-tavern\.codex\verification-report.md`
  - 记录最终本地验证、质量评分和交付结论。

---

## 二、总任务清单

### Task 0：任务准备与上下文留痕

**目标：** 在编码前补齐上下文摘要、操作日志和验收边界，防止无证据直接改代码。

**文件：**
- 创建或更新：`D:\StoryForge\1-renovel-ai-ai-rag-tavern\.codex\context-summary-novel-quality-total.md`
- 修改：`D:\StoryForge\1-renovel-ai-ai-rag-tavern\.codex\operations-log.md`

- [ ] **Step 0.1：记录已分析的相似实现**
  - 记录以下文件的职责和复用点：
    - `D:\StoryForge\1-renovel-ai-ai-rag-tavern\apps\workflow\storyforge_workflow\prompts\builder.py`
    - `D:\StoryForge\1-renovel-ai-ai-rag-tavern\apps\workflow\storyforge_workflow\prompts\models.py`
    - `D:\StoryForge\1-renovel-ai-ai-rag-tavern\apps\workflow\storyforge_workflow\prompts\context.py`
    - `D:\StoryForge\1-renovel-ai-ai-rag-tavern\apps\workflow\storyforge_workflow\orchestrators\novel_loop.py`
    - `D:\StoryForge\1-renovel-ai-ai-rag-tavern\apps\workflow\storyforge_workflow\orchestrators\book_loop.py`
    - `D:\StoryForge\1-renovel-ai-ai-rag-tavern\apps\workflow\tests\test_prompt_builder.py`
    - `D:\StoryForge\1-renovel-ai-ai-rag-tavern\apps\workflow\tests\test_novel_loop_single_chapter.py`

- [ ] **Step 0.2：记录编码前检查**
  - 在 `D:\StoryForge\1-renovel-ai-ai-rag-tavern\.codex\operations-log.md` 写入：
    - 将复用 `NarrativeContext`、`StyleDirective`、`PacingDirective`、`NovelLoopPorts`、`NovelLoopResult`。
    - 将遵循 frozen dataclass、纯函数 prompt builder、pytest 断言字符串契约的现有模式。
    - 不新增真实 LLM 依赖作为本地测试前置条件。

- [ ] **Step 0.3：确认验证入口**
  - 快速验证命令：
    ```powershell
    cd D:\StoryForge\1-renovel-ai-ai-rag-tavern\apps\workflow
    uv run pytest tests/test_prompt_builder.py -v
    uv run pytest tests/test_novel_loop_single_chapter.py -v
    ```
  - 全量验证命令：
    ```powershell
    cd D:\StoryForge\1-renovel-ai-ai-rag-tavern
    pnpm test
    pnpm verify
    ```

---

### Task 1：新增质量数据模型

**目标：** 为质量评分、问题列表、修订策略和场景质量计划建立稳定类型，供 prompt、静态检查、NovelLoop 和审计报告复用。

**文件：**
- 修改：`D:\StoryForge\1-renovel-ai-ai-rag-tavern\apps\workflow\storyforge_workflow\prompts\models.py`
- 测试：`D:\StoryForge\1-renovel-ai-ai-rag-tavern\apps\workflow\tests\test_prompt_builder.py`

- [ ] **Step 1.1：先写模型渲染测试**
  - 在 `test_prompt_builder.py` 中新增测试，断言 `SceneQualityPlan` 能被 draft prompt 渲染出：
    - 情绪变化
    - 冲突转折
    - 感官锚点
    - 对白目的
    - 伏笔兑现
    - 结尾钩子

- [ ] **Step 1.2：运行红灯测试**
  ```powershell
  cd D:\StoryForge\1-renovel-ai-ai-rag-tavern\apps\workflow
  uv run pytest tests/test_prompt_builder.py::test_draft_prompt_injects_scene_quality_plan -v
  ```
  - 预期：失败，提示 `SceneQualityPlan` 或相关字段不存在。

- [ ] **Step 1.3：实现 dataclass**
  - 在 `models.py` 新增：
    - `SceneQualityPlan`
    - `QualityScore`
    - `QualityIssue`
    - `QualityReport`
    - `RevisionStrategy`
  - 约束：
    - 使用 frozen dataclass。
    - 默认值必须允许空数据退化。
    - 注释说明意图，而不是重复字段名。

- [ ] **Step 1.4：运行绿灯测试**
  ```powershell
  cd D:\StoryForge\1-renovel-ai-ai-rag-tavern\apps\workflow
  uv run pytest tests/test_prompt_builder.py::test_draft_prompt_injects_scene_quality_plan -v
  ```
  - 预期：通过。

- [ ] **Step 1.5：提交阶段记录**
  - 在 `operations-log.md` 记录复用模式、测试命令和结果。

---

### Task 2：扩展 context state 映射

**目标：** 让 API 或上游编排能通过 state 注入 `scene_quality_plan`，并由 `narrative_context_from_state()` 转成结构化上下文。

**文件：**
- 修改：`D:\StoryForge\1-renovel-ai-ai-rag-tavern\apps\workflow\storyforge_workflow\prompts\context.py`
- 测试：`D:\StoryForge\1-renovel-ai-ai-rag-tavern\apps\workflow\tests\test_prompt_builder.py`

- [ ] **Step 2.1：先写 state 映射测试**
  - 新增 `test_context_from_state_maps_scene_quality_plan()`。
  - 输入 state：
    ```python
    {
        "scene_quality_plan": {
            "emotional_shift": "林岚从克制到被迫暴露旧伤。",
            "conflict_turn": "港口代表临时抬高维修代价。",
            "sensory_anchors": ["潮湿铁锈味", "灯塔电流声"],
            "dialogue_purpose": "让代表用报价逼出林岚的底线。",
            "reveal_or_payoff": "兑现左臂旧伤伏笔。",
            "ending_hook": "灯塔信号突然中断。"
        }
    }
    ```
  - 断言 `ctx.scene_quality_plan` 字段完整。

- [ ] **Step 2.2：运行红灯测试**
  ```powershell
  cd D:\StoryForge\1-renovel-ai-ai-rag-tavern\apps\workflow
  uv run pytest tests/test_prompt_builder.py::test_context_from_state_maps_scene_quality_plan -v
  ```

- [ ] **Step 2.3：实现 `_scene_quality_plan_from_state()`**
  - 使用现有 `_str()`、`_str_list()` 模式。
  - 缺字段时返回空 `SceneQualityPlan()`。
  - 非 dict 输入时安全退化为空计划。

- [ ] **Step 2.4：运行绿灯测试**
  ```powershell
  cd D:\StoryForge\1-renovel-ai-ai-rag-tavern\apps\workflow
  uv run pytest tests/test_prompt_builder.py::test_context_from_state_maps_scene_quality_plan -v
  ```

---

### Task 3：Draft Prompt 注入生成前质量计划

**目标：** 让正文生成前明确知道本场景的情绪变化、冲突转折、感官锚点、对白目的和结尾钩子，从源头减少大纲腔和平铺。

**文件：**
- 修改：`D:\StoryForge\1-renovel-ai-ai-rag-tavern\apps\workflow\storyforge_workflow\prompts\builder.py`
- 测试：`D:\StoryForge\1-renovel-ai-ai-rag-tavern\apps\workflow\tests\test_prompt_builder.py`

- [ ] **Step 3.1：新增 prompt 注入测试**
  - 测试 `build_draft_prompt(_full_context())` 包含：
    - `【场景质量计划】`
    - `情绪变化：...`
    - `冲突转折：...`
    - `感官锚点：...`
    - `对白目的：...`
    - `伏笔/兑现：...`
    - `结尾钩子：...`

- [ ] **Step 3.2：运行红灯测试**
  ```powershell
  cd D:\StoryForge\1-renovel-ai-ai-rag-tavern\apps\workflow
  uv run pytest tests/test_prompt_builder.py::test_draft_prompt_injects_scene_quality_plan -v
  ```

- [ ] **Step 3.3：实现 `_scene_quality_section()`**
  - 遵循现有 `_section()` 和 `_clean()` 模式。
  - 空计划不渲染标题。
  - 在 `build_draft_prompt()` 中放在 `叙事位置` 之后、`连续性约束` 之前。

- [ ] **Step 3.4：运行相关测试**
  ```powershell
  cd D:\StoryForge\1-renovel-ai-ai-rag-tavern\apps\workflow
  uv run pytest tests/test_prompt_builder.py -v
  ```

---

### Task 4：新增本地静态小说质量检查模块

**目标：** 在不调用真实 LLM 的情况下，先抓明显坏味道，为 Judge/Repair 提供 deterministic issue。

**文件：**
- 创建：`D:\StoryForge\1-renovel-ai-ai-rag-tavern\apps\workflow\storyforge_workflow\quality\__init__.py`
- 创建：`D:\StoryForge\1-renovel-ai-ai-rag-tavern\apps\workflow\storyforge_workflow\quality\prose_static_check.py`
- 创建：`D:\StoryForge\1-renovel-ai-ai-rag-tavern\apps\workflow\tests\test_prose_static_check.py`

- [ ] **Step 4.1：先写套话检测测试**
  - 输入包含 `不禁`、`五味杂陈`、`心中一震` 的正文。
  - 断言返回 `dimension == "套话"` 的 issue。

- [ ] **Step 4.2：先写说明腔检测测试**
  - 输入：`林岚很愤怒，也很害怕，她不知道该怎么办。`
  - 断言返回 `dimension == "说明腔"` 或 `dimension == "情绪直述"`。

- [ ] **Step 4.3：先写对白密度测试**
  - 全旁白长文本应返回对白不足提示。
  - 全对白文本应返回叙述不足提示。

- [ ] **Step 4.4：运行红灯测试**
  ```powershell
  cd D:\StoryForge\1-renovel-ai-ai-rag-tavern\apps\workflow
  uv run pytest tests/test_prose_static_check.py -v
  ```

- [ ] **Step 4.5：实现 `StaticProseIssue` 和 `check_prose_static_quality()`**
  - 输出字段：
    - `dimension`
    - `severity`
    - `snippet`
    - `message`
    - `suggestion`
    - `revision_strategy`
  - 检查项：
    - 套话密度
    - 抽象情绪直述
    - 解释性旁白
    - 对白密度异常
    - 句长异常
    - 短窗口重复表达

- [ ] **Step 4.6：运行绿灯测试**
  ```powershell
  cd D:\StoryForge\1-renovel-ai-ai-rag-tavern\apps\workflow
  uv run pytest tests/test_prose_static_check.py -v
  ```

---

### Task 5：Critique Prompt 改为结构化质量评分

**目标：** 让 LLM Judge 不只输出“通过/问题”，而是输出多维评分和可执行修订建议。

**文件：**
- 修改：`D:\StoryForge\1-renovel-ai-ai-rag-tavern\apps\workflow\storyforge_workflow\prompts\builder.py`
- 测试：`D:\StoryForge\1-renovel-ai-ai-rag-tavern\apps\workflow\tests\test_prompt_builder.py`

- [ ] **Step 5.1：新增 Critique 评分契约测试**
  - 断言 `build_critique_prompt()` 包含以下维度：
    - `prose_quality`
    - `show_dont_tell`
    - `character_consistency`
    - `continuity_consistency`
    - `scene_progression`
    - `pacing_control`
    - `hook_strength`
    - `ai_artifact_penalty`

- [ ] **Step 5.2：运行红灯测试**
  ```powershell
  cd D:\StoryForge\1-renovel-ai-ai-rag-tavern\apps\workflow
  uv run pytest tests/test_prompt_builder.py::test_critique_prompt_requests_structured_quality_scores -v
  ```

- [ ] **Step 5.3：修改 `build_critique_prompt()` 输出契约**
  - 要求输出：
    - `DECISION: pass|repair|regenerate|awaiting_review`
    - `SCORE: prose_quality=...; show_dont_tell=...; ...`
    - `ISSUE: 维度｜严重级别｜命中片段｜原因｜修订策略｜必须保留｜必须删除｜目标效果`
  - 保留“无问题时可通过”的语义，但不再只靠单行 `通过`。

- [ ] **Step 5.4：运行 prompt 测试**
  ```powershell
  cd D:\StoryForge\1-renovel-ai-ai-rag-tavern\apps\workflow
  uv run pytest tests/test_prompt_builder.py -v
  ```

---

### Task 6：Revision Prompt 支持分级修订策略

**目标：** 让 Repair 按 `line_edit`、`scene_patch`、`regenerate` 精确修订，避免泛泛润色。

**文件：**
- 修改：`D:\StoryForge\1-renovel-ai-ai-rag-tavern\apps\workflow\storyforge_workflow\prompts\builder.py`
- 测试：`D:\StoryForge\1-renovel-ai-ai-rag-tavern\apps\workflow\tests\test_prompt_builder.py`

- [ ] **Step 6.1：新增 Revision 策略测试**
  - 构造 issue：
    ```text
    文笔｜中｜她很害怕｜直接说明情绪｜line_edit｜她正在靠近门｜很害怕｜用动作和触觉呈现恐惧
    ```
  - 断言 prompt 包含：
    - `line_edit`
    - `scene_patch`
    - `regenerate`
    - `必须保留`
    - `必须删除`
    - `目标效果`

- [ ] **Step 6.2：运行红灯测试**
  ```powershell
  cd D:\StoryForge\1-renovel-ai-ai-rag-tavern\apps\workflow
  uv run pytest tests/test_prompt_builder.py::test_revision_prompt_supports_revision_strategy_contract -v
  ```

- [ ] **Step 6.3：增强 `build_revision_prompt()`**
  - 明确三种策略：
    - `line_edit`：只改命中句。
    - `scene_patch`：补足场景缺口但保留主体。
    - `regenerate`：整段重写但保留事实和连续性。
  - 输出仍只允许“修订后的完整正文”。

- [ ] **Step 6.4：运行测试**
  ```powershell
  cd D:\StoryForge\1-renovel-ai-ai-rag-tavern\apps\workflow
  uv run pytest tests/test_prompt_builder.py -v
  ```

---

### Task 7：NovelLoop 接入静态质量 issue

**目标：** 在 Judge 前先进行本地质量检查，把 deterministic issue 合并到评审输入或直接触发 Repair。

**文件：**
- 修改：`D:\StoryForge\1-renovel-ai-ai-rag-tavern\apps\workflow\storyforge_workflow\orchestrators\novel_loop.py`
- 测试：`D:\StoryForge\1-renovel-ai-ai-rag-tavern\apps\workflow\tests\test_novel_loop_single_chapter.py`

- [ ] **Step 7.1：扩展 `NovelLoopPorts` 测试用法**
  - 增加可选端口：`check_static_quality`。
  - 默认实现返回空列表，保证旧测试不需要全部改写。

- [ ] **Step 7.2：先写静态 issue 触发 repair 测试**
  - 生成草稿包含说明腔。
  - `check_static_quality` 返回中等级 issue。
  - `judge_scene` 返回 pass。
  - 预期仍先进入 `repair_scene`，再重新 judge 或 approve。

- [ ] **Step 7.3：先写严重 issue 进入 awaiting_review 测试**
  - `check_static_quality` 返回严重连续性或角色问题。
  - 预期结果 `status == "awaiting_review"`。

- [ ] **Step 7.4：运行红灯测试**
  ```powershell
  cd D:\StoryForge\1-renovel-ai-ai-rag-tavern\apps\workflow
  uv run pytest tests/test_novel_loop_single_chapter.py -v
  ```

- [ ] **Step 7.5：实现 NovelLoop 决策逻辑**
  - 无静态 issue：保持原有流程。
  - 中低严重级别：把 issue 放入 repair report，允许一次修订。
  - 高严重级别：返回 `awaiting_review`，并保留 `judge_report_id` / `repair_patch_id` 能力边界。
  - 不改变 `BookLoop` 对 `NovelLoopResult.status` 的判断契约。

- [ ] **Step 7.6：运行绿灯测试**
  ```powershell
  cd D:\StoryForge\1-renovel-ai-ai-rag-tavern\apps\workflow
  uv run pytest tests/test_novel_loop_single_chapter.py -v
  ```

---

### Task 8：新增黄金质量样例回归集

**目标：** 用固定输入验证质量检查和 prompt 契约，防止未来改 prompt 时质量能力退化。

**文件：**
- 创建目录：`D:\StoryForge\1-renovel-ai-ai-rag-tavern\tests\fixtures\quality_cases`
- 创建：`good_scene_01.json`
- 创建：`bad_telling_01.json`
- 创建：`bad_ooc_01.json`
- 创建：`bad_continuity_01.json`
- 创建：`bad_pacing_01.json`
- 修改或新增测试：`D:\StoryForge\1-renovel-ai-ai-rag-tavern\apps\workflow\tests\test_prose_static_check.py`

- [ ] **Step 8.1：创建好样例**
  - 好样例应包含动作、对白、感官细节、明确冲突推进。
  - 预期 `expected_decision == "pass"`。

- [ ] **Step 8.2：创建说明腔坏样例**
  - 包含明显抽象情绪直述。
  - 预期 issue 包含 `说明腔` 或 `情绪直述`。

- [ ] **Step 8.3：创建角色偏移坏样例**
  - 草稿违反 Character Bible 的 forbidden traits。
  - 预期 issue 包含 `角色一致性`。

- [ ] **Step 8.4：创建连续性坏样例**
  - 草稿与 required facts 或 continuity facts 矛盾。
  - 预期 issue 包含 `连续性`。

- [ ] **Step 8.5：创建节奏坏样例**
  - 草稿只有静态描写，没有行动 beat 或结尾钩子。
  - 预期 issue 包含 `节奏` 或 `推进`。

- [ ] **Step 8.6：实现 fixture 回归测试**
  - 测试读取所有 json。
  - 对静态检查可判定的 case 执行 `check_prose_static_quality()`。
  - 断言 expected issues 出现。

- [ ] **Step 8.7：运行回归测试**
  ```powershell
  cd D:\StoryForge\1-renovel-ai-ai-rag-tavern\apps\workflow
  uv run pytest tests/test_prose_static_check.py -v
  ```

---

### Task 9：BookRun 审计报告增加质量摘要

**目标：** 把单章质量结果汇总到整书审计报告，让长篇质量问题可追踪。

**文件：**
- 修改：`D:\StoryForge\1-renovel-ai-ai-rag-tavern\apps\api\app\domains\book_runs\schemas.py`
- 修改：`D:\StoryForge\1-renovel-ai-ai-rag-tavern\apps\api\app\domains\book_runs\service.py`
- 测试：`D:\StoryForge\1-renovel-ai-ai-rag-tavern\apps\api\tests\...`

- [ ] **Step 9.1：先找到现有 audit_report 测试**
  - 搜索 `audit_report`、`book.md`、`BookRun` 相关测试。
  - 记录实际测试文件路径到 `operations-log.md`。

- [ ] **Step 9.2：先写审计质量摘要测试**
  - 断言导出的 `audit_report.json` 包含：
    - `quality_summary`
    - `chapter_quality_scores`
    - `top_quality_issues`
    - `manual_review_recommendations`

- [ ] **Step 9.3：运行红灯测试**
  ```powershell
  cd D:\StoryForge\1-renovel-ai-ai-rag-tavern\apps\api
  uv run pytest -k "book_run and audit" -v
  ```

- [ ] **Step 9.4：扩展 schema 和 service 汇总逻辑**
  - 对缺少质量数据的旧运行输出空摘要。
  - 不改变原有 generate/judge/repair/approve 证据链字段。
  - 质量摘要只追加，不覆盖原审计结构。

- [ ] **Step 9.5：运行 API 测试**
  ```powershell
  cd D:\StoryForge\1-renovel-ai-ai-rag-tavern\apps\api
  uv run pytest -v
  ```

---

### Task 10：审计页展示质量摘要

**目标：** 在 BookRun 审计页面展示每章质量状态、主要问题和人工审查建议。

**文件：**
- 修改：`D:\StoryForge\1-renovel-ai-ai-rag-tavern\apps\web\app\book-runs\[id]\audit\...`
- 修改或新增测试：`D:\StoryForge\1-renovel-ai-ai-rag-tavern\apps\web\...`

- [ ] **Step 10.1：定位审计页组件和测试**
  - 搜索 `/book-runs/[id]/audit`。
  - 记录页面入口、数据读取函数、现有测试路径。

- [ ] **Step 10.2：先写页面渲染测试**
  - mock API 返回 `quality_summary`。
  - 断言页面显示：
    - 综合质量分
    - 每章分数
    - 主要问题
    - 人工审查建议

- [ ] **Step 10.3：运行红灯测试**
  ```powershell
  cd D:\StoryForge\1-renovel-ai-ai-rag-tavern
  pnpm --filter @storyforge/web test
  ```

- [ ] **Step 10.4：实现 UI 展示**
  - 遵循现有页面组件风格。
  - 无质量数据时显示“暂无质量摘要”，不能报错。
  - 不引入新 UI 库。

- [ ] **Step 10.5：运行 Web 测试**
  ```powershell
  cd D:\StoryForge\1-renovel-ai-ai-rag-tavern
  pnpm --filter @storyforge/web test
  ```

---

### Task 11：端到端本地验证与报告

**目标：** 用本地命令验证 workflow、api、web 与总门禁，并把证据写入审查报告。

**文件：**
- 修改：`D:\StoryForge\1-renovel-ai-ai-rag-tavern\.codex\verification-report.md`
- 修改：`D:\StoryForge\1-renovel-ai-ai-rag-tavern\.codex\operations-log.md`

- [ ] **Step 11.1：运行 workflow 测试**
  ```powershell
  cd D:\StoryForge\1-renovel-ai-ai-rag-tavern\apps\workflow
  uv run pytest -v
  ```
  - 预期：全部通过。

- [ ] **Step 11.2：运行 API 测试**
  ```powershell
  cd D:\StoryForge\1-renovel-ai-ai-rag-tavern\apps\api
  uv run pytest -v
  ```
  - 预期：全部通过。

- [ ] **Step 11.3：运行 Web 与 shared 测试**
  ```powershell
  cd D:\StoryForge\1-renovel-ai-ai-rag-tavern
  pnpm run test:web
  ```
  - 预期：全部通过。

- [ ] **Step 11.4：运行总测试**
  ```powershell
  cd D:\StoryForge\1-renovel-ai-ai-rag-tavern
  pnpm test
  ```
  - 预期：全部通过。

- [ ] **Step 11.5：运行本地总门禁**
  ```powershell
  cd D:\StoryForge\1-renovel-ai-ai-rag-tavern
  pnpm verify
  ```
  - 预期：通过。

- [ ] **Step 11.6：生成验证报告**
  - 在 `verification-report.md` 写入：
    - 需求完整性
    - 覆盖范围
    - 测试命令与结果
    - 未覆盖风险
    - 代码质量评分
    - 测试覆盖评分
    - 规范遵循评分
    - 战略一致评分
    - 综合评分与结论

---

## 三、阶段交付顺序

### 第一批：质量底座

- [ ] Task 0：任务准备与上下文留痕
- [ ] Task 1：新增质量数据模型
- [ ] Task 2：扩展 context state 映射
- [ ] Task 3：Draft Prompt 注入生成前质量计划

**阶段验收命令：**
```powershell
cd D:\StoryForge\1-renovel-ai-ai-rag-tavern\apps\workflow
uv run pytest tests/test_prompt_builder.py -v
```

### 第二批：坏味道检查与修订闭环

- [ ] Task 4：新增本地静态小说质量检查模块
- [ ] Task 5：Critique Prompt 改为结构化质量评分
- [ ] Task 6：Revision Prompt 支持分级修订策略
- [ ] Task 7：NovelLoop 接入静态质量 issue

**阶段验收命令：**
```powershell
cd D:\StoryForge\1-renovel-ai-ai-rag-tavern\apps\workflow
uv run pytest tests/test_prose_static_check.py -v
uv run pytest tests/test_prompt_builder.py -v
uv run pytest tests/test_novel_loop_single_chapter.py -v
```

### 第三批：回归样例与整书审计

- [ ] Task 8：新增黄金质量样例回归集
- [ ] Task 9：BookRun 审计报告增加质量摘要
- [ ] Task 10：审计页展示质量摘要

**阶段验收命令：**
```powershell
cd D:\StoryForge\1-renovel-ai-ai-rag-tavern
pnpm test
```

### 第四批：总验证与交付

- [ ] Task 11：端到端本地验证与报告

**最终验收命令：**
```powershell
cd D:\StoryForge\1-renovel-ai-ai-rag-tavern
pnpm test
pnpm verify
```

---

## 四、完成定义

全部条件满足才允许标记完成：

- [ ] `D:\StoryForge\1-renovel-ai-ai-rag-tavern\apps\workflow\tests\test_prompt_builder.py` 通过。
- [ ] `D:\StoryForge\1-renovel-ai-ai-rag-tavern\apps\workflow\tests\test_prose_static_check.py` 通过。
- [ ] `D:\StoryForge\1-renovel-ai-ai-rag-tavern\apps\workflow\tests\test_novel_loop_single_chapter.py` 通过。
- [ ] `uv run pytest` 在 `apps\workflow` 通过。
- [ ] `uv run pytest` 在 `apps\api` 通过。
- [ ] `pnpm run test:web` 通过。
- [ ] `pnpm test` 通过。
- [ ] `pnpm verify` 通过。
- [ ] `D:\StoryForge\1-renovel-ai-ai-rag-tavern\.codex\verification-report.md` 已记录完整本地验证证据。
- [ ] `D:\StoryForge\1-renovel-ai-ai-rag-tavern\.codex\operations-log.md` 已记录关键决策、失败补救和复用说明。
- [ ] README 或 current-phase 如涉及能力边界变化，已同步更新且没有夸大真实 LLM 能力。

---

## 五、自审结论

- **需求覆盖：** 已覆盖质量评分、静态检查、场景质量计划、修订策略、黄金样例、BookRun 审计和本地验证。
- **占位扫描：** 本计划未使用待补充占位项；涉及“定位现有测试文件”的步骤给出了明确搜索对象和验收动作。
- **类型一致性：** `SceneQualityPlan`、`QualityScore`、`QualityIssue`、`QualityReport`、`RevisionStrategy` 均由模型层定义，再由 context、builder、quality、NovelLoop 复用。
- **风险控制：** 所有新增能力默认可空退化，不破坏既有 NovelLoop / BookLoop status 契约；真实 LLM 不作为本地测试前置条件。
