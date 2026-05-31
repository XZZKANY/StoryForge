# ????

?????2026-05-31 02:37:16

## ??

??????? CI ??????????94/100?

## ??

?? `aa9475c` ? `phase9b_real_llm_smoke.py` ????????

- `assemble_prompt_injection(..., prior_chapter_text=...)`
- `build_draft_prompt_from_state(..., full_chapter=True)`

???????????? workflow prompt builder ???????? CI ???????????????????????????????? API bridge ? workflow builder ? `full_chapter` ???

## ????

- `apps/api/app/domains/book_runs/prompt_assembly.py`
  - ?? `prior_chapter_text` ???????? `previous_summary_ref`?
  - ?? blueprint ???????? `target_word_count_min/max`?
- `apps/api/app/domains/book_runs/workflow_prompt_bridge.py`
  - ?? `full_chapter` ?????? workflow builder?
- `apps/workflow/storyforge_workflow/prompts/models.py`
  - `NarrativeContext` ?? `target_word_count_min/max`?
- `apps/workflow/storyforge_workflow/prompts/context.py`
  - ? state ????????????????
- `apps/workflow/storyforge_workflow/prompts/builder.py`
  - `build_draft_prompt(..., full_chapter=True)` ???????????
- ???
  - `apps/api/tests/test_prompt_assembly.py`
  - `apps/workflow/tests/test_prompt_builder.py`

## ????

??? worktree??? `aa9475c` + ???????

- `cd apps/api && uv run pytest tests/test_prompt_assembly.py tests/test_phase9b_real_llm_smoke.py::test_phase9b_real_llm_smoke_runs_one_chapter_and_records_evidence -q`
  - ???9 passed?
- `cd apps/workflow && uv run pytest tests/test_prompt_builder.py -q`
  - ???20 passed?
- `cd apps/api && uv run pytest -q`
  - ???313 passed, 6 warnings?
- `cd apps/workflow && uv run pytest -q`
  - ???110 passed?

## ????????

????????????????????????? `cd apps/api && uv run pytest -q` ??`tests/test_blueprint_api.py::test_locked_blueprint_writes_chapter_plan_to_existing_chapters` ? `apps/api/app/domains/blueprints/service.py` ??????????????????????????????????????????? worktree ??? `aa9475c` + ???? API ???????

## ????

- ?????94/100
  - ???? `previous_summary_ref` ? workflow ?? prompt ????????
- ?????95/100
  - ?????????????????workflow ????? CI ???????
- ?????92/100
  - ????????????????????? MCP ??????????
- ?????96/100
  - ???? CI ?????????????????????????
- ?????94/100
  - ?????????? API ?? ? bridge ? workflow prompt ???????
- ?????93/100
  - ???? worktree ??????????????

## ????

- ???????????????? `aa9475c` CI ???????
- ?????????????? `test_phase9b_real_llm_smoke_runs_one_chapter_and_records_evidence` ????????
- ???????????????????????????????????
- ????????????????????????????
- ????????????? `2026-05-31 02:37:16`?

## Novel Skill Framework 后续阶段最终验证报告

生成时间：2026-05-31 20:22:18 +08:00

### 验证命令

```powershell
cd D:\StoryForge\1-renovel-ai-ai-rag-tavern\apps\workflow
uv run pytest -v
```

结果：`153 passed in 3.53s`。

```powershell
cd D:\StoryForge\1-renovel-ai-ai-rag-tavern\apps\api
uv run pytest -v
```

结果：`314 passed, 6 warnings in 20.79s`。警告来自既有 JWT 测试密钥长度提示与 Starlette 422 常量弃用提示，不影响本次 Novel Skill Framework 功能。

```powershell
cd D:\StoryForge\1-renovel-ai-ai-rag-tavern
pnpm run test:web
```

结果：Web `137 passed`，shared `tsc --noEmit` 通过。

```powershell
cd D:\StoryForge\1-renovel-ai-ai-rag-tavern
pnpm test
```

结果：Web `137 passed`，API `314 passed, 6 warnings`，workflow `153 passed`。

```powershell
cd D:\StoryForge\1-renovel-ai-ai-rag-tavern
pnpm verify
```

最终结果：通过，`[verify:ci] 所有核心门禁通过。`

### 失败补救记录

- 首次执行 `pnpm verify` 失败在 `检查 OpenAPI 契约漂移`，前置 lint、Web 类型检查、shared、Web/API/workflow 测试均已通过。
- 根因：`scripts/generate-openapi.mjs` 和 `scripts/run-e2e.mjs` 内嵌 Python 使用 `Path.write_text()` 写入 OpenAPI 契约；在 Windows 上产生 CRLF 行尾，导致 `git diff --exit-code` 把整份契约识别为漂移。
- RED：新增 `apps/web/tests/phase1-navigation.test.tsx` 中的 `OpenAPI 生成脚本固定使用 LF 行尾写入契约文件`，运行 `pnpm --filter @storyforge/web test phase1-navigation`，失败信息为 `generate-openapi.mjs 应使用二进制写入避免 Windows newline 翻译`。
- GREEN：将两个脚本改为 `write_bytes((json.dumps(...) + "\n").encode("utf-8"))`，再运行 `pnpm --filter @storyforge/web test phase1-navigation`，结果 `15 passed`。
- 复验：运行 `pnpm openapi` 后，`packages/shared/src/contracts/storyforge.openapi.json` 无 git diff，且文件行尾统计为 `crlf 0, lf 12507, cr 0`。
- 最终复验：重新执行 `pnpm verify`，所有核心门禁通过。

### 完成定义审计

- 第一阶段基线文件与测试在当前工作区通过：已由 Task 0 记录，后续 workflow 全量测试再次覆盖。
- `NovelSkillRun` 与 `NovelSkillRunner` 能记录引用化技能运行记录：`tests/test_novel_skill_runner.py` 已纳入 workflow 全量测试。
- `run_single_chapter_loop()` 接入 runner 后保持 `NovelLoopResult` 对外契约等价：`tests/test_novel_loop_skill_runner_integration.py` 已纳入 workflow 全量测试。
- `derive_skill_chain_summary()` 能消费真实 `skill_runs`，也兼容阶段一 progress 派生：`tests/test_skill_audit_summary.py` 已纳入 workflow 全量测试。
- `audit_report.json` 追加 `skill_chain`，且旧数据可空退化：`apps/api/tests/test_book_exporter.py` 已纳入 API 全量测试。
- Web 审计页能展示技能链，无数据时显示明确空状态：`apps/web/tests/book-run-audit.test.tsx` 已纳入 Web 契约测试。
- 题材技能包只能显式选择，默认 BookRun 不加载题材扩展：`tests/test_genre_skill_registry.py` 已纳入 workflow 全量测试。
- `apps/workflow` 全量 pytest：通过，`153 passed`。
- `apps/api` 全量 pytest：通过，`314 passed, 6 warnings`。
- `pnpm run test:web`：通过。
- `pnpm test`：通过。
- `pnpm verify`：通过。

### 技术维度评分

- 代码质量：95 / 100。技能框架继续复用静态 registry、runner、audit 投影、BookRun 服务和 Web 审计页，不新增第二套编排器；OpenAPI 脚本修复为跨平台确定性写入。
- 测试覆盖：96 / 100。workflow、api、web、root test 与 root verify 均有本地执行证据；新增 OpenAPI LF 回归测试覆盖本次总门禁失败根因。
- 规范遵循：95 / 100。所有验证本地执行，报告和日志使用简体中文，提交前保留可重复命令与失败补救记录。

### 战略维度评分

- 需求匹配：96 / 100。覆盖 Skill Runner、NovelLoop 接入、审计派生、API 报告、Web 展示、题材技能包与端到端总验证。
- 架构一致：95 / 100。保持 `NovelLoop` / `BookLoop` 事实源，技能框架只做引用化记录与审计投影，不改变既有状态契约。
- 风险评估：93 / 100。当前工作区仍有若干用户侧 Web/设置页未提交改动；本次最终门禁已在当前状态通过，提交时需精确暂存 Novel Skill Framework 与验证脚本相关文件，避免混入无关改动。

### 审查结论

- 综合评分：95 / 100
- 建议：通过
- 决策：Novel Skill Framework 后续阶段 Task 0-8 已完成并通过本地总门禁。

## 合并主分支收尾验证报告

生成时间：2026-05-31 20:47:40 +08:00

### 验证命令

```powershell
cd D:\StoryForge\.worktrees\1-renovel-ai-ai-rag-tavern\novel-skill-post-phase1\apps\workflow
uv run pytest tests/test_book_loop_resume.py tests/test_book_loop_three_chapters.py tests/test_provider_degradation_pause.py tests/test_novel_loop_skill_runner_integration.py -q
```

结果：通过，`10 passed in 0.48s`。

```powershell
cd D:\StoryForge\.worktrees\1-renovel-ai-ai-rag-tavern\novel-skill-post-phase1
pnpm verify
```

结果：通过，`[verify:ci] 所有核心门禁通过。`

### 失败补救记录

- 首次合并验证失败在 workflow BookLoop 相关测试。
- 根因：`book_loop.py` 的 `_chapter_progress()` 读取 `NovelLoopResult.skill_runs`，但合并后的 `NovelLoopResult` 缺少该字段。
- 修复：为 `NovelLoopResult` 增加默认空 `skill_runs`，并在 skill runner 路径返回引用化审计快照。
- 复验：BookLoop 定向测试、NovelLoop runner 集成测试与根目录总门禁均通过。

### 审查评分

- 技术维度：95 / 100。修复点集中在缺失数据契约，复用现有 runner 审计输出。
- 测试覆盖：96 / 100。定向失败测试和总门禁均已本地执行。
- 规范遵循：95 / 100。验证记录已写入 `.codex/`，提交前不依赖远程 CI。
- 战略维度：95 / 100。合并后 master 保持可验证状态，分支清理可继续执行。

### 审查结论

- 综合评分：95 / 100
- 建议：通过
- 决策：允许提交合并并推送 `master`。
