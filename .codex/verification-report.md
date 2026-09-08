## 2026-09-06 B3a Monaco Worker 单变量对照

- 用户要求继续 B3 的下一步；只做候选实验，不改产品、不启动 B4、不自动提交。报告：`D:/StoryForge/docs/internal/monaco-worker-comparison-2026-09-06.md`；本地忽略证据：`D:/StoryForge/.trellis/tasks/archive/2026-09/09-05-monaco-worker-comparison/`。
- 相同99个 production 产物、共同 globalAPI/公共diff/RPC观测，两组只差是否启用本地 editorWorkerService factory；5对新origin交错A/B，每组diff后另导航input，共20个正式样本，4个校准独立排除，无正式补跑/剔除。控制10/10 fallback，候选10/10初始化成功、5/5真实compute回复成功且公共diff行范围一致。
- SSE→公共diff完成回调中位/max：control54.8/67.7、worker70.7/75.1 ms，配对worker−control中位+15.9；完成后双rAF75.2/94.2 vs77.6/82.1（配对+2.4），装饰双rAF79.1/99.3 vs80.5/87.2（配对+0.5）。每组160输入事件→nextRAF中位/max2.4/9.7 vs2.5/12.2 ms。回答双rAF配对5/5更早（中位−11.6 ms），但与diff完成延后并存，未证明整体交互提速，不将消除告警等同性能优化。
- 新origin启动两组各5/5仍有长任务；本轮diff/input窗口无≥50ms长任务，不能据此算出CPU节省。公共observer单次最高7.6/整页累计最高14.6 ms；RPC不是CPU、DOM/rAF不是paint或INP；部分Worker资源duration为负，保留但不作下载耗时统计。
- 已通过候选独立build、server14/14 tests、Desktop typecheck、`pnpm.cmd lint`、20样本/99原产物/冻结源码hash校验及独立复核。正式样本无error、hidden或资源失败；32键输入、dirty与可见文本均通过。仅editorWorkerService获验，不冒充其他语言Worker支持。
- 已关闭诊断页、reset viewport、停止服务并确认12端口关闭；原有9个WIP保留，本段前置不覆盖旧报告。无产品/API/DTO变化，未重跑产品build、`pnpm.cmd verify`、API/Vitest全量或OpenAPI；未验收Tauri/packaged、IME、真实provider/磁盘/writeback、长会话、稠密diff或文学质量。用户在两文档提交提议后要求「做下一步」，按列明范围提交，不推送。

## 2026-09-05 B3 Desktop 生产前端性能诊断

- 用户在 B2 提交后要求「做下一步」，本批只测量，不修改业务代码或推进 B4。报告：`D:/StoryForge/docs/internal/desktop-performance-baseline-2026-09-05.md`；本地原始证据：`D:/StoryForge/.trellis/tasks/archive/2026-09/09-05-desktop-performance-baseline/`（忽略目录，不随报告提交）。
- 基于 `08377dc0` 的 production bundle，在隔离 loopback origin、1440×920 浏览器、内存文件/模拟SSE下，完成4组×5次=20个正式样本。新origin欢迎DOM中位236/max283.6 ms，双rAF代理257.1/max301.2；同origin再导航DOM58.4/max80.1，双rAF123.7/max139 ms。
- 合成长文39,598 code units/99,598 bytes/7,199行、单处标点diff：结果入队→diff装饰双rAF中位82.6/max107.6 ms；160个真实ASCII insertText→下一rAF中位2.7/max9.1 ms。上述是前端代理，不是INP、实际paint、完整diff计算、真实IME或Tauri性能。
- 运行发现：冷启动5次长任务91–124 ms（LoAF指向入口模块，不能细归因）；20/20次Monaco缺worker factory并回退主线程，告警在开文件后，不是启动卡顿归因。建议后续单变量worker对照，不据告警宣称优化收益。
- 已通过：production build（23.36秒）；Desktop typecheck；最终`pnpm.cmd lint`；本地server12/12测试；20样本validity与99产物hash；独立只读重算。正式样本无请求/资源错误、hidden或阶段顺序问题。4个校准样本因fixture/资源路由问题保留排除；首次lint扫描临时build失败，产物移至既有标准dist并补诊断脚本环境声明后通过，无门禁规则变更。
- 原有9个未提交文件保留，本段只追加、不覆盖旧报告。无产品/API/契约变化，未重跑本轮`pnpm.cmd verify`、API/Vitest全量或OpenAPI；未验收Tauri/packaged、真实provider、真实磁盘写回、长会话、中文IME或人工文学质量。用户已确认仅单独提交本报告和 B3 验证段，不推送。

## 2026-09-05 B2 Agent 最终回答取消一致性

- 任务：`.trellis/tasks/09-05-agent-terminal-cancellation/`；用户明确批准 B2 及单独提交。基线为 `acf97697` 加原有 9 个文件的未提交改动；仅改领域最终投递边界及新增行为测试，本段与 B2 代码单独提交，原有清理内容保留，不推送。
- 复现：`uv run pytest tests/test_agent_terminal_cancellation.py -q`（`apps/api`）在旧生产代码上 **2 failed**：stop/pause 均由 provider stub 内独立 Session 经公开控制 service 落库，但仍返回 `late answer` 且没有 `runtime_interruption`。修复后首轮 **2 passed**，不将既有 DB 终态守卫误报为状态覆盖漏洞。
- 修复：`apps/api/app/domains/agent_runs/loop/conversation_runtime.py` 在 loop 返回、计划记录后重新读取控制状态；复用中断返回，阻止迟到会话消息、正常完成证据和成功 system jobs。保留旧 before-round 边界，但最新 stopped 优先于旧 paused。
- 证据：已发生模型调用保留 `assistant.chat_loop` 的累计 token/source/cost 及先前工具审计；暂停用既有 paused、停止用 failed，附 interruption，不保存迟到正文。首轮未调用模型不伪造消耗证据。SDK checkpoint、无 pending chat 恢复和 API/WS/DTO 词表不变。
- 新增矩阵 **11 passed**：末次 stop/pause、正常成功、工具后末次中断与累计用量、首轮前零调用、第二轮前已发生用量、pause→resume 不重放、计划记录期间 paused→stopped。使用临时项目、隔离 SQLite 测试库与独立 Session，无真实网络、sleep 或私有 runtime 打桩。
- 验证：相关 8 个 loop/lifecycle/tools/adapter/resume/permission/SDK recovery/source-standard 测试文件 **74 passed**；新矩阵 + SDK recovery + source-standard 合并 **34 passed**；定向 Ruff、`git diff --check` 通过。独立只读审查无阻断，规范已补最终投递与恢复边界；生产文件未改动行的原始行尾已保留。
- 总门禁：`pnpm.cmd verify` -> **exit 0，全部本地核心门禁通过**：根 lint/格式、Desktop/Shared 类型检查、project-core **7 passed**、Desktop **91 files / 606 passed**、API **1592 passed / 7 skipped / 6 warnings**（229.18 秒）、API Ruff、daily sidecar（零 LLM/零外网）及 OpenAPI/Agent 帧刷新无漂移。原始日志保存在本地子任务 `verify.log`。该门禁针对包含既有清理的混合工作树，不等于隔离 B2 提交的全量复测；既有跳过/warning 未掩盖。
- 未验证/范围：未执行真机 Tauri GUI、真实 provider、冻结安装包或文学质量验收；不宣称解决投递检查之后的所有事务竞争、单轮 fallback 取消、同轮工具强制取消，未修改 record_plan 的既有 current_step 规则；B3/B4 未启动。

## 2026-09-05 B1 拆书命令项目隔离

- 任务：`.trellis/tasks/09-05-breakdown-command-project-isolation/`。用户已批准实施及单独提交；只处理父任务 B1，B2/B3/B4 未启动。本段与 B1 代码单独提交，保留原有 API 清理等 9 个文件的其他未提交改动，不推送。
- 修复：拆书报告加载、生成、取消内聚到 `apps/desktop/frontend/src/components/app/useBookBreakdown.ts`；按已提交项目生命周期、请求身份和报告 revision 隔离迟到回调。保留 `useProjectCommands` 公共返回接口及 `BookBreakdownPreview` 类型 re-export，不改 API/WS/DTO、报告格式或 guarded writeback。
- 覆盖：切换/关闭/卸载、A→B→A、保存等待、完成提示等待、取消迟到清理、读/status 成功失败覆盖、StrictMode 重放、同 tick 重复点击和正常重跑。仍维持 single in-flight，切项目不自动取消原后台任务。
- 首轮红测：`npm.cmd --prefix apps/desktop/frontend run test -- tests/project-breakdown-state.test.tsx` -> **3 failed / 3 passed**；新失败分别证明旧生成覆盖 B 报告、旧读取成功/失败覆盖新生成。修复后该首轮集合 6 passed。
- 合并定向：`npm.cmd --prefix apps/desktop/frontend run test -- tests/project-breakdown-state.test.tsx tests/project-breakdown-lifecycle.test.tsx` -> **27 passed**。相对既有三项新增 24 项，不以旧三项或源码字符串断言代替新行为验证。
- 独立 frontend typecheck、定向 ESLint 通过；`uv run pytest tests/test_source_code_standards.py -q` -> **16 passed**；`npm.cmd --prefix apps/desktop/frontend run build` -> passed（27.26 秒），既有 Monaco 大 chunk 和 Tauri event 混合导入 warning 保留，未提高阈值掩盖。
- `pnpm.cmd verify` -> **exit 0，全部本地核心门禁通过**：根 lint/格式、Desktop/Shared 类型检查、project-core **7 passed**、Desktop **91 files / 606 passed**、API **1581 passed / 7 skipped / 6 warnings**、API Ruff、daily sidecar 冒烟（零 LLM/零外网）及 OpenAPI/Agent 帧刷新无漂移。该结果来自包含原有未提交清理的工作树，不等同于仅 B1 提交的隔离全量复测。API 跳过仍为本机符号链接/既有可选环境测试，不改写为全平台验收。
- 独立只读代码审查无阻断，额外补齐 StrictMode 与 status 等待窗口测试；`git diff --check` 通过。更新项目异步状态规范及子任务复盘，避免仅修 effect 而漏掉命令回调。
- 未验证：本轮未执行真机 Tauri GUI、冻结安装包、真实 provider 或文学质量验收，也未推进 Agent 末次回答取消修复。不能将单元测试或本地核心门禁外推成上述验收通过。

## 2026-09-05 项目多角度优化：只读审查与规划

- 任务：`.trellis/tasks/09-05-project-multidimensional-optimization/`，状态 `planning`。用户明确要求先规划、再确认第一批实现；已生成 PRD、design、implement 及 research/review，未激活实现。
- 两名只读审查 agent 分别核对 Desktop 拆书命令生命周期与 Agent 末次回答取消窗口。发现均为源码候选，尚未新增失败回归，不宣称已经复现或修复。首批建议仅处理拆书跨项目迟到回调，后续取消一致性、性能和发布/写作验收各自确认。
- `npm.cmd --prefix apps/desktop/frontend run typecheck` -> exit 0。
- `npm.cmd --prefix apps/desktop/frontend run test` -> 90 files / 582 passed，18.48 秒。
- `npm.cmd --prefix apps/desktop/frontend run build` -> exit 0，22.39 秒；Monaco chunk 3,337.88 kB / gzip 859.55 kB，主业务 chunk 576.33 kB / gzip 176.30 kB。有大 chunk 与 Tauri event 动静态混合导入警告；不是构建失败，也不直接证明实际启动或输入延迟。
- `git diff --check` -> passed。没有修改生产/测试源码；9 个原有未提交文件保留，报告仅新增本段，构建输出仍是忽略资产。Trellis 规划保留本地，不强制纳入 Git。
- 未验证：两项新候选的行为复现、API/Rust 全量、根总门禁、性能 trace、真机 Tauri 写回、真实 provider、文学质量和远端 CI。本轮没有访问真实小说或调用 provider；不外推历史 GUI/LLM 证据。

## 2026-09-05 提交收尾与 Linux 符号链接补验

- 用户确认后完成三批本地提交：`fd7a7fa6` 文件工具边界与预算、`7e00aae0` API/lint 与拆书报告状态、`5eea3765` 状态文档与验证证据。仅提交本轮内容，其他清理代码及报告段落仍留在工作区，未推送。
- 门禁任务已归档；文件工具 R1-R6 验收完成。Trellis 被仓库忽略，任务、规范及会话日志保留本地，不强制纳入版本库。
- Windows 本机及沙箱外均运行 `uv run pytest tests/test_agent_fs_boundaries.py -q -rs`：18 passed / 3 skipped，普通符号链接均为 WinError 1314；Windows junction 实测通过。
- 从提交 `5eea37650812dfabf4acfdfb2806adf66f5beaa7` 导出 API 源码、测试、pyproject.toml、uv.lock 及前端 semantics.ts，使用 Python 3.11.14 与 `uv sync --frozen --no-install-project` 构建 Linux 镜像。基础镜像摘要：`sha256:4f5d923c9dcea037f57bda425dd209f3ec643da2f0b74227f68d09dab0b3bb36`；最终镜像：`storyforge-fs-symlink-check:20260905`（manifest `sha256:4df0c5764b6ae9e872614acf568089fc12eac97fe9e39cc93de84e6b69d7ceb8`）。
- 测试容器使用 `--rm --network none`，仅挂载证据输出目录，未挂载本地配置、密钥或私有小说。容器内执行 `uv run --no-sync pytest tests/test_agent_fs_boundaries.py tests/test_agent_fs_tools.py tests/test_agent_fs_budget_feedback.py tests/test_agent_project_knowledge.py tests/test_author_memory_reach.py tests/test_manuscript_chapter_ordinals.py -q -rs --junitxml=/evidence/linux-fs-tests.xml`：**56 passed / 1 skipped**，唯一跳过为 Windows junction。
- 已解析 JUnit XML，确认三个边界链接用例及 `test_project_knowledge_rejects_oversize_and_symlink_escape` 均没有 skipped/failure/error。初次镜像遗漏前端 semantics.ts，目录约定测试失败；补入同提交源码后上述全组通过，未修改或放宽测试。
- 本地复现资产：文件工具任务 `verification/` 下的 Dockerfile、source.tar、linux-fs-tests.xml；任务收尾后位于 `.trellis/tasks/archive/2026-09/09-05-fs-tool-boundaries/verification/`。用该目录执行 `docker build -t storyforge-fs-symlink-check:20260905 <verification目录>`，再 `docker run --rm --network none --mount type=bind,source=<verification绝对目录>,target=/evidence storyforge-fs-symlink-check:20260905`。
- 本次未修改生产代码；此前总门禁结果保留为 API 1581 passed / 7 skipped、前端 582 passed。Linux 定向通过不改写 Windows 全量跳过数，不代表 Windows 原生符号链接、真机 GUI、真实 LLM 质量或远端 CI 已验收。

## 2026-09-05 已登记 API 与 lint 门禁修复

- 任务：`.trellis/tasks/09-05-verification-gate-fixes/`；实现及验收完成，未自动提交，保留已有未提交工作。
- intent 测试补齐 `chapter.polish` 的精确集合期望；Windows PowerShell 5.1 将无 BOM 的中文脚本按旧编码解析，已给证据验证脚本补 UTF-8 BOM，未更改质量判定门槛。对照中 ParseFile 失败而显式 UTF-8 ParseInput 无错误。
- 拆书报告状态记录所属项目；切换时按当前项目派生展示，effect 清理阻止旧加载响应写入。新增 3 项 hook 行为测试覆盖切换、旧响应覆盖和关闭项目，均先失败后通过；后台生成取消流程未重设计。
- `uv run pytest tests/test_ide_agent_orchestrator.py tests/test_real_llm_long_evidence_validator.py -q` -> 30 passed，原 13 项失败均关闭。
- `pnpm.cmd verify` -> exit 0，所有本地核心门禁通过：根 ESLint/Prettier、Desktop 与 Shared 类型检查、project-core 7 passed、前端 90 files / 582 passed、API 1581 passed / 7 skipped / 6 warnings、API 全量 Ruff、daily sidecar 冒烟、OpenAPI 刷新及无漂移。
- 当前状态文档同步后：`uv run pytest tests/test_phase9_fact_sources.py -q` -> 18 passed；`uv run ruff check tests/test_ide_agent_orchestrator.py tests/test_phase9_fact_sources.py` -> passed；`git diff --check` -> passed。
- 项目规范记录异步报告项目归属和 Windows PowerShell 中文脚本编码约束。current-phase、TODO、PROJECT_SUMMARY 已移除已解决阻断；下方旧结果为历史实跑，不能作为当前失败状态。
- 未验证：普通符号链接三项文件边界测试仍受本机权限限制，未重做真机 GUI、真实 LLM 长程质量或远端 CI；本地总门禁通过不等于发布验收。冻结 sidecar 证据沿用同日文件工具任务，本次总门禁运行的是 daily 源码档。

## 2026-09-05 项目状态校准

- 任务：`.trellis/tasks/09-05-project-state-calibration/`；用户已授权继续，文档与测试同步完成，未自动提交。
- 更新 current-phase、TODO、PROJECT_SUMMARY；旧文本完整保留在同目录三份 history 文件，仅加归档标记。当前文档区分代码已实现、未提交修复、最近一次验证和历史 GUI/LLM 证据。
- 修正全文搜索/现场恢复的过时缺失描述，记录 BookRun Agent 工具退役及文件工具修复；保留上一项全仓失败与符号链接缺口。
- `uv run pytest tests/test_phase9_fact_sources.py -q` -> 18 passed（含当前文档相对链接校验）。历史断言指向归档，不再强迫当前文档保留旧结论。
- `uv run ruff check tests/test_phase9_fact_sources.py` -> passed；`git diff --check` -> passed。
- 未重新跑 API 全量、GUI、真实 LLM 或远端 CI；文档中的全量数字明确来自前一项实跑。未修复无关 lint/测试错误，既有工作区改动保留。

## 2026-09-05 文件工具边界与资源修复：实现验证

- 任务：`.trellis/tasks/09-05-fs-tool-boundaries/`，已获实施授权，保留 in_progress（全仓门禁与符号链接验证缺口未关闭）。
- 实现：逐文件目标及隐藏路径校验、目录链接/junction 不递归；20,000 目录项/64 深度；2 MiB 完整读取；16 MiB 搜索累计读取；UTF-8 前缀解码；regex 单次 50 ms/累计 2 秒。Project Knowledge 同步保护且不返回截断凭据片段；跨章审校不吞章序枚举错误。
- 初始红测：`uv run pytest tests/test_agent_fs_boundaries.py -q` -> 8 failed / 3 skipped，确认无界读、乱码、漏报 truncated 与非法参数问题。
- 定向：`uv run pytest tests/test_agent_fs_tools.py tests/test_agent_fs_boundaries.py tests/test_author_memory_reach.py tests/test_manuscript_chapter_ordinals.py tests/test_source_code_standards.py -q` -> 63 passed / 3 skipped。
- 共享调用方：`uv run pytest -q -k 'project_knowledge or consistency or canon or entity_budget or prose_scan or collapse or cross_chapter or book_breakdown'` -> 244 passed / 1 skipped。
- 失败反馈与跨章：`uv run pytest tests/test_agent_fs_budget_feedback.py tests/test_agent_cross_chapter.py -q` -> 16 passed。
- `uv run ruff check app/domains/agent_runs app/domains/ide tests` -> passed；`pnpm.cmd check:drift` -> OpenAPI 零漂移；`git diff --check` -> passed。
- `pnpm.cmd smoke:sidecar:packaged` -> 重建 exe 后通过，ready 7818 ms；PyInstaller 自动收集 hook-regex，无需更改构建配置。
- `uv run python ../../.codex/fs-boundary-packaged-probe.py`（apps/api）-> PACKAGED SEARCH PASS。本地模拟 provider、临时库和隔离项目驱动真实冻结 exe 的 Agent SSE；普通正则返回 needle，高回溯正则返回超时错误。无真实 LLM 调用，探针服务已关闭。
- 全量 `uv run pytest -q` -> 1564 passed / 13 failed / 7 skipped。失败：旧 `test_supported_intents_are_registered` 期望遗漏 chapter.polish；12 个 `test_real_llm_long_evidence_validator.py` 用例因既有 PowerShell 验证脚本 UnexpectedToken 无法执行。相关文件未由本任务修改。
- `pnpm.cmd verify` -> 被既有 `apps/desktop/frontend/src/components/app/useProjectCommands.ts:81` 的 react-hooks/set-state-in-effect 阻断，未扩展范围修改前端。
- 未验证：3 项普通符号链接用例因本机创建权限跳过；Windows junction 真链接测试通过。未宣称抵抗恶意本地进程并发路径替换或完成真机 GUI 验收。
- uv lock、packaged smoke、OpenAPI 首次受缓存权限阻断，授权重试后通过。已有工作区改动保留，无自动提交。

## 2026-09-05 文件工具安全修复：规划记录

- 任务：`.trellis/tasks/09-05-fs-tool-boundaries/`，状态 planning。
- 已完成：读取实现、测试和公共调用方；产出 prd.md、design.md、implement.md，并回读 PRD 检查需求收敛。
- `git diff --check`：通过；任务目录文档已通过 Get-Content 回读确认存在。
- 未验证：行为测试、Ruff、契约与冻结 sidecar。当前仅规划，生产代码尚未修改，不能宣称漏洞已修复。
- 原有工作区改动保留，以下既有报告内容不变。

# 验证报告 · 清理孤立符号与收窄缓存异常

时间：2026-09-05

## 范围

删除 API 内无仓内消费者的 `envelope_from_items`、`S3UploadError`、`DisabledRerankerClient` 和两个 LLM 配置公共别名；将 Artifact 缓存 DTO 解析从裸 `Exception` 收窄为 `pydantic.ValidationError`。保留 `record_workflow_model_run_payload`、BookRun dispatch aliases、workflow-dispatch 路由/DTO 和全部安全护栏。

## 验证

```text
cd apps/api && uv run pytest tests/test_source_pruning.py tests/test_redis_cache_strategy.py tests/test_retrieval_real_providers.py tests/test_model_runs.py tests/test_book_run_workflow_dispatch.py -q
-> 67 passed

cd apps/api && uv run pytest tests/test_pagination.py tests/test_s3_integration.py tests/test_llm_config_file_override.py -q
-> 16 passed, 2 skipped

cd apps/api && uv run ruff check app tests
-> All checks passed

UV_CACHE_DIR=D:\StoryForge\.codex\tmp\uv-cache pnpm.cmd check:drift
-> OpenAPI 契约无漂移

git diff --check
-> passed
```

全仓检索确认已删除符号只出现在 source-pruning 的反向断言中；未发现生产、测试或动态导入引用。

## 全量回归

`cd apps/api && uv run pytest -q` 返回 `1545 passed, 4 skipped, 13 failed`。失败项均不涉及本轮修改：1 项是既有 `chapter.polish` intent 基线差异，12 项是 `.codex/validate-real-llm-long-evidence.ps1` 的 PowerShell ParserError。

## 未验证项

- 真实 MinIO 集成测试按默认配置跳过。
- 未运行 Desktop/Rust 全量套件；本批次未修改 OpenAPI DTO、Desktop 或 Rust。

---

# 验证报告 · 移除无项目态的功能阻挡

时间：2026-08-05

## 问题

作者反馈：「程序第一次打开 关闭欢迎页后 必须开一个项目才能点其他功能 我觉得这样有问题」

## 根因

**ActivityBar.tsx 第 70/82 行：** 无项目时 `projectOnly` 视图（作品/手稿/搜索/观测镜）会变灰且点击被 `if (dimmed) return;` 阻挡。

**App.tsx 第 175/178 行：** 快捷键 Ctrl+1/2/3/4 有 `if (!workspace.activeProject) return;` 守卫。

**实际影响：** 关闭欢迎页后如果不开项目，左侧图标栏的多数功能无法点击、快捷键失效，给人「卡住」的感觉。

## 修复

1. **ActivityBar.tsx**：移除 `dimmed` 判断与点击阻挡，去掉变灰样式 — 视图始终可点击，具体内容由各视图自己决定是否显示占位提示。
2. **App.tsx**：移除 Ctrl+1/2/3/4 的 `activeProject` 守卫 — 快捷键始终响应。
3. **移除 `noProject` 参数**：ActivityBar 不再需要这个 prop，从函数签名和调用处一并删除。

## 验证

```bash
npm run typecheck  # 通过
npm run test       # 88 passed (88), 569 passed (569)
pnpm lint         # 通过
```

## 行为变化

- **之前：** 关掉欢迎页后无项目时，左侧多数图标变灰不可点、Ctrl+1/2/3/4 失效。
- **之后：** 左侧图标始终可点击，快捷键始终响应；无项目时各视图显示占位提示（"打开项目后可查看…"），符合作者期望的「能点左边的功能」。

---

# 验证报告 · 借苹果的设计立场，落成六条可证伪的约束

时间：2026-07-30

> **提名口径说明**：作者原话——「苹果的设计审美很不错 有什么我可以借鉴的吗」，随后
> `/goal 做1到6`。属作者显式指定的六项，不是主动打磨波，也覆盖了 2026-07-26「编辑器停
> 主动打磨波、每周至多一刀」那条自定规矩——该规矩已在答复里显式提示过，作者选择全做。

## 先说不该做的：已经很苹果的部分不重做

摸查现有 token 系统后的第一个结论是**克制**：单色语义梯度、只留一个「金子色」（iris 给
agent）、发丝描边而非重投影、滚动条平时收起、`prefers-reduced-motion` 全局降级、
`:focus-visible` 焦点环——这些正是苹果克制感的来源，本波一条没动。

真正缺的是**尺子**：圆角与字号都不是阶梯，而是按需微调出来的连续谱。

## 六刀与对应 PR

| # | 刀 | PR | 性质 |
| --- | --- | --- | --- |
| ② | 圆角收成同心阶梯 | #241 | 机械收敛 + 护栏 |
| ① | 字号收成八档阶梯、字距挂档位、修 UI 字体两条栈打架 | #241 | 含一个真 bug |
| ③ | 壳子在作者写字时退场 | #242 | 新行为 |
| ④ | 接受建议改为落位而非硬切换 | #242 | 新行为 |
| — | 补上接受的重入闸 | #244 | **#242 自带回归，我引入的** |
| ⑤ | 写回后一键撤销 | #243 | 新行为（红线不动） |
| ⑥ | Win11 Mica 窗口材质 | #245 | 观感最抓眼、验证最不足 |

## 顺手逮到的三个真缺陷

1. **`body` 与 `--font-ui` 两条栈打架**（#241）。`body` 硬编码了一条与 `--font-ui` 不同的
   字体栈（多 Roboto/Arial、少 Microsoft YaHei UI/PingFang SC），全站 UI 实际继承的是
   `body` 那条，`--font-ui` 只在两个内联浮层生效——token 形同虚设。
2. **补丁面板的只读 diff 只同步了字号与字体**（#241）。行高吃 Monaco 默认 ≈1.35×、字距为
   0，而主编辑器是 1.9× + 书稿字距：同一段稿子逐字核对时两种呼吸节奏。
3. **接受建议的双写窗口**（#244，自己引入自己逮）。#242 把落位动效插在 `teardown()` 之前，
   `teardown()` 从「同步先跑」变成「`await` 之后才跑」，那 170ms 里接受键与 Alt+Enter 都
   还能再次触发 `applyAccepted`——两次触发各走一遍守卫写回，同一补丁写两次盘。

## 两处不照搬、改打法

- **⑤ 不动「未确认不写盘」红线。** 苹果的做法是避开 modal、先做再给 Undo；但该红线写在
  `CLAUDE.md` / `README.md` / `ide-first-product-direction.md` / `TODO.md` 四处，并由
  `src-tauri/src/main.rs:1104-1111` 的 smoke 断言守着。改成直接写回会一次性打爆四处文档承诺
  和那条 smoke。所以本刀降的是**接受之后**反悔的成本：从「翻版本历史 → 恢复进缓冲 → 再手动
  保存一次」变成一次点击。撤销本身也走 `performGuardedWriteback`，不从后门绕开 F27。
- **⑥ 不走 `tauri.conf.json` 的 `windowEffects`。** 那条路在 tauri 内部把每个 `apply_*` 的
  `Result` 都 `let _ =` 吃掉，成败无从得知；而 `transparent: true` 会把 WebView2 背景强制
  清零，材质没挂上又让出画布就等于给 Win10 用户一个透明的应用。改成 Rust 直调
  `window_vibrancy::apply_mica` 拿真 `Result`，前端据此决定要不要启用透明。

## 命令与输出

```
npm --prefix apps/desktop/frontend run test        -> 76 files / 479 passed
npm --prefix apps/desktop/frontend run typecheck   -> 绿
pnpm.cmd lint                                      -> 绿（eslint + prettier）
node scripts/run-e2e.mjs                           -> 契约门禁 20 pass / 0 fail
cd apps/api && uv run pytest -q                    -> 1257 passed, 3 skipped (261s)
cd apps/api && uv run pytest tests/test_source_code_standards.py -q -> 16 passed
cd apps/desktop/src-tauri && cargo check           -> 绿
OpenAPI 漂移                                        -> 无漂移（后端零改动）
```

新增护栏 23 条，分布：`radius-scale`(4) `type-scale`(5) `shell-deference`(5)
`window-material`(4) `undo-writeback`(4) + `inline-chat` 落位时长/重入闸(2)。

## 变异验证（测试是否打在接线上）

七个变异逐个植入并重跑，**全部被逮红**：

| 变异 | 打掉的行为 | 结果 |
| --- | --- | --- |
| 圆角 | 一处 `text-3xs` 改回 `text-[10.5px]` | RED |
| 圆角（**非人为**） | 护栏首次运行即红，逮出此前 grep 漏掉的 40 处裸 `rounded` | RED |
| 字号 | 同上（越界任意值） | RED |
| 退场 | 往退场规则塞 `display: none` | RED |
| 落位 | CSS 过渡改 300ms、与 `INLINE_SETTLE_MS` 脱钩 | RED |
| 撤销 | 陈旧闸换成 `false`（撤销会吃掉作者新输入） | RED |
| 材质 | 一条规则的闸从 `[data-window-effect='mica']` 降成 `[data-window-effect]` | RED |
| 重入 | 把重入闸挪到 `playAcceptSettle` 之后（真实的重入窗口位置） | RED |

其中圆角那条特别值一提：**它是在写出来的那一刻先红的**，抓出我自己前一次 grep（模式要求
`rounded-` 后必须跟字符）漏掉的 40 处裸 `rounded`——是真找到东西，不是事后补的绿灯。

## 自身失误留痕

两次 `;` 串联的 `git checkout <file>` 把同一批未提交改动一起回退：第一次冲掉 `index.css`
的字号 token（重做），第二次冲掉重入闸（重做）。变异验证的还原一律改用带
`assert count == 1` 的 python 定点替换，不再用 `git checkout` 还原工作区。

## 未联通能力（不得宣称）

- **⑥ Mica 真机观感完全没看过。** 透明度档（活动栏 0.4 / 面板 0.62）是纸面选值。
- **⑥ 的 `visualTone` 断言在本机根本没跑到。** `node apps/desktop/scripts/verify-tauri-smoke.mjs`
  挂在「初始欢迎工作区不可见」——本机持久化会话打开着 `D:\连载\末世吞噬`，欢迎页不渲染，
  `visualTone` 返回 `null`。**已在 master 上复跑确认是既有环境问题、与本波无关**，但也意味着
  我对该断言的规避只有 CSS 护栏作证、没有 smoke 作证。
- **⑥ tauri 官方警告未验**：`decorations: false` + `shadow`（默认 true）+ 窗口效果这个组合
  官方标注可能出 1px 白边 / 阴影异常，本仓库正落在里面。
- **③ 退场节奏未调手感**：1.6s 空闲、0.42 不透明度、420ms 淡出全是纸面值。
- **④ 落位路径无单测覆盖**：Monaco stub 没实现 `changeViewZones` / `createDecorationsCollection`，
  整个 diff 渲染路径在测试里不执行；落位与重入闸都只有结构不变量作证，要真机点穿。
- **① 48 处站点的行高变化需眼看**：从任意值迁到 `text-xs`/`text-sm` 的站点会拿到档位自带的
  行高（此前继承父级），13/15px 并入 14px。
## 收尾：⑥ 真机验收不通过并回退，改做作者当场提名的两条

⑥ Mica 在真机 dev 窗口里肉眼验收：Rust 侧起服自检打出 `window_material applied=mica`
（`apply_mica` 返回 Ok、DWM 属性已设上），但**作者报「没有透出桌面的模糊感」，观感与改前完全
一致**。卡在后半段——要么前端 invoke 没拿到状态，要么 `transparent: true` 让 tao 额外做的那次
`DwmEnableBlurBehindWindow` 与 `apply_mica` 的 `DWMWA_SYSTEMBACKDROP_TYPE` 打架（调研时就标为
「必须真机验证」那一条）。**已完整回退（PR #247）**：它是六刀里唯一零收益又带 `transparent: true`
风险的一条，装机包马上要重建，不留一个验不动的图形栈问题进去。

同一次真机验收里作者提名两条（其实是一条）：「作品栏占的位置太少了」+「点了左边图标后展开的
区域应可以拉伸」。**PR #248**：侧面板右缘可拖（5px 命中区、双击复位），宽度按视图各记一份，
宽档默认 300→340，夹在 200-720，拖拽中不写盘、松手才落。变异验证：删掉 `pointermove` 的
`removeEventListener` 即红。

## 出包：0.1.10 已送达

```
版本五处全部 bump（app/common/version.py / pyproject.toml / uv.lock /
  src-tauri/Cargo.toml / tauri.conf.json）+ pnpm openapi 刷新快照 info.version
pnpm desktop:build            -> NSIS + MSI 双 bundle（不能用 tauri build，后者静默打旧 sidecar）
pnpm smoke:sidecar:packaged   -> 冻结 exe 冒烟全绿（就绪 6.8s / assistant 往返 / SSE 2 帧 /
                                 control REST / alembic 纳管 / 分层 prompt 已打包）
```

**定向断言（不只核 app_version）**：本轮六刀改动全在前端，后端零业务变更，所以「现造小书调新
命令」不适用；改为断言装机 exe 里嵌的前端产物确实是这一轮的——`side-panel-resize`、
`sf-inline-diff-zone--settling`、`data-shell-deferred`、`toast-action`、`radius-lg` 五个标记
逐一在 `dist/assets` 的 js/css 里命中。三件产物（desktop exe / NSIS / sidecar exe）时间戳同批、
FileVersion=0.1.10。

产物：`apps/desktop/src-tauri/target/release/bundle/nsis/StoryForge IDE_0.1.10_x64-setup.exe`（49.8 MB）

## 2026-07-30 Agent 架构诊断与规划更新

范围：只读核查真实写章链路，并更新
`.trellis/tasks/07-30-project-optimization-review/` 下的 PRD、design、implement 与
`diagnosis-agent-architecture.md`；未修改生产代码。

验证：

```text
python ./.trellis/scripts/get_context.py                  -> 当前任务 planning；仅既有 Cargo.lock 未提交
python ./.trellis/scripts/get_context.py --mode phase     -> 回到 Phase 1.1 需求探索
uv run python -c "...list_loop_tool_specs..."             -> live loop 共 18 个工具
Select-String / Get-Content 精确追踪                       -> context_bundle 在 live-loop 写作工具处断链
git status --short（写报告前）                            -> 仍只有 apps/desktop/src-tauri/Cargo.lock
git status --short（写报告后）                            -> 本报告 + 既有 Cargo.lock
```

三路只读审查分别核对 skill 执行、上下文传递、role/ToolSpec deletion test，结论一致：
`skill_catalog` 是 plan telemetry，普通写章仍走通用工具循环；role catalog 多数是展示/审计语义；
ToolSpec 派生、领域检查和 proposed patch 写回保护是应保留的真实执行能力。

未验证：未改生产行为，因此未运行 pytest、前端测试、OpenAPI 或构建；双轨与 brief 权限策略
均已确认，首刀子任务已完成 PRD convergence pass，仍需作者 review 后才能启动实施。

### 规划决策补充

作者已确认采用双轨：开放问答保留通用 Conversation Module，写章/重写章进入可执行
Chapter Writing Module。该决策已同步到 parent PRD、design 与 implement；任务仍为 `planning`，
尚未运行 `task.py start`，生产代码未变。

### 权限设置事实核对

作者决定章节 brief 按既有权限设置推进。代码与历史核对确认：API 仍接受 `permission_profile`，
但 Desktop `AppSettings`、`AgentUserMessageRequest` 和 SSE body 均未携带该字段，因此当前 live run
恒为 `risk_confirm`；界面的批准/拒绝只是逐次 event 控制。2026-07-07 的“权限四轨收敛”提交也明确
记录旧三档因前端从不发送而删除。规划已改为恢复端到端 Permission Policy，且任何档位都不得绕过
最终 proposed patch 的 diff confirmation。

### 首刀子任务规划

已创建 parent child `.trellis/tasks/07-31-trusted-writing-context`，状态 `planning`。PRD、design、
implement 将范围限制为 live-loop create/revise 的可信 context 注入、安全 provenance 与
author-loop 投影；`.资料` 发现、Permission Policy 和 Chapter Writing Module 均明确排除。
placeholder 检查为空，parent-child 链接正确，Phase 1.4 已加载；尚未执行 `task.py start`。

## 2026-07-31 可信写作上下文传递

范围：`.trellis/tasks/07-31-trusted-writing-context`。只修复自由文本 live loop 中
`file.create` / `file.revise` 到内层 `assistant.draft` / `assistant.revise` 的可信 context 断链，
以及对应安全 provenance 和 Desktop author-loop 投影；未实现 `.资料` 自动发现、Permission Policy、
章节 brief/质量门或完整 Chapter Writing Module。

实现结果：

- provider 生成的 `project_root`、`file_path`、`content`、三类 context 内部字段与 provenance 字段
  在 loop 边界统一剥离；目标路径/正文继续由项目边界解析。
- `ToolExecutionContext.args.context_bundle` 经既有 `build_llm_context_snapshot` 净化、预算与去重后，
  转为 inner prompt bundle；create/revise 的 `ToolResult` trace 留下 snapshot id、实际相对路径、count、
  source 与 warning count，不落 excerpt、正文或绝对项目根。
- Desktop 正常结算与 F10 恢复都通过同一个 decoder 优先读取 backend provenance；新后端明确返回空列表时
  不伪造本地路径，只有旧响应缺 provenance 才回退本轮本地 bundle。该数组继续同时进入版本 snapshot
  与 author-loop 记录。

红绿与回归：

```text
uv run pytest tests/test_agent_loop_writing_context.py -q
  -> RED: create 内层 prompt 无 GOLDEN_SPEC_SENTINEL；revise 采用 MODEL_FAKE_CONTEXT_SENTINEL
  -> GREEN: 2 passed
npm --prefix apps/desktop/frontend run test -- --run tests/agent-result-context.test.ts
  -> RED: contextFilesFromAgentResult 不存在（3 failed）
  -> GREEN: 3 passed
API 定向组合（含 context/live-loop/source/BookRun CLI 回归） -> 57 passed
API SSE/golden/save-point 扩展组合                         -> 79 passed
Desktop 全量 Vitest                                      -> 77 files / 484 passed
npm --prefix apps/desktop/frontend run typecheck          -> passed
uv run ruff check app/domains/agent_runs ...              -> passed
git diff --check                                          -> passed
```

仓库总门禁：第一次 `pnpm verify` 的 1263 项 API 中有 1 项红，定位为
`tools/__init__.py` 聚合导出 runtime helper 引入 BookRun CLI 循环依赖；改为从公开子模块
`tools.runtime_arguments` 直接导入后，独立回归转绿。第二次完整 `pnpm verify` 通过：

```text
root ESLint + Prettier                 -> passed
Desktop typecheck                     -> passed
shared type contract                  -> passed
project-core                          -> 7 passed
Desktop Vitest                        -> 484 passed
API pytest                            -> 1260 passed, 3 skipped
API Ruff                              -> passed
sidecar daily smoke                   -> passed（SSE 2 帧、control、alembic、prompt bundled）
OpenAPI + Agent frame drift gate      -> no drift
```

Wire 判断：只在既有 `AgentToolTrace.input_summary` generic object 内增加安全字段，没有新增/修改路由、
DTO、SSE 顶层字段或 generated schema；总门禁仍执行了 OpenAPI/Agent frame 刷新并确认无漂移。

真实 provider 首次复核未通过：隔离临时项目显式选择黄金三章 spec 后尝试真实 live loop，源码环境旧配置
返回 HTTP 401。作者随后要求改用装机版配置；隔离进程直接读取装机版 `llm-provider.json`，provider health
于 292ms 返回 `ok`，可见 `deepseek-v4-flash` / `deepseek-v4-pro`，全程没有复制、输出或持久化 key。

使用该装机配置重跑真实 live loop：outer Agent 读项目文件后调用 `file.create`，inner
`assistant.draft` 收到 2 个显式选择文件；writing trace provenance 为
`.资料/黄金三章-spec.md`、`.资料/写作-playbook.md`，source=`request_bundle`、warning=0，snapshot id
与 sibling summary 一致。trace/event 不含 context excerpt 或绝对项目根，durable evidence 不含 API key。
最终 `proposed_patch` 指向 `正文/第04章.md`，before=0、after=1614 字、`requires_confirmation=true`，
且确认前临时项目中目标文件不存在。证据见当前 Trellis 任务的 `real-provider-summary.json` 与
`real-provider-draft.md`；内存 SQLite 和系统临时小说目录已清理，未触碰 `D:\连载`。

人工通读不判章节质量通过：6 条硬任务中，开场冲突、天枢架位、观澜身份红线、长度 4 项命中；
“为救知情人而失去物证”的主动取舍没有成立，“阿梧”没有落在章末，结尾“天枢，从来不是架位”还
削弱了本章刚兑现的线索；库房仍在延烧时人物停下验钉和问话，也有现场逻辑问题。真实 provider 已证明
可信上下文和补丁红线接通，但不能据此宣称写章质量稳定或真机 Desktop author-loop / diff 点击确认通过。

## 2026-07-31 Agent Permission Policy

范围：`.trellis/tasks/07-31-agent-permission-policy`。Desktop 的四档权限选择现已成为下一次
AgentRun 的持久设置，并以顶层 SSE `permission_profile` 进入 API；run 创建时快照，恢复没有新值时
保留已持久化的 canonical profile。

实现与复核：

- API `permission` public face 集中 canonical 值、legacy alias、严格请求校验、历史 evidence 安全投影、
  stage policy 与 ToolSpec 风险 gate。未知显式值为 422；`read` 在 handler 前阻断写类和长任务。
- `risk_confirm` / `autonomous` 仅可生成待确认 patch，始终不能绕过 Desktop diff confirmation、
  snapshot-before-write 或 guarded writeback。`step_confirm` 已提供阶段决策，但通用 live loop 尚无 durable
  brief replay，因此当前写类工具诚实地在 handler 前阻断。
- `agent_run_started` frame、permission、terminal、pending recovery 与 BookRun snapshot 都投影 canonical
  profile。由 Agent 启动的 managed BookRun 镜像仅在首次创建时继承来源 run 的 profile；独立后台 run 保持
  `risk_confirm`，后续来源设置变化不改写镜像快照。
- 已新增 `.trellis/spec/storyforge-api/backend/agent-permission-policy.md`，把跨 Desktop/API/ToolSpec/evidence
  的可执行契约和错误矩阵固化下来。

验证：

```text
uv run pytest tests/test_agent_permission_policy.py -q  -> 18 passed
uv run ruff check <permission policy affected paths>    -> passed
git diff --check                                        -> passed
pnpm.cmd verify                                         -> passed
  root ESLint + Prettier                                -> passed
  Desktop typecheck                                     -> passed
  project-core                                          -> 7 passed
  Desktop Vitest                                        -> 77 files / 486 passed
  API pytest                                            -> 1279 passed, 3 skipped
  API Ruff                                              -> passed
  sidecar daily smoke                                   -> passed
  OpenAPI + Agent frame drift gate                      -> no drift
```

未验证：尚未在真机 Tauri 中完整点穿“Settings/Composer 改档 -> 新对话 -> evidence -> 重启持久化 -> diff
确认写回”链路；`step_confirm` 的真实 brief checkpoint 要等 Chapter Writing Module 提供 durable stage
replay 后再启用。本任务未触碰 `D:\连载`，也未纳入既有 `apps/desktop/src-tauri/Cargo.lock` 改动。

## 2026-07-31 按项目的 Agent 权限（Codex Desktop 式四档 + 自动落盘）

作者拍板：做成「Codex Desktop 对项目的权限」。四个方向性取舍先问后做，均由作者选定——
①「自动」档真自动落盘（越界才问）②档位表 read / ask / auto / full ③按项目存本机
④ Ctrl+K / Ctrl+Shift+K 只被只读档管住。本波同时收口上一刀 review 出的三条。

### 改了什么

- **档位词表**收敛为 `read` / `ask` / `auto` / `full`，DEFAULT=`ask`。**所有历史档位
  （risk_confirm / step_confirm / autonomous / full_allow / autonomous_approval）一律迁到 `ask`**：
  迁移绝不把任何既有 run 或既有作者设置升级成免点击落盘，`auto` / `full` 只能按项目显式选一次。
  这条是本波唯一不可回退的安全性质，已用参数化测试钉死。
- 上一刀的四档里，`autonomous` 与 `risk_confirm` 逐格决策完全相同（实测矩阵）、`step_confirm`
  对 5 个 write_pending 工具全阻断且循环内无审批出口——两者都已消失：`autonomous` 并入 `ask`，
  新的 `auto` 才有真实差异，`full` 的差异是长任务免二次确认。
- **写回红线改写**（作者显式授权）。没变的部分：后端在任何档位都不写项目文件，只出
  proposed patch；落盘一律经 `performGuardedWriteback`（写前快照 → 原子写 → 版本记录）。
  变的部分：「作者必须逐次点接受」不再是全局不变量，而由
  `PermissionPolicy.decide_stage(profile, "writeback")` 单点派生到
  `proposed_patch.requires_confirmation`（read/ask=True，auto/full=False）。Desktop 只读这一位，
  不按档位字符串自推（业务结论留在 API 侧）。5 处补丁构造点与 `judge.repair` 的 artifact 全部改为派生。
- 自动档不放宽的守卫：漂移拒写、`.storyforge/canon/derived/` 只读、项目边界、写前快照、撤销 toast。
  任一守卫拦下即退回 PatchReviewPanel 手动确认，绝不静默丢弃。顺带补上
  `writeAcceptedSuggestion` 此前**缺失**的派生目录闸（`saveCurrentFile` 一直有，AI 写回这条漏了；
  自动档下补丁不再经人眼，漏了会静默写坏派生缓存）。
- **按项目存本机**：`storyforge:agent-permission:<projectPath>`（照 daily-progress 模式）。刻意
  不写进 `.storyforge/`——把「自动落盘」授权随 git 传播给克隆的人是安全倒退。SettingsView 的全局
  Agent 分区已撤除（per-project 设置放全局设置页是范畴错误），入口收在 Composer 下拉。换项目在
  渲染期同步换档而非 useEffect，避免「切项目后第一帧按上一个项目的授权发出去」。
- Ctrl+K / Ctrl+Shift+K 走 `/api/assistant/*`、不经 AgentRun gate，只在只读档挡住发起；判定读
  localStorage 现值而非缓存 prop（授权判定要用作者此刻的选择）。
- 上一刀 review 的三条：`confirmed` / `user_confirmed` 进 `PROTECTED_LOOP_TOOL_ARGUMENT_KEYS`
  （唯一能把模型参数变成权限授予的键）；`create_or_resume_agent_run` 续接改吃
  `canonical_permission_profile` 容脏历史（此前严格校验会把整次续跑打成 500）；file.revise 的 loop
  `output_summary` 补回 `file_path` / `patch_id`（覆盖 `_tool_output_summary` 时丢了）。

### 验证

```text
pnpm.cmd verify                                   -> 全绿
  root ESLint + Prettier                          -> passed
  Desktop typecheck                               -> passed
  Desktop Vitest                                  -> 79 files / 494 passed
  API pytest                                      -> 1296 passed, 3 skipped (272s)
  API Ruff                                        -> All checks passed
  sidecar daily smoke                             -> 全绿
  OpenAPI + Agent frame drift gate                -> no drift
```

护栏打在接线上，且经变异验证：

- API `test_agent_loop_permission_writeback.py`：真跑 chat 工具循环，`ask` vs `auto` 下
  `proposed_patch.requires_confirmation` 与 `agent_result.requires_user_confirmation` 同步翻转，
  **两档下磁盘都不动**（后端红线未放宽的实证）。
- Desktop `tests/behavior/auto-writeback.test.tsx`：挂载真 `useSuggestionWriteback`，钉死四条——
  自动档无点击即落盘且顺序仍是先快照后写盘、询问档不落盘、确认位缺失失败关闭、快照失败阻断写盘
  且不记闭环。**变异验证**：把自动接受接线短路后，只有第一条断言变红，其余三条仍绿（说明它们各测各的）。
- Desktop `tests/agent-permission.test.tsx`：两项目各记一份互不串档、存档里的旧值读出来是 `ask`
  不是 `auto`、只读档挡住发起、自动落盘判定表、补丁确认位失败关闭。

### 未联通 / 不能宣称

- **真机未验**：「改档 → agent 直接落盘 → 撤销 → 重启后档位仍在」没有在装机版点穿，归 E2E-1。
  自动档也尚未在真实写作里连用过。
- **撤销网仍薄，自动档会放大**：版本快照每文件上限 20 份（连发自动落盘更容易挤掉中间态）、撤销
  toast 只在内存里且要求内容未再变、**新建文件自动落盘没有回滚点**（快照 previous 为空，撤销只会
  写回空串而不是删除文件）。作者选 `auto` 前应知道这一条；本波没有加深安全网。
- `full` 档只在长任务上与 `auto` 有差异；BookRun 是后台工具，该差异未在真实长任务上跑过。
- 本任务未触碰 `D:\连载`。`.trellis/spec/.../agent-permission-policy.md`（gitignored 本地规格）已随之
  重写，否则下一轮会照着上一版错的契约写。

## 2026-08-01 加深自动档的撤销安全网

上一波交付时如实记了自动档的三条薄弱面，作者要求「加深安全网」，并在两个深度里选了
「三洞各补一刀 + 本轮检查点」。

### 先纠正一条事实

`snapshotBeforeWrite` 的注释写着「若文件尚不存在（首次创建）则跳过」，**代码里从来没有这个判断**。
新建文件实际会存一份内容为空串的快照——所以不是「没有回滚点」，是**有一个假的回滚点**：恢复它
等于把文件清空，而不是让它回到不存在。撤销同理（写回空串）。

### 改了什么

- **检查点独立配额**：`source=Agent` 的写前快照改落 `.storyforge/versions/<file>/checkpoints/`，
  与普通快照**各算各的 20 份**。此前 autosave（900ms 防抖）与 agent 写回挤同一个池子，
  写一会儿最该留的那份先被冲掉。快照 meta 增记 `runId`，版本历史里两个目录合成一条倒序时间线，
  检查点条目带「检查点」标记。因为「一次对话最多一个待确认补丁」，一次 run 至多写一个文件，
  所以每次 agent 写回就是一个轮次锚点。
- **新建文件的真回滚点**：`snapshotBeforeWrite` 写前探测目标是否存在（探测失败一律按「已存在」，
  宁可写回空内容也绝不误删），meta 记 `created` 并回传给调用方。撤销一次新建改为**删除文件 +
  摘掉页签**——页签不摘的话，开着 autosave 下一次防抖就把刚删的文件原样写回来了。版本历史里
  这类条目标「新建前」，说清楚恢复它只会清空内容。
- **撤销失效不再是死路**：文件在写回后又被改过时，一键撤销确实不能用（会吃掉新输入），但检查点
  还在盘上。toast 从 error 改为带「打开版本历史」动作，直接把作者送过去。

刻意没做：跨文件回滚。当前后端一次 run 至多产出一个补丁，跨文件回滚没有真实触发场景，
先不引入这套数据结构。

### 验证

```text
pnpm.cmd lint                                     -> passed
Desktop typecheck                                 -> passed
Desktop Vitest                                    -> 80 files / 503 passed
API pytest                                        -> 1296 passed, 3 skipped
```

`pnpm.cmd verify` 首跑时 `test_real_llm_connectivity_probe_script.py` 红一次，单独复跑 10 passed、
整轮复跑全绿；该探针用例满载并跑时 flaky 是既有已知问题，本波改动全在前端，未触碰 Python。

护栏（新增 9 条，全部经变异验证）：

- `tests/versions-checkpoint.test.ts`：检查点落 checkpoints/、**40 次 autosave 之后 agent 那份检查点
  仍在**、检查点自己也有上限、「新建」与「内容为空」可区分、探测失败按已存在处理、版本历史合并两目录。
- `tests/behavior/auto-writeback.test.tsx`（挂载真 hook）：撤销新建 = 删文件 + 摘页签且不再写空内容、
  撤销普通修订仍写回原文不碰删除、内容已变时不覆盖新输入且给出版本历史入口。
- **变异验证**：把 ①检查点写回主目录 ②撤销新建走写回分支 ③撤销失效的 toast 去掉动作 三处同时打断，
  恰好红了对应的 6 条断言，其余 7 条仍绿。

### 仍未联通

- 真机未点穿：「自动档连写几轮 → 翻版本历史找到检查点 → 恢复」这条路没有在装机版走过；
  撤销新建的删文件行为也只在挂载测试里验过，未在真机确认页签摘除与 autosave 不复活。
- 检查点上限是 20，同一文件连续 20 轮以上 agent 写回后，最早那轮的锚点仍会被淘汰。
- 版本历史里恢复一条「新建前」快照仍然只是把内容清空，不会删文件（已在 UI 上如实标注）；
  真正的删除入口仍在文件树。

---

# 验证报告 · prompt 对比实验台 + 三波实验 + 删例合入

时间：2026-08-01

## 建了什么

`apps/api/scripts/prompt_lab/`：固定输入 × 变体配置 × 真 LLM 输出 → 并排报告的 A/B 实验跑道。

- 变体注册表：baseline 恒等引用生产 builder；变体从 baseline 渲染结果做 section 级删除/替换（零文案双源漂移）。
- runner CLI：`--dry-run` 零成本预验、`--jobs` 线程池并发调 LLM（渲染串行防 patch 钩子互踩）、
  `--repeat N` 统计性重复（结果进 repeats 数组）、`--merge` 格子级补跑合并、`--seed` 盲评重排、
  **实时落盘**（每格完成立即写 outputs 文件，key 中断不丢已完成格）。
- report：指标表 + 分节正文 + difflib 差异块 + 结论占位（人工判定）；blind.md 盲评版 seed 可复现。
- fixtures：雾港种子手写 NarrativeContext×3（开篇/过渡章/高潮对峙）+ 埋雷 MANUAL_DRAFT + 6 任务。

## 三波实验

| 波次 | 内容 | 结果 |
| --- | --- | --- |
| wave1 | 5 任务 × 变体全量（22 格，含 agent 组装链/评稿/修订） | 零 adopt，baseline 全线保留；no-examples → retest |
| wave2 | 2 任务 × 4 变体 × 3 重复（21/24 有效） | **no-examples → adopt**；half-examples → 不采用；task-rewrite → retest |
| wave3 | 高潮对峙新任务 × 4 变体单次（实时落盘） | 进行中（task-rewrite 已落盘） |

判定方式：workflow 三轮（任务级评审 → 对抗验证 → 综合定论），对抗验证全部 refuted=false，
引文逐字核验。证据目录 `.codex/prompt-lab/wave1/2/3/`（gitignored 不入库）。

## wave2 关键裁决

- **no-examples（删创作准则段的正反例锚点）→ adopt**：wave1 触发 retest 的「完整章丢必含事实
  （密钥/守塔人 0 命中）」在 wave2 未复现——两任务 6 次重复零丢失，且删例方向锚定观测更强
  （baseline 12 采样密钥点名 1/3 vs no-examples 12/12）。「必含事实与正反例行无耦合」成立。
- half-examples → 不采用（样本不足 + 无独立优势）；task-rewrite → retest（预览 3/3 better 出现反例，
  完整章样本不足，待无例生产基线上重测）。
- 附带合入：critique 评稿 prompt 显式写死评分方向（高分=好，含 narrative_collapse/ai_artifact_penalty）。

## 合入生产（删例）

`app/domains/book_runs/prompts/_sections.py::_craft_section` 删除好坏对照锚点渲染（保留 6 条准则）；
连带清理 `_sections.py`/`builder.py` 的 `CRAFT_EXAMPLE_*` re-export、registry 的 no-examples/half-examples
变体与对应测试。`app/common/craft.py` 常量与 `craft_prompt_clause(with_examples=True)` 保留
（assistant/service.py 的 file.create 路径仍用，不在实验覆盖内）。

### 验证

```text
uv run pytest tests/test_prompt_lab.py tests/test_prompt_assembly.py  -> 28 passed
uv run ruff check app/domains/book_runs/prompts/ scripts/prompt_lab/ tests/test_prompt_lab.py -> passed
```

### 仍未联通

- task-rewrite 在无例生产基线上的完整章稳定性未测（key 额度所限，留 retest）。
- wave3 高潮场景 4 变体输出已落盘但未评审。
- 真机桌面端未参与本波（纯 API/脚本层实验）。

# 2026-08-01 file.create 对齐删例 + 实验台指路

## 背景：吸收面复核

复核上波「删例」的吸收面，追调用链发现结论只落在一条链上：`_craft_section()` 仅被
`book_runs/prompts/builder.py` 的 4 个构建器消费 → `build_draft_prompt_from_state` →
`book_generation_draft.py`，即 **BookRun 后台工具**路径。桌面 live 的四条产字路径走的是
另一份形态 `app/common/craft.py::craft_prompt_clause()`，两者共用 `CRAFT_GUIDELINES` 文本、
锚点各存各的。live 四条里三条默认无例（结论对其空转），唯一带例的是 `file.create`
（`assistant/service.py::_DRAFT_SYSTEM_PROMPT`，`with_examples=True`）——上波已记为
「不在实验覆盖内」，本波按作者决定对齐。

## 改动

- `assistant/service.py::_DRAFT_SYSTEM_PROMPT`：`craft_prompt_clause(with_examples=True)`
  → `craft_prompt_clause()`。至此生产两条链均无锚点。
- `app/common/craft.py`：`CRAFT_EXAMPLE_BAD/GOOD` 与 `with_examples` 形参**刻意保留**（生产零调用方）。
  理由：prompt_lab 的变体纪律是「从生产常量做同源增删、不手抄文案」，留着才能在 live 链上重跑
  with/without 对比；删掉则未来只能从 git 历史抄回文案，正是该纪律要防的双源漂移。
- 新护栏 `tests/test_craft_guidelines_reach.py::test_no_prose_path_carries_example_anchors`：
  四条 live 产字 prompt 逐条断言不含锚点原文——常量既然留着，「生产没挂回来」必须由断言守住。
- `CLAUDE.md` §4 新增「prompt 对比实验台」小节：CLI 用法、变体纪律、**两条 prompt 链分开**的提醒、
  已裁定结论。此前仓内零指路（`docs/` + `CLAUDE.md` grep `prompt_lab` 无命中），下轮会话发现不了。

## 验证

```text
uv run pytest -q                                          -> 1314 passed, 3 skipped (263.77s)   # 上波删例合入零回归（作者曾叫停，本波补跑）
uv run pytest tests/test_craft_guidelines_reach.py tests/test_prompt_lab.py \
              tests/test_prompt_assembly.py tests/test_scene_discipline_reach.py -q -> 53 passed
uv run ruff check app/common/craft.py app/domains/assistant/service.py \
              tests/test_craft_guidelines_reach.py        -> All checks passed
```

变异验证（护栏可证伪）：把 `_DRAFT_SYSTEM_PROMPT` 定点改回 `with_examples=True` →
`test_no_prose_path_carries_example_anchors[file.create（assistant.service）]` FAILED（1 failed, 14 passed），
还原后 15 passed，`git diff --numstat` 确认 1 增 1 删无空白噪音。

## 仍未联通

- **file.create 的对齐是外推，不是实测**：三波实验只覆盖 `book_runs` 的多行 section 形态，
  扁平子句形态（live 四条）一次都没进过实验矩阵。若要实测需在 live 链上跑 with/without 对比。
- live 链的实验形态尚未跑通：`agent_registry.py` 的 `agent-baseline` 在 wave1 只出 26 字符
  （模型答「先读项目文件」即停——实验未挂 tools），agent 侧对比数据为空。
- task-rewrite 在无例基线上的重测未做（key 额度所限，沿用上波记档）。
- 真机桌面端未参与（纯 API 层改动）。

# 2026-08-01 出网自报 User-Agent（Cloudflare 1010 真 bug）

## 触发

接入作者新给的 OpenAI 兼容中转站时，`llm_client` 全线 403。抓原始响应为
`error code: 1010`（Cloudflare「banned based on browser signature」）——根因是
`openai_compatible_headers` 不设 UA，urllib 缺省自报 `Python-urllib/3.x`，被默认 WAF 规则拦。

UA 逐项实测（同 key 同端点 `/v1/models`）：

```text
缺省 Python-urllib                       -> 403 error code 1010
StoryForge/0.1.10                        -> 200
StoryForge/0.1.10 (+github 链接)          -> 200
curl/8.4.0                               -> 200
Mozilla/5.0 ... Chrome/126.0             -> 200
```

只有缺省 UA 被拦，任何显式 UA 均通——故取自报身份 `StoryForge/{APP_VERSION}`，不伪装浏览器。

## 影响面

BYO-key 是产品形态（作者自带 key 接任意中转站），Cloudflare 前置的中转站相当常见。
命中时表现为「key 明明有效却全线 403、报错不说原因」，作者无从自查。

## 改动

- `app/common/llm_http.py`：新增 `USER_AGENT = f"StoryForge/{APP_VERSION}"`，
  `openai_compatible_headers` 两条鉴权分支（bearer / api-key）共用同一 headers 起点故同时覆盖。
  `version.py` 是纯叶子，不破 llm_http 的无依赖约束。
- `tests/test_llm_http_env_parsing.py::test_headers_carry_self_identifying_user_agent`：
  两条鉴权分支逐条断言 UA 以 `StoryForge/` 开头、不含 urllib、且跟随 `APP_VERSION` 单点。

## 验证

```text
uv run pytest tests/test_llm_http_env_parsing.py tests/test_llm_client_channel.py \
              tests/test_assistant_continue.py -q      -> 53 passed
uv run ruff check app/common/llm_http.py tests/test_llm_http_env_parsing.py -> All checks passed
真跑：resolved_llm_env + call_llm_messages 打新端点 -> 200，content/token_usage 正常回填
```

变异验证：摘掉 headers 里的 `"User-Agent": USER_AGENT` →
`test_headers_carry_self_identifying_user_agent` FAILED（1 failed, 2 passed），还原后 3 passed。

## 仍未联通

- 只在一个 Cloudflare 前置端点上实证；其他 WAF 形态（JS challenge、mTLS）不在覆盖内。
- 冻结 exe / 真机桌面未复验（纯 header 改动，sidecar 走同一函数）。

# 2026-08-01 wave4：live 链删例实测（补上一刀的外推缺口）

## 换端点

作者换 key 两次。第一个（自称 grok-4.5）**判定为不可用作实验基底**：在我们的消息前注入约
4544 token 的编码 agent 系统提示词（1 字符输入 → prompt_tokens 4545；100 字符 → 4625，
增量 80 ≈ 我们那 100 字），发 `"1"` 回「Workspace exploration starting now」、自报
「Codex，基于 GPT-5」。变体差异会被这段隐藏前缀淹没，任何结论都不成立。
第二个 key 干净（1 字符 → 5 tokens），模型册为 Claude 系 6 个，作者选 `claude-sonnet-5`。

网关可靠性实测：短请求（~100 token 输出）6.4s；400 字格 64s；800–1200 字格 **280s 未完成**，
另有两次 `ConnectionReset`。故 wave4 缩到只跑 400 字的短格。
**顺带风险**：`file.create` / `file.revise` 是非流式，作者在桌面起草整章大概率撞上此超时；
`prose.continue` 走流式不受影响。

## 新增 live 链变体（补 2026-08-01 记档的「外推未实测」）

`registry.py` 新增 kind `live-draft`：`live-baseline`（`_DRAFT_SYSTEM_PROMPT` 恒等引用，
现生产=无例）vs `live-with-examples`（同源替换把锚点挂回）。两版实证**只差那 91 字符锚点**
（740 → 831，`w.replace(BAD+GOOD,"") == b` 成立）。system prompt 经生产唯一组装点
`build_generation_system_prompt(..., None)` 出；user 消息经生产 `_build_draft_prompt` 渲染，
不手写。`runner` 的 `_SYSTEM_PROMPT_KINDS` 收口「变体出 system prompt」这类 kind。

## wave4 结果（live-opening，2 变体 × 3 重复 = 6 格，全绿）

确定性指标：

```text
                     字数均值        密钥  左臂  无雾失真  老周   陈词
live-baseline(无例)   523 (+31%)     3/3   3/3   3/3     3/3   无
live-with-examples    505 (+26%)     3/3   3/3   3/3     3/3   无
```

（「密钥」按任意形态计；显式说出「密钥」一词的：无例 0/3、挂例 1/3。）

**判读：keep-baseline —— 未发现挂回锚点带来收益。** 两组必含事实全命中、零陈词、篇幅同样
超目标 26–31%（差异在噪声内）。文笔亮点反而集中在无例组：「那根烟是直的，没被捏扁」
（用物证反推老周不紧张）、「春天。她左臂受伤之前。」（把必含事实转成时间线线索）、
用「你那臂膀好些了没有」岔开话题（比直说「我只知道一点」高级）。挂例组亮点较少，
A1 结尾「知道一点……但不是我干的」偏直白交代。

结论方向与上一刀的外推一致、无反证，故 `file.create` 保持无例，**不做任何生产改动**。

## 本波修的三个工具缺陷（均变异验证）

1. **docstring 写了不存在的 `--blind`**，照抄即 argparse 报错，且该假用法已被抄进 CLAUDE.md。
   修两处 + 护栏 `test_runner_docstring_examples_use_real_flags`（正则抓 docstring 全部
   `--flag` 反查 parser）。
2. **`--out` 跟 cwd 跑偏**：从 `apps/api` 跑 `--out .codex/...` 落进 `apps/api/.codex/`，
   而 `.gitignore` 的 `.codex/*` 锚在仓根覆盖不到，证据目录变未跟踪文件。改为相对路径锚仓根
   （绝对路径原样）+ 护栏。
3. **盲评版根本不盲**：`blind.md` 保留 `prompt字符` 列，831/740 直接点名两个变体——本波判读
   因此不是真盲评。盲评版删该列（输出侧指标保留）+ 护栏。

## 验证

```text
uv run pytest tests/test_prompt_lab.py -q                    -> 21 passed
uv run ruff check scripts/prompt_lab/ tests/test_prompt_lab.py -> All checks passed
wave4 真跑 6/6 成功，证据 .codex/prompt-lab/wave4/（gitignored）
```

## 仍未联通

- **样本极弱**：n=3/组、单模型（sonnet-5）、单任务形态（400 字开篇）。长格（完整章）因网关
  跑不动未测——而删例的原始争议点恰恰出在长格（wave1 的丢事实）。
- 本波判读由单人完成，无对抗验证（前两波用的三轮 workflow 本会话未获授权）。
- 判读时盲评已被 prompt 字符数泄露；修复后的盲评版未用于本波。
- `critique` / `revision` / 长格 live 变体均未跑。

# 2026-08-01 产字路径改流式传输（修中转站掐断长文）

## 起因

wave4/5 实测：同一 climax prompt（800–1200 字），非流式 **280s 未返回 + ConnectionReset**，
流式 **72.4s 出 1347 字**。产字路径全是非流式，作者在桌面起草整章会撞上同一堵墙。

## 做法：服务端聚合的流式，HTTP 契约零改动

`llm_client` 新增 `call_llm_streamed()`——与 `call_llm()` 同签名、同返回 dict，差别只在
传输走流式后由服务端聚合（流式终帧与非流式返回本就逐键同构，都由 `_token_usage` +
`_cost_breakdown` 组，故只需摘掉 `type`）。切换三条长文路径：

- `draft_file_content`（file.create）
- `revise_file_content`（file.revise）
- `draft_continuation`（非 SSE 续写）

`chat_reply` 刻意不改：短问答没有被掐断的体量。前端零改动、OpenAPI 零漂移。
**注意这不是端到端 SSE**（作者看不到逐字冒出），那是另一刀。

两个刻意的边界：
- **终帧缺失必须抛错**——上游提前关流时静默返回空正文会把缺文当成功写进补丁。
- **空 system 段不落进 messages**——实验台的单条 user prompt 形态若被硬塞空 system，
  与 wave1-3 就不是同一个输入，破坏波次可比性。

## wave5：长格首次跑通（此前 0/1，现 5/6）

`live-climax`（800–1200 字）× 2 变体 × 3 重复，按 metadata 真实成功数统计：

```text
                     n   字数            越界(800-1200)  必含事实  不可逆后果  陈词
live-baseline(无例)   2   1350,1208       2/2            4/4      2/2       无
live-with-examples   3   1077,1412,1174  1/3            4/4      3/3       无
```

**wave1 判 retest 的理由是「删例后完整章丢必含事实（密钥/守塔人 0 命中）」——本波在长格上
未复现**：无例组两次全部命中密钥 / 左臂 / 无雾失真 / 守塔人 + 摔碎密钥的不可逆后果。
篇幅两组都偏长，挂例组略好但 n=2 vs 3，不构成判据。生产零改动。

## 顺带修的真 bug：重复写盘虚增样本

实时落盘按「已成功数」编号、`_write_artifacts` 按「repeats 位次」编号，两套口径不一致 →
wave5 的 2 次成功落出 3 个文件、r1 与 r2 逐字节相同。**按 `outputs/*.txt` 数样本（评审 agent
与人工判读都这么读）会把 n=2 当 n=3**，第一版 baseline 统计表即被此污染。统一为位次口径
（失败留编号空档），护栏断言「文件编号 ↔ repeats 位次」一一对应。

## 测试桩失配（27 红，非产品回归）

既有用例 patch 的是 `assistant_service._call_llm`，调用点换成 `_call_llm_streamed` 后 patch
失效、真去联网（`LLMConfigError: 缺少 STORYFORGE_LLM_BASE_URL`）。涉及 11 个文件。
修法：这些用例的本意是拦住出网、不是断言用哪种传输，故一律两个符号一起打桩
（单行形态 16 处改双 seam 循环，多行形态 9 处补 `_call_llm_streamed = _call_llm` 别名）。

## 验证

```text
uv run pytest -q                     -> 1330 passed, 3 skipped（基线 1314 + 本刀 16 新测试，零失败）
uv run ruff check tests/ scripts/ app/common/llm_client.py -> All checks passed
真跑：climax prompt 非流式 280s 超时 vs 流式 72.4s/1347 字
```

变异验证（三条，均先红后绿）：
- 把 `draft_file_content` 退回 `_call_llm(` → `test_prose_paths_use_streamed_transport[draft_file_content]` FAILED
- 实时落盘退回「已成功数」口径 → `test_realtime_and_final_output_files_agree` FAILED
- 盲评版塞回 `prompt字符` 列 → `test_blind_report_hides_prompt_chars_fingerprint` FAILED

## 仍未联通

- **不是端到端流式**：作者看不到逐字冒出；要做需改 router + 前端 + 契约。
- 只在一个 Cloudflare 前置中转站上实证掐断与修复；其他网关未验。
- 真机桌面未验（纯 API 层传输改动，归 E2E-1）。
- wave5 样本仍弱（n=2/3、单模型、单任务）；baseline 有 1 格「流式返回内容为空」未复跑。

# 2026-08-01 BookRun 摘除桌面入口（退役，代码留着）

## 背景更正

作者问「bookrun 不是退役了吗」。查证：**退役的是 `apps/workflow`（LangGraph 批量整书编排器，
2026-07-26 整包删除），`app/domains/book_runs` 没有** —— 它在 DOMAINS.md 是 backing 档，
且有明文红线「质量轨资产一行不删，直到真实长程重跑验收完成」。作者据此拍板：**摘入口、留代码**。

顺带修正 DOMAINS.md 的一句错话：原文写 `book_runs`（managed BookRun + **agent-loop prompt 装配**），
但实测 `agent_runs` 从本域只导入 `BookRun` 模型与 2 个异常类，**根本不用它的 prompt 构建器**
（循环产字走 `app/common/craft.py::craft_prompt_clause`）。这句话正是「改 book_runs prompts
= 改 agent 循环」这个误解的来源。

## 先做的解耦（无论退不退役都该做）

`assistant/service.py` 原先 7 个 import 块从 `book_runs.book_generation` 取 LLM 传输 / 配置，
但 `call_llm` / `env_value` / `llm_request_headers` / `optional_float` / `required_env` 的真身在
`app/common/llm_client.py`、`resolved_llm_env` 在 `app/common/llm_env.py`，book_generation 只是
facade 转发。改为直连真身后，**live 的 assistant 对 backing 的 book_runs 依赖从 7 降到 1**
（只剩 2 个异常类 + `missing_book_generation_env`，加 models 里的外键类型）。

## 摘掉的三个入口（只摘登记，实现全留，逐条可回滚）

| 入口 | 摘除点 | 回滚 |
|---|---|---|
| IDE 命令面板 | `command_registry._BUILTIN_COMMANDS` 的 5 条 `bookrun.*` | 加回 5 行 `IdeCommandDefinition` |
| agent 循环工具 | `catalog` 的 `*BOOKRUN_TOOL_SPECS` + `runtime_tools` 的 `handlers.update` | 恢复 import 与这两行 |
| 显式 intent 固定管线 | `intent.SUPPORTED_INTENTS`、`book_id+blueprint_id` 参数抢跑、固定管线分派表 | 加回三处 |

`_execute_bookrun_command` / `managed_bookrun_handlers` / `run_bookrun_generation_pipeline` /
`specs/bookrun_specs.py` / book_runs service + models + REST 全部保留。
**至此桌面完全没有起 BookRun 的入口**（不是变隐蔽，是没有）。

## 刻意没做的两件

- **没卸 REST router**：实测卸载会让 **37 个 BookRun REST 测试**红（`test_book_runs` /
  `book_run_start` / `budget` / `controls` / `resume` / `workflow_dispatch` / 两个导出），
  那批正是「质量轨资产」，删它与作者选的「代码留着」和红线都相反。前端**零调用**
  `/api/book-runs`，卸它对产品体验零改变。已回退，契约仍 86 条、零漂移。
- **没删前端 `agent-step-mapping.ts` 的 `'bookrun.start': '启动写作任务'`**：那是流程树标签，
  作者本机 sqlite 里的历史 run 仍存着该步骤，删了旧记录会渲染成裸 id。

## 测试改动（3 个端到端用例 → 4 个可证伪守卫）

删除的是**命令层 / 入口层**覆盖，不是 BookRun 行为覆盖——「控制必须真更新状态」仍由
`test_book_run_controls.py::test_book_run_control_endpoints_pause_stop_and_retry`（REST 层）保证。

- `test_ide_commands.py`：3 个 bookrun 命令用例 → `test_bookrun_commands_stay_unregistered`
- `test_agent_adapters.py`：覆盖测试 → `test_bookrun_tools_stay_unregistered`；路由测试改为断言
  `bookrun.start` 现在被固定管线**拒绝**
- `test_ide_agent_intents.py`：2 个端到端用例 → intent 未注册 + 结构化参数不再抢跑 两个守卫

## 验证

```text
uv run pytest -q            -> 1328 passed, 3 skipped（零失败）
uv run ruff check tests/ app/ -> All checks passed
node scripts/check-openapi-drift.mjs -> OpenAPI 契约无漂移
```

变异验证：把 `bookrun.start` 的 `IdeCommandDefinition` 加回命令表 →
`test_bookrun_commands_stay_unregistered` FAILED，移除后复绿。

## 仍未联通

- BookRun REST 面（12 条契约路径）仍挂着，只是无人调用；真要收窄需另行决定如何处置那 37 个测试。
- 真机未验：装机版里「命令面板搜不到写作任务」「agent 不再提议 bookrun.start」归 E2E-1。
- `writing_runs` seam 与前端 `writing-run.ts` 的 `book_run_id` 解析仍在（防御性读取，现无来源）。

# 2026-08-01 prompt_lab 实验证据清理（结论已全部落码）

## 盘点：五波实验的精华已在 master

作者问「实验精华合进项目了吗」。逐条核对，全部已合并、工作区干净：

| 结论 | 落点 |
|---|---|
| 删创作准则的正反例锚点（wave1-3 裁定 no-examples → adopt） | 批量链 `book_runs/prompts/` 已删；live 链 `file.create` 随 #252 对齐。`craft_prompt_clause(with_examples=False)` 为默认，**生产零调用方传 True**（全仓 grep 只剩实验台与护栏），`test_craft_guidelines_reach.py` 钉死 |
| wave4/5 补外推缺口 | live-opening（400 字）与 live-climax（800–1200 字）实测均未复现「删例丢必含事实」，判定在 live 链成立，**生产零改动** |
| 实验副产品：中转站掐断长文 | #255 产字三条路径改流式（非流式 280s 超时 → 流式 72.4s/1347 字） |
| 实验台三处缺陷 + 重复写盘虚增样本真 bug | #254 / #255 |

`CRAFT_EXAMPLE_BAD` / `CRAFT_EXAMPLE_GOOD` 常量仍在 `app/common/craft.py` 是**刻意保留**（变体
纪律要求同源增删、不手抄文案），不是漏删；生产不许挂回由护栏钉死。

## 清理

删除 `.codex/prompt-lab/`（9 个目录、115 份输出样本、11 份报告，1.5MB，gitignored 未入库）。
作者拍板「只删证据目录，留实验台」——`apps/api/scripts/prompt_lab/` 跑道与
`tests/test_prompt_lab.py` 全部保留，因为 `task-rewrite` 还欠一次重测，且以后改 prompt 仍要用。

同步改 `CLAUDE.md` §4 的裁定段：原文写「三波实验……证据 `.codex/prompt-lab/wave1-3/`」，
删目录后该指路即失效，改为指向本报告，并补上 wave4/5 把跨链外推转为实测这一事实。

## 仍未联通

- **`task-rewrite` 在无例基线上的重测仍未做**（key 额度所限），变体仍挂在 `registry.py`。
- 原始输出已不可恢复：此后复核只能读本报告的逐字核验引文，或重跑烧 key。
- wave5 baseline 有 1 格「流式返回内容为空」未复跑（样本 n=2 vs 3）。

# 2026-08-01 task-rewrite 无例基线重测（wave6）+ 修跑出来的两个传输洞

## 起因

作者点名跑 wave2 记档、wave4/5 因 key 额度未做的那次 retest：`task-rewrite`（「每句三检
（推进/加深/氛围）」式任务行）在**无例**生产基线上的完整章稳定性。

## 首跑即撞真 bug（两个，均已修 + 变异验证）

### 1. 生产回归：流式建连的重置逃逸（#255 引入）

首跑以裸 `ConnectionResetError` 打崩，traceback 落在 `urllib do_open → getresponse()`。
urllib 只把 `request()` 的 OSError 包成 `URLError`，`getresponse()` 阶段裸抛。而
`_stream_chat_completions` 的 urlopen 只挡 `HTTPError` 与 `(URLError, TimeoutError)`——
非流式 `call_llm` 一直有第三条 `_RESPONSE_READ_ERRORS`（含 `ConnectionError`）分支，
**#255 把三条产字路径搬上流式时没带过来**。后果：中转站一重置就不重试、不包 `LLMError`，
上层只 catch `LLMError` 于是整轮判失败。已补齐同形态分支（此时尚未消费任何流帧，重发
不会重复正文）。

### 2. 生产 bug：静默截断被当成稿

重跑落出一篇 804 字、断在「从柜台下面摸出一」的样本。查证机制：读帧循环在流 EOF 时自然
结束，`content` 非空即照常产出 `done` 帧；`call_llm_streamed` 的「终帧缺失必须抛错」闸只在
`final is None` 时触发，而内容非空就一定有终帧 —— **它挡得住全空，挡不住半截**。这条路径
正是 file.create / file.revise / prose.continue，自动档下半截章节不经点击直接落盘。

修法：读帧时记 `saw_terminal`，`[DONE]` 与 `finish_reason` **两种标记都认**（先拿真中转站
探过：实测同时发 `finish_reason:"stop"` 与 `data: [DONE]`，闸不会误杀），收尾无标记即抛
`LLMError` 并带上已输出字数。两个消费方都已稳妥承接：`call_llm_streamed` 直接抛，SSE 续写
`except LLMError` 标记工具调用失败并发 `error` 帧。

### 3. 实验台：单格失败隔离漏传输层裸异常

`runner.py` 只捕 `(LLMError, LLMConfigError)`，裸传输异常从 `as_completed` 逃逸打崩整跑，
**把已完成格连同实时落盘一起丢掉**——正是实时落盘要防的故障。改为按格捕获 `Exception`。

## wave6 结果（transition-full 完整章格 × 2 变体 × 3 重复 = 6 格，全绿）

长格首次一次跑满（此前 0/1、5/6）。

```text
                    字数              必含事实  情节要素  陈词  均句长  对白处数
baseline(现任务行)   865,853,965      3/3 ×3    全中      0     11.6    16,13,18
task-rewrite        965,804*,894     3/3 ×3    全中      0     13.2    15,7*,12
                    * 该篇被上游截断（即上文第 2 条 bug 的样本）
```

**判读：两组未拉开差距，不构成 adopt 依据。** 唯一名义差别是均句长（fixture 目标 13.0，
task-rewrite 更贴），但属弱代理指标；对白密度反而略低。变体保留在 `registry.py` 供后续
更大样本复测，`CLAUDE.md` 的裁定段已同步。

**方法教训：机械打分脚本给出过假阴性**——它报 task-rewrite「丢了结尾钩子 / 伪造揭示」，
而原文写的是「取出一部手机…按了一个号码」「压痕浅了将近一半，像是换了一只笔」，只是没用
关键词表里的字面。逐篇读过才纠正。仓里「工具不下结论、判定靠人工读」这条纪律有实证价值。

## 验证

```text
uv run pytest -q  -> 1333 passed, 3 skipped（#256 基线 1328 + 本刀 5 条新测试，零失败）
uv run ruff check app/common/llm_client.py scripts/prompt_lab/ tests/ -> All checks passed
真跑：wave6 6/6 成功；真中转站探针确认同时发 finish_reason 与 [DONE]
```

变异验证（四条，均先红后绿）：
- 摘掉流式建连的 `_RESPONSE_READ_ERRORS` 分支 → 两条重置用例以生产同款 `RemoteDisconnected` FAILED
- 截断闸改 `if False and not saw_terminal` → `..._rejects_stream_cut_before_terminal_marker` DID NOT RAISE
- 闸收紧成只认 `[DONE]` → `..._accepts_finish_reason_without_done_sentinel` 被误杀 FAILED
- 实验台单格捕获退回 `except ValueError` → `..._does_not_discard_completed_cells` 崩在 stdout 已印出
  `[1/3] 完成` 之后，实证「已完成格被连坐丢弃」

## 仍未联通

- **截断成因未定**：wave6 那篇是上游关流还是模型自停，产物证明不了——实验台不记 `finish_reason`。
  闸落地后这类格子会直接判失败，等于把成因暴露到下一次，但本次样本无法回溯。
- wave6 样本仍弱：n=3、单模型（sonnet-5）、单任务形态；判读由单人完成，无对抗验证。
- 盲评版 `blind.md` 已生成（零变体名泄露）但**作者尚未读**——上述判读是我的读法，不是终裁。
- 真机未验：截断闸与重置重试都是 API 层传输改动，装机版行为归 E2E-1。
- 只在一个 Cloudflare 前置中转站上实证；其他网关的收尾标记行为未测。

---

# 连载计划：把编排权从 BookRun 移进 agent（2026-08-01）

## 背景与取舍

作者提「bookrun 融到 agent 里更好吧，让 agent 来编排」。查证后**同意方向、否掉做法**：

- 支持编排权归 agent 的真实理由：BookRun 的编排从没通过质量验收（30 章人工退回重跑至今未重跑），
  而 agent 侧那套闸（`prose_check` / `collapse_check` / `entity_budget_check` / `promise_check` / `canon`）
  是后来才建的，BookRun 一条吃不到。留 BookRun 当编排器 = 留一个失败过的编排器 + 一套旧闸。
- 但**整体「融」会把三堵墙一起搬进来**（`loop_runtime.py`）：`LOOP_MAX_ROUNDS = 8`、
  `LOOP_TOOL_OUTPUT_BUDGET_CHARS = 60_000`、「一补丁即撤下全部补丁工具」（`_offered_schemas`，
  硬执行不是 prompt 劝导）。BookRun 绕开它们靠自带的 DB run 实体 + checkpoint 状态机；
  把壳搬进循环 = 拿 BookRun 换掉 agent 循环。

采用形状（作者拍板）：**编排跨轮、不在轮内**。计划落项目文件而非 DB run，三堵墙不再是墙——
它们本来就是「一轮一章」的尺寸。作者说「继续」即调度器。

## 本刀做了什么

- 新增 `app/domains/agent_runs/serial_plan.py`：`.storyforge/serial-plan.json` 的读 / 原子写 /
  确定性投影（下一章派生、prompt 块渲染、桌面端 payload）。原子写复用 `canon_store`（新增公共
  `atomic_write_json`），不各写各的 mkstemp+fsync+replace。
- 计划块注入 chat 循环 system prompt（紧跟作品底座、在 scene 硬约束之前）。
- 新增循环工具 `project.plan_update`：按 ordinal upsert 章节计划、推进状态、建计划骨架。
- `project_specs.py` 572 行撑破 500 行标准闸 → 按语义拆三份（一致性 / canon / 质量+计划），
  **拼接顺序即 catalog 顺序即 golden 顺序**，golden 因此逐字节只增不改。

**真值源纪律（本刀最要紧的设计）**：手稿正文是真值源，计划里的 `status` 只是声明。正文已存在的章
不当「下一章待写」，哪怕计划仍标 pending——否则作者忘了让 agent 标 done 时，agent 会重写已写完的章。
两者不一致时如实报「计划与正文对不上」并要求以正文为准。

**写回红线不变**：`plan_update` 只写 `.storyforge/serial-plan.json`，正文仍须走 `file.create` /
`file.revise` 的待确认补丁。`risk_level="read"`（同 `project.canon` 写派生缓存那档）——
每推进一章都要作者点确认会把「一轮一章」的流打断成两步。

## 验证

```text
cd apps/api && uv run pytest -q            -> 1350 passed, 3 skipped（#258 基线 1333 + 本刀 17 条新测试）
cd apps/api && uv run ruff check .         -> All checks passed
node scripts/run-e2e.mjs                   -> 20/20 PASSED（含 OpenAPI 零漂移）
git diff --numstat == --ignore-all-space --numstat  -> 逐文件相等，行尾噪音归零
```

变异验证（两条，均先红后绿，还原用带 `assert count==1` 的定点替换）：
- `next_chapter` 改成按 `status` 挑而非按正文挑 → `test_written_chapter_is_never_the_next_chapter_even_when_plan_says_pending`
  FAILED（返回第 1 章，written=True），其余 14 条不受影响 = 用例有针对性不是笼统断言
- 摘掉 `project.plan_update` 的 handler 注册（spec 仍在）→ 两条 e2e 全红
  （`execution_runtime._register_tools` 起服自检抛「工具缺少 handler」）

行尾坑复现并已处理：`test_agent_loop_runtime_tools.py` 在 HEAD 是**纯 LF**，Python `write_text`
把它整成 CRLF → 122 行的删除报成 790/790。按 HEAD 逐行还原未改动行的原始行尾后归零。
判据是 HEAD 主流 EOL，不是「文件是否混合行尾」。

## 仍未联通

- **真机未验**：计划块渲染、`plan_update` 在装机版的实际观感、以及「作者说继续 → agent 写下一章 →
  标 done → 下一章前移」这条完整流，都只在 headless 假 LLM 下验过。归 E2E-1。
- **真 LLM 未跑**：模型会不会**主动**在写完一章后调 `plan_update`，只有 prompt 引导句作保证，
  没有实测。若实跑发现它忘记调，正文真值源那条纪律是兜底（下一章仍会正确前移），但计划里的
  status 会长期漂移、每轮 prompt 都带一段「计划与正文对不上」。
- **未做且刻意不做**：自动连续推进（无 outer driver，作者说「继续」才走下一章）、前端计划面板
  （`to_payload` 已备好投影但无消费方）、从 BookRun 打捞 10 维评稿 rubric（`book_runs/prompts/builder.py`，
  仍未打捞）。
- 计划文件与 canon `promises` 有概念重叠（弧线 vs 伏笔账），本刀未统一，两者各管各的。

---

# 连载计划真 LLM 实跑：逮到「补丁未确认就标 done」（2026-08-01）

## 探针

作者提供真 key（deepseek-v4-flash，`https://api.deepseek.com`）跑 headless。探针建临时项目
（第 1 章正文 + 三章计划 + 人物设定），走 `stream_agent_message` 真 SSE 路径，只说「继续写下一章」。
key 与探针脚本只落 session scratchpad，不入库；项目建在 tmp、跑完删除。

## 三条验证通过

1. **模型主动调 `plan_update`**，无需作者提醒（两个场景都调了）。
2. **真值源纪律真的到达模型行为**（决定性）。场景 B 让第 2 章正文已存在、计划却仍标 pending：
   模型读完第 02 章后**先** `plan_update` 把第 2 章修正为 done、**再**写第 3 章，没有照计划重写。
   回话原文：「第 2 章《回声》计划状态已修正为 done（正文为准，不再照计划重写）」。
   工具序列：`fs.list → fs.read×3 → project.plan_update{ordinal:2,status:done} → file.create(第03章)`。
3. **计划的 goal 与 arc 被转述进产字指令**，印证「不动产字组装点、让模型转述」的设计判断。
   实测 instruction 含：「本章目标：潮汐表被人改过，林岚找到被撕掉的一页；作为「灯塔真相」弧的推进点」。

## 逮到的行为 bug 与修复

**场景 A（第 2 章未写）**：模型起草完第 2 章的**待确认补丁**后，同一轮就把该章标 done——
可补丁要作者点接受才落盘，此刻正文并不存在。跑完计划是 `第2章: done`、正文目录只有 `第01章.md`，
且模型据此对作者说「连载计划已把第 2 章标 done」。

真值源纪律兜住了后果（`next_chapter` 只看正文，下一章仍是第 2 章，作者拒绝补丁也不跳章），
但计划在作者决定之前就开始说谎。**同一次实测里模型在场景 B 又说「确认后我把第 3 章标 done」——
它知道规矩、只是记不牢，这种不一致不能只靠 prompt 多写一句兜。**

修法（两层）：
- **确定性闸**：`serial_plan_update.reject_premature_done` + `apply_plan_update` 前置校验，
  正文不存在的章标 done 一律 `FsToolError`，整调用不落盘。**刻意报错而非默默降级**——
  降级会留下模型已经对作者说出口的那句「已标记完成」。
- prompt 与 ToolSpec 描述同步改口径：「作者接受补丁、正文真的落盘之后」才标 done。

## 复跑验证（同一真 key）

场景 A 重跑：工具序列 `fs.list → fs.read×3 → file.create`，**没再调 `plan_update`**，
计划保持 `第2章: pending`。模型回话改口为「补丁确认落盘后，我再把计划里第 2 章标成 done」。

**诚实区分：这次是 prompt 引导句改变了行为，硬闸并未被触发**（模型压根没尝试）。
闸的报错路径只有单测覆盖，没在真模型上打中过。

## 验证

```text
cd apps/api && uv run pytest -q     -> 1353 passed, 3 skipped（+3 条闸测试）
cd apps/api && uv run ruff check .  -> All checks passed
node scripts/run-e2e.mjs            -> 20/20 PASSED（含 OpenAPI 零漂移）
真跑：deepseek-v4-flash 三轮（场景 A 修前 / 场景 B / 场景 A 修后），均拿到 agent_result
git diff --numstat == --ignore-all-space --numstat  -> 逐文件相等
```

`serial_plan.py` 加闸后 512 行撑破 500 行标准闸 → 按**读侧（载体+投影+渲染，对齐 `book_context`
的「一份投影两种渲染」）/ 写侧（合并与推进闸）**拆成 `serial_plan.py` 367 行 +
`serial_plan_update.py` 176 行；`clean_text` / `positive_int` / `written_ordinals` 随之转公共名。

## 仍未联通

- **闸的真模型触发未验**：修完模型就不再尝试premature done，所以 `FsToolError` 那条路径没被真模型打中。
- **单 provider 单模型 n=3**：只在 deepseek-v4-flash 上跑过，且每场景各一次，非稳定性证据。
- **真机未验**：装机版观感、以及「接受补丁 → 下一轮说继续 → 标 done → 前移」的完整闭环，
  仍只有 headless 证据。归 E2E-1。
- 作者接受补丁后**由谁**触发标 done 仍未定：现在靠作者下一轮开口，无自动回调。

---

# 接受补丁后回调标 done：闭环合上（2026-08-01）

## 背景

#260 的收尾里留了一条：「作者接受补丁后**由谁**触发标 done 仍未定，现在靠作者下一轮开口，
无自动回调」。作者拍板做掉。

## 改了什么

**后端**：`serial_plan_update.mark_chapter_written(project_root, file_path)` + IDE 命令
`plan.mark_written`（`writes=False`：只写 `.storyforge/serial-plan.json`，不落 DB、不碰手稿）。
章序由后端按正文阅读序算（`canon_rebuild.chapter_ordinals`，与作品底座 / canon 闸同一把尺），
**前端不猜章序**。

**刻意保守的三条**（回调在每次接受补丁时都会响，不能替作者无中生有）：
- 计划文件不存在 → **不建计划**。没在用连载计划的项目不该因为接受了一个补丁就被塞一份。
- 该章不在计划里 → **不追加条目**。写了计划外的一章是作者要知道的事，悄悄补进去等于抹平它。
- 正文实际不存在 → **不标**。与 `reject_premature_done` 同一条真值源纪律。

一律不抛异常：这是写盘**成功之后**的收尾动作，失败不该回头污染已经成功的写回。

**前端**：`lib/serial-plan.ts::markChapterWrittenInPlan`，挂在
`useSuggestionWriteback.handleAcceptSuggestion` 里 `writeAcceptedSuggestion` 返回之后。
**刻意只挂这一层**——手动点接受与自动档走的是同一个函数（自动档只是程序化调它），
而分块接受与行间对话 Ctrl+K 是段落级微调，接受一次不等于这章写完了；撤销走反向写回，
届时正文没了，后端自会拒绝。

## 验证

```text
cd apps/api && uv run pytest -q            -> 1363 passed, 3 skipped（+10 条 mark_written 测试）
cd apps/api && uv run ruff check .         -> All checks passed
npm --prefix apps/desktop/frontend run test -> 507 passed（80 文件，+4 条回调行为测试）
pnpm.cmd lint / frontend typecheck          -> 全绿
node scripts/run-e2e.mjs                    -> 20/20 PASSED（含 OpenAPI 零漂移）
```

**真 LLM 闭环实跑**（deepseek-v4-flash，三轮，四条判定全 True）：

| 轮 | 期望 | 实测 |
|---|---|---|
| 1「继续写下一章」 | 起草第 2 章、**不**标 done | 补丁=第02章.md，工具序列无 `plan.mark_written` ✓ |
| 2 模拟作者接受 | 写盘 + 回调 → 第 2 章 done | `{"updated":true,"ordinal":2,"next_ordinal":3}` ✓ |
| 3「继续写下一章」 | 这次写**第 3 章** | 补丁=第03章.md ✓ |

轮 3 的回话还回收了第 2 章里埋的伏笔（桌腿裂缝），旁证新接受的那章真的进了上下文。

变异验证（前端，先红后绿）：摘掉 `await markChapterWrittenInPlan(...)` 这一行 →
`接受补丁后回调连载计划标 done，且发生在版本记录之后` 转红，**其余 10 条不受影响**
（说明用例打在接线上、有针对性）。既有的 `calls` 断言是 `indexOf`/`includes` 式的松断言，
加不加回调都绿——所以必须另写这条显式用例，否则是假绿。

## 顺带修掉一个我自己种的缺陷

`serial_plan_update.py` 在 #260 里被拆出来时，脚本对**已含 `\r\n`** 的内容又做了一次
`replace('\n', '\r\n')`，产生 **139 处 `\r\r\n`**。Python 通用换行模式两者都当断行，所以
测试全绿、没人发现，但文件是坏的（每条语句间多一个幽灵空行，且此后每次 diff 都会一团糟）。
本刀已归一为干净 CRLF；`git grep -lIP '\r\r\n' HEAD` 确认全仓仅此一例。

**教训**：按字节读（`read_bytes().decode()`）不做通用换行翻译，此时再 `replace('\n', EOL)`
必然翻倍。要么先归一到 `\n` 再转，要么用 `read_text()`（它会翻译）。

## 仍未联通

- **前端那一步在真跑里是模拟的**：headless 无 UI，轮 2 用「写盘 + 直调 `plan.mark_written`」
  等价替代作者点接受。前端接线本身由 vitest 行为测试 + 变异验证覆盖，但**真机点一次接受**没验，归 E2E-1。
- **撤销之后不会反向取消 done**：撤销一次已标 done 的章，正文没了、计划仍写 done →
  会被 drift 如实报出来，且 `next_chapter` 只看正文所以行为仍正确，但声明是陈旧的。
  没做反向回调，属已知缺口而非疏漏。
- 单 provider 单模型、闭环各环节各跑 1 次，非稳定性证据。

---

# 撤销后反向取消 done + 修掉「章序前移认错章」（2026-08-01）

## 顺手挖到的真问题（比反向回调本身更要紧）

动手前查了一件事：撤销一次「新建」要**删文件**，而章序是
`canon_rebuild._chapter_ordinals` 按**路径序第几个**编的、**不是从文件名解析**的。
删掉 `第02章.md` 会让 `第03章.md` 的章序从 3 变成 2——反向回调正好落在这个雷上。

进一步查证发现这不止影响撤销：**正文一旦出现空缺，`build_plan` 就会判错**。
只有 `第01章.md` 与 `第03章.md` 存在时，`第03章.md` 的章序是 2，于是计划第 2 章被当成已落盘、
第 3 章被当成还没写——两处都反了。这是 #259 就带进来的隐患，happy path（顺序写、无空缺）
碰不到，所以此前三轮真跑都没暴露。

## 修法：按路径认章

- `PlannedChapter.declared_path`：标 done 时后端把正文相对路径记进计划条目（`path` 字段）。
  **后端算，不接受模型传**——模型猜错一个路径，后面按路径认章就全认到别处去了。
  两条标 done 的路径都记：`apply_plan_update`（`_with_stamped_paths`）与 `mark_chapter_written`。
- `build_plan`：记过路径的按路径判在不在；没记过的（还没落盘 / 作者手写）才回退章序，
  **且不认已被别的条目按路径认领的文件**——否则计划第 2 章会拿第 3 章的文件当自己的在场证据。
- `unmark_chapter_written` + IDE 命令 `plan.unmark_written`：**只按记下的路径认章**。
  认不出（计划里没记过这个路径，比如 done 是本次改动之前标的）就如实返回
  `chapter_not_identifiable`，**不按章序猜**。

## 前端

`unmarkChapterWrittenInPlan` 只挂在**新建撤销**那一支（`TauriFileSystem.deletePath` 之后）。
修订的撤销走反向写回、文件还在，那章依然是写完的，退回 pending 就错了——后端另有一道
以正文为准的闸（`manuscript_still_exists`），前端这层克制是不让它白跑。

## 验证

```text
cd apps/api && uv run pytest -q            -> 1370 passed, 3 skipped（+7 条）
cd apps/api && uv run ruff check .         -> All checks passed
npm --prefix apps/desktop/frontend run test -> 509 passed（+2 条）
pnpm.cmd lint / frontend typecheck          -> 全绿
node scripts/run-e2e.mjs                    -> 20/20（含 OpenAPI 零漂移）
git diff --numstat == --ignore-all-space --numstat -> 逐文件相等
```

**真 LLM 反向闭环实跑**（deepseek-v4-flash，四条判定全 True）：

| 步 | 实测 |
|---|---|
| 轮 1「继续写下一章」 | 补丁=`第02章.md` ✓ |
| 轮 2 接受 | `{"updated":true,"ordinal":2,"path":"正文/第02章.md","next_ordinal":3}`，计划记下路径 ✓ |
| 轮 2b 撤销（删文件+unmark） | `{"updated":true,"ordinal":2,"next_ordinal":2}`，状态退回 pending、path 抹掉 ✓ |
| 轮 3「继续写下一章」 | 补丁=`第02章.md`——**又回到被撤销的那一章** ✓ |

变异验证（两处，均先红后绿）：
- 后端把反向回调改成「按顺序取第一条」而非按路径认章 →
  `..._identifies_chapter_by_path_not_by_shifted_ordinal` 与 `..._does_not_guess_when_path_was_never_recorded`
  转红，其余 8 条不受影响
- 前端摘掉 `await unmarkChapterWrittenInPlan(...)` → `撤销一次新建后回调把该章退回 pending` 转红，
  其余 12 条不动

## 仍未联通

- **真机没点过**：headless 无 UI，接受 / 撤销都用后端等价动作模拟。前端接线有 vitest + 变异验证兜底，
  真机点穿归 E2E-1。
- **没记过路径的旧计划退不了标记**：`chapter_not_identifiable` 如实返回、不猜。属设计选择。
- **章序回退仍是启发式**：没记路径的条目仍按「路径序第几个」判，排除已认领文件后更准，
  但正文有空缺且相关章都没记过路径时仍会判错。彻底解法是给每章都记路径（要么作者手填、
  要么解析文件名），两者都与仓库现有「章序=路径序、别解析文件名」口径冲突，未做。
- 单 provider 单模型、各环节各跑 1 次，非稳定性证据。

---

# 标点漂移闸：模型顺手美化的标点不再写进正文 / 不再污染越界警告（2026-08-01）

起因是通读 opencode（`D:\opencode`，MIT）的 `apply_patch` 定位链，看到它在第四级
comparator 里把智能引号 / em-dash / 省略号 / 不换行空格归一后再比对。原打算照抄它的
「模糊匹配熔断 + 匹配前归一化」两条闸，**复核后发现原形不适用**，记在这里免得重开：

- StoryForge 的补丁是整文件 `before`/`after`（`patches/types.py:15-16`），diff 走 LCS
  （`patch-hunks.ts:233`），**没有「模型给 oldString 去文件里模糊定位」这一步**。
- 逐 hunk 接受时的定位（`patch-hunks.ts:456-478`）只做精确子串 `indexOf` + prefix/suffix
  context 打分消歧，多处命中直接抛错。匹配到的 span 长度恒等于 `beforeText.length`，
  **物理上不存在「糊到更大一段」**，`isDisproportionateMatch` 那道熔断没有对应漏洞。
- `beforeText` 切自 `before` 本身而非模型抄写，所以「模型美化标点导致找不到」也不成立。

但根因确实在，只是换了张脸：三处 prompt（`revise_scope.py:22`、`inline-chat.ts:19`、
`assistant/service.py:223`）都写了「不得调整标点」——**这是被咬过才会写的句子**——而全仓
零确定性兜底。实测（golden `novel_baseline/book.md` 前 20000 字）：

```
[纯标点漂移·零真实改动] _revise_drift_ratio 判 737/758 行 = 97.2%   ← 触发 scope_warning
[真·只改一行·标点不动]                        1/758 行 =  0.1%   ← 不触发
```

即：模型一个字没改、只把引号换成 ASCII，作者会收到「改动了约 97% 的原文，请逐块核对」，
噪音把真正的越界重写淹掉；接受后全篇标点被改写进正文。

## 落了两处（新增 `app/common/punctuation.py`，59 行纯函数）

| 处 | 改动 | 管什么 |
|---|---|---|
| `assistant/service.py` after 落地那一行 | 过 `restore_incidental_punctuation(before, after)` | 顺手漂移不写进正文 |
| `revise_scope.py::_revise_drift_ratio` | 比较前先 `canonical_punctuation` | 漂移不污染越界警告 |

两条修订链（agent loop `file.revise` / Ctrl+K 的 `/api/assistant/revise`）在 LLM 层汇合于
`assistant.service.revise_file_content`，故单点接线即全覆盖，且天然早于 `scope_warning`。

设计要点：
- 折叠**只收同一标点的不同 Unicode 形态**，刻意不收中英文标点互换（，↔, 。↔.）——那在
  中文正文里是该被作者看见的质量问题。
- 逐字符折叠不够：`……`/`——` 成对出现而模型常写成长度不同的 ASCII（`...` / `—` / `--`），
  故折叠后再把连续重复的 `.` `-` 空格 归并成一个。
- 对齐在**折叠后的行序列**上求 `SequenceMatcher` opcodes：`equal` 块取 before（还原），
  其余取 after（真实改动连同其标点原样保留）。`autojunk=False`——中文正文空行极多。
- 全文除标点外无改动时**不干预**（作者可能就是要统一引号形态）；此时 drift ratio 已折叠，
  不会误报，作者在 diff 面板自行判断。
- **粒度是行**：同一行既有真实改动又有漂移时整行取 after（漂移随改动一起可见）。闸保护的是
  未点名的行——「改一段却全篇标点被换」正是问题主体。

## 验证

```
cd apps/api && uv run pytest                -> 1384 passed, 3 skipped（零回归）
cd apps/api && uv run ruff check .          -> All checks passed
pnpm.cmd e2e                                -> 20/20（含 OpenAPI 零漂移）
git diff --numstat == --ignore-all-space --numstat -> 逐文件相等（纯 LF，无行尾噪音）
```

变异验证五点（★ 是关键的接线变异）：

| 变异 | 纯函数测试 | 接线测试 |
|---|---|---|
| M1 `equal` 块取 after 而非 before | 1 failed | 1 failed |
| M2 drift ratio 不折叠 | 2 failed | 9 passed（不涉及） |
| M3 折叠表清空 | 5 failed | 1 failed |
| M4 去掉重复归并 | 6 failed | 1 failed |
| **M5 拆掉 service.py 接线** ★ | **13 passed** | **1 failed** |

M5 正是「只测纯函数两次假绿」那个坑：拆掉接线后 13 条纯函数测试**全绿**，只有
`test_revise_reverts_incidental_punctuation_drift` 逮住。接线测试因此是必需的，别删。

## 仍未联通

- **真机没点过**：headless 用 monkeypatch 桩模拟模型输出，真机 Ctrl+K / file.revise 观感归 E2E-1。
- **没有真 LLM 实跑**：漂移形态取自对模型行为的推断 + golden 语料构造，不是抓到的真实输出样本。
  若真实漂移有表外形态（如中英标点互换、全角逗号），当前闸放行——这是刻意的保守边界。
- **同一行内混合漂移不还原**：见上「粒度是行」，属设计选择。
- opencode 那边真正值得抄的大件（System Context baseline 冻结 + mid-conversation delta、
  影子 git 仓快照、拒绝带意图通道、skill 渐进披露）本刀都没做，另记。

## 2026-08-01 前缀缓存两刀（opencode 大件清单 #1 System Context / Context Epoch）

借的是 opencode V2 `core/src/system-context/index.ts` 的两条立场：①每个上下文片段按
「变动频率」独立分层，稳定的逐字冻结在前；②片段状态是三态，`unavailable`（读不到）
与「读到空」不是一回事。落到本仓是两个可证伪的真缺陷。

### 先否掉一个诊断

此前记的「`system prompt` 每轮重拼，canon 一变就击穿 prompt cache」在 live 代码里
**不成立**。`loop_runtime.py:166-193` 的全部片段构建都在 `for` 循环（`:199`）之前，
循环体内对 `messages` 只有 5 次尾部 append（`:214/:261/:280/:339/:393`），零重写、
零截断、零重排；`_SYSTEM_PROMPT` 是模块级常量（`loop/prompt_context.py:19-66`），
无时间戳、无轮数、无 token 计数。**一次 run 内第 N 轮请求是第 N+1 轮的 100% 逐字节前缀。**
真正的漏在别处，即下面两条。

### 缺陷 1：provider 报的缓存命中从来没进过账

- `_token_usage`（`llm_client.py`）只读 `total/prompt/completion_tokens`，不读
  `prompt_cache_hit_tokens`（DeepSeek 一类）或 `prompt_tokens_details.cached_tokens`
  （OpenAI 一类）。
- `_cost_breakdown` 读了 `STORYFORGE_LLM_CACHE_HIT_INPUT_CNY_PER_M_TOKENS` 并原样回显，
  **却从不拿它算钱**——`input_cny` 只用 `input_rate`。
- 后果：命中部分按全价入账（多数 provider 命中价是全价的 1/10），且**没有任何观测手段
  能看出缓存是否命中**——「击穿」这个诊断在改动前根本没有度量支撑。

修法：新增 `_provider_cache_hit_tokens`（三态：`None`=这家没报 / `0`=报了且全未命中 /
`>0`=命中数），`_token_usage` 带出 `cache_hit_tokens`，`_cost_breakdown` 分段计
`input_cny = miss×input_rate + hit×cache_hit_rate`。两处刻意的保守取值：命中价未配置
（或配成非正数）时回退 `input_rate`；provider 没报时 `billed_hit=0`，算出的账与改动前
**逐位相同**。`_token_usage`/`_cost_breakdown` 是单点（三处调用全在 `llm_client.py` 内，
BookRun 侧 `book_generation_llm.py` 是 re-export 同一对象），改这两个函数即全覆盖。

### 缺陷 2：稳定大块排在对话历史之后，跨消息前缀缓存一次都覆盖不到

改动前 `messages` 顺序为 `[_SYSTEM_PROMPT, 作者指令, *history, book, plan, scene, pinned, view, user]`。
`history` 每条作者消息必增长（`loop/support.py:74-81` 滑窗末 12 条），于是作品底座 /
连载计划 / 场景约束这三个大块**每条消息都被整体推位**；两条消息的公共前缀止于
`history` 之前，只剩 `_SYSTEM_PROMPT`（实测 6056 UTF-8 字节）+ 作者指令块。

修法：把 book/plan/scene 提到 `*history` 之前。`pinned_block`/`view_block` 仍留在最靠近
提问处——那条近因理由（原 docstring）成立，未动。

### 门禁

```
uv run pytest        -> 1397 passed, 3 skipped（基线 1384，+13 为本刀新增，零回归）
uv run ruff check .  -> All checks passed
pnpm.cmd e2e         -> 20/20（含 OpenAPI 零漂移）
git diff --numstat == --ignore-all-space --numstat -> 逐文件相等（无行尾噪音）
```

`llm_client.py` 纯 LF、`loop_runtime.py` 纯 CRLF，两文件行尾各自保持不变（改动经脚本
按文件行尾施加，未用会归一行尾的编辑路径）。

### 变异验证（4 点，全部逮住）

| 变异 | 还原的行为 | 结果 |
|---|---|---|
| M1 | `*history` 排回 `book_block` 之前 | 转红 |
| M2 | `input_cny` 改回只用 `input_rate` | 转红 |
| M3 | `_provider_cache_hit_tokens` 读不到时返回 `0` 而非 `None`（三态塌陷） | 转红 |
| M4 | `_token_usage` 不再带出 `cache_hit_tokens`（拆接线） | 转红 |

M1 证明 `test_second_message_keeps_book_context_cacheable` 打在接线上：它比对两次真实
请求的 `messages` 公共前缀，顺序一错即失效。M3 单独列出是因为「读不到当成 0」正是
opencode 那条三态立场要防的塌陷，纯计价断言逮不住它。

### 仍未联通

- **没有真 LLM 实跑**：缓存命中字段的 wire 形态取自两家 provider 的公开文档形状，
  未在真 key 下抓过实际响应。若某家用了第三种字段名，当前按「没报」处理（降级安全，
  账与改动前一致），但会静默看不见命中。
- **省了多少钱未测量**：本刀能证明的是「公共前缀里含作品底座」这个确定性事实，
  不能宣称任何具体的成本下降幅度——那要真跑对比才算数。
- **`tools` 数组在 run 内变形仍会从最开头击穿缓存**：产出补丁后
  `_offered_schemas`（`loop_runtime.py:115-118`）剔除 4 个补丁工具（实测 tools JSON
  20560 → 17423 字节），末轮 / 预算耗尽时 `tools=None` 整段消失。这属于 opencode 清单
  第 7 条（一套 ruleset 同时驱动可见性与授权、阈值不对称：保留工具、调用时才拒）的范畴，
  本刀未做。
- **`book_block` 内部仍含跨消息易变内容**（当前打开第几章、上一章结尾 600 字），
  作者切文件即整块失效。按 opencode 的 Source 分片思想该再拆一层稳定 / 易变，未做。
- BookRun 侧 `book_generation_serial_metrics.py:20` 的 `context_cache_hit_rate` 是
  `(n-1)/n` 算出来的**自造指标**，与 provider 前缀缓存无关，本刀未动也未采信。

## 2026-08-01 拒绝 = 带意图的通道（opencode 大件清单 #2）

借的立场：拒绝框问的是「该怎么改」而不是「为什么拒绝」——前者朝向下一版，后者只是归档；
以及「人不该手动挑 hunk，人该说清楚哪儿不对」。

### 改动前的实际状态（三条，都可证伪）

1. `rejectPendingSuggestion`（`useSuggestionWriteback.ts`）只做两件事：清面板、弹 toast。
   **不发请求、不广播事件、不写任何记录。**
2. 后端对「作者拒绝」**零感知**。全仓 `apps/api/app/domains/{agent_runs,assistant,ide}` 下
   唯一含 reject 的符号是 `serial_plan_update.py` 的 `reject_premature_done`（与作者拒绝
   无关）。接受有回调（`plan.mark_written`，PR#261/#262），拒绝没有对应物。
3. 后果：run 的 approval 步**永远停在 waiting**——既不 completed 也不 failed，流程树上一直
   转着；作者「哪儿不对」的判断一个字都没留下，下一轮 prompt 里也没有任何痕迹。
4. 它还是全仓**唯一没有行为测试**的分支：`tests/patch-review-panel.test.tsx` 旧断言只有
   `assert.match(html, /拒绝/)`，改动前后都绿。

### 改后

- 点「拒绝」不再立即否掉，而是展开一个输入框问「说说该怎么改（回车发出，留空则只否掉这版）」。
- 方向非空 → 经 `PATCH_REJECTED_EVENT` 广播 → `useChatSubmission` 接住，用
  `buildRejectionPrompt` 拼成一句作者会说的话（**只给文件锚点 + 作者原话，不塞 before/after**——
  正文动辄数千字，塞进去会挤爆 12 条 × 4000 字符的历史窗口，而模型上一轮刚生成过它），
  走既有的 `handleComposerSubmit`。
- 复用而非新建：`handleComposerSubmit` 既进 UI 消息列表，也由后端
  `conversation_runtime.py:99-103` 落进 `assistant_messages`，于是自动进下一轮
  `_history_messages`（`loop/support.py:74-81`）。**后端一行代码都没改。**
- 方向留空 → 只广播、不发起新一轮：拒绝不该变得昂贵，也不该每次都烧一轮 BYO-key 去读
  一句「我没要」。
- `useAgentRunControls` 收尾那个永远挂 waiting 的 approval 步。**标 completed 而不是 failed**：
  这一步叫「等待作者确认」，作者给了答复它就完成了，哪怕答复是「不要」；agent 没出错。
- 拒绝这条路径仍然**一个字节都不写盘**（不快照、不写文件、不回调标 done），有专门断言钉死。

### 顺带修的两个真问题

- **`submitRejection` 抽出**：原实现发出后不清 `rejectDraft`，同一面板实例换下一个补丁时
  会留着上一条草稿。改为发出即收起。
- **monaco stub 缺 `updateOptions`**（`tests/stubs/monaco-editor.ts`）：`createDiffEditor()`
  返回的对象没有这个方法，而 `PatchReviewPanel` 挂载后会调它追平字号/字体。此前没有任何
  测试真正挂载过这个面板（都走 `renderToStaticMarkup`），所以一直没暴露。表现是 React root
  被打坏、整组交互用例报 `Should not already be working`。

### 门禁

```
npm run typecheck    -> 通过
npm run test         -> 522 passed（基线 509，+13 为本刀新增，零回归）
pnpm.cmd lint        -> eslint + prettier 全绿
pnpm.cmd e2e         -> 20/20（后端未改，OpenAPI 零漂移）
git diff --numstat ≈ --ignore-all-space --numstat（仅 useSuggestionWriteback 差 1 行，
  来自 useCallback 由单行改多行的真实缩进变化，非行尾噪音）
九个改动文件 CR 计数全为 0（源文件均为纯 LF，改动经脚本施加）
```

### 变异验证（6 点，全部逮住）

| 变异 | 还原的行为 | 结果 |
|---|---|---|
| M1 | 拒绝不再广播事件（拆接线） | 转红 |
| M2 | 空方向也发起新一轮 | 转红 |
| M3 | 点拒绝立即否掉，不问怎么改 | 转红 |
| M4 | 拆掉 approval 收尾监听 | 转红 |
| M5 | 拆掉会话守卫 | 转红 |
| M6 | 发出后不收起草稿 | 转红 |

M5 单列是因为 [[F26]] 那条教训：run 起跑会话 ≠ 当前活动会话时纯 `runId` 守卫不足，
切会话不改 runId。新监听器照抄了 `isRunResultForActiveSession` 守卫，M5 证明它是承重的。

### 仍未联通

- **真机未点穿**：整刀是前端交互 + 事件桥，没有在装机版里点过。「否掉 → 输入框 → 回车 →
  agent 真的按新说法重来」归 E2E-1。
- **拒绝仍不留后端审计痕迹**：`patch_id` 已经广播出去了，但没有 `patch.rejected` 命令把它
  写进事件表。后端持有同一 id（`events/contracts.py:9-27`），将来要对账是现成的。刻意不做：
  这一刀的价值在「意图进下一轮」，审计是另一件事。
- **per-hunk 仍只有接受、没有拒绝**：这是刻意保留的——上游的立场正是「人不该手动挑 hunk，
  人该说清楚哪儿不对」，作者可以在方向里直接说「第二处那段对话太生硬」。
- **作者的方向不带被否正文**：见上，是刻意的取舍。若实际使用中发现模型认不出「刚才那版」
  指的是什么，再考虑带上 hunk 级摘要。

## 2026-08-02 影子 Git 内容寻址作品版本（自带 MinGit）

### 落地边界

- Windows x64 包固定捆绑 `MinGit-2.55.0.3-64-bit.zip`，SHA-256 为
  `f48e2d2dc74a24454adc6d8fd0ac25bf9c2386f19cfb06202b9465aaad4f9f05`；构建脚本校验
  manifest、摘要、版本、架构、可执行文件和许可证，不搜索系统 `PATH`。
- Tauri 在 app-local data 中按 canonical project path SHA-256 建独立 `--git-dir`，作者项目仅作
  `--work-tree`；只执行 stage / `write-tree` / refs / read / gc，不执行 commit、checkout、reset。
- 新版本写入顺序固定为 `tree -> schema-v2 meta -> refs/storyforge/versions/<recordId>`；新记录不再
  复制正文，也不再截断 20 条。legacy `.snapshot.md` 与 tree-backed meta 双读。
- tree 捕获正文、作品档案、canon 真值、版本 meta、`branches.json` 和 author-loop 证据；排除
  `.git`、依赖、原子临时文件、`canon/derived` 与超过 2 MiB 的新增非作品文件。
- “文件不存在”是 `{ exists:false }`，恢复时二次确认并按
  `保存脏缓冲 -> shadow snapshot -> branch head -> deletePath -> plan.unmark -> drop tab` 执行，
  不再写空字符串冒充删除。
- 失效 tree/ref 的元数据仍留在时间线并禁用恢复。影子仓整体不可读时 legacy 版本仍可读；失效
  节点仍展示，但不能继续充当分支 parent/head，空支线回退到仍存活的分叉点。

### 本轮最终复验

```text
npm --prefix apps/desktop run test:git-bundle
  -> 5 passed
npm --prefix apps/desktop run verify:git-bundle
  -> git version 2.55.0.windows.3，摘要/许可证/runtime 校验通过
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml
  -> 28 passed
npm --prefix apps/desktop/frontend run test
  -> 82 files, 533 passed
npm --prefix apps/desktop/frontend run typecheck
  -> passed
pnpm.cmd lint
  -> ESLint + Prettier passed
```

最终增加的 3 条回归分别钉住：影子仓整体不可读仍保留时间线、失效版本不能成为 parent/head、
支线无可恢复节点时回退到存活分叉点。相关定向测试为 2 files / 21 passed。

### 实现阶段全仓与安装资源证据

```text
pnpm.cmd verify
  -> passed；API 1397 passed / 3 skipped，Ruff、daily sidecar、OpenAPI drift 均通过
pnpm.cmd e2e
  -> 20/20 passed
pnpm.cmd openapi
  -> passed，无 shared contract drift
pnpm.cmd smoke:sidecar:packaged
  -> passed
npm --prefix apps/desktop run verify:tauri-smoke
  -> passed；应用进程清空 PATH 后使用 resource Git 创建/保活/读取写前 tree
npm --prefix apps/desktop run verify:tauri-smoke:packaged
  -> passed；直接运行 release exe，应用进程 PATH 为空
npm --prefix apps/desktop run build
  -> Windows x64 MSI + NSIS 构建成功
```

- release runtime：366 个文件，93,882,909 bytes，`git version 2.55.0.windows.3`。
- NSIS：`StoryForge IDE_0.1.10_x64-setup.exe`，77,912,148 bytes。
- MSI：`StoryForge IDE_0.1.10_x64_en-US.msi`，94,470,599 bytes。
- 生成的 `installer.nsi` 明确安装并卸载
  `resources/mingit/manifest.json`、`runtime/LICENSE.txt`、`runtime/cmd/git.exe`。
- Rust 集成测试对作者 `.git` 做递归 byte digest，影子快照前后摘要一致；同时覆盖非 Git/已有
  Git、alternates/index seed、seed 失败回退、中文路径、CRLF、并发锁、排除、refs 与 gc。
- `rustfmt --check` 对 `shadow_git.rs`、`shadow_git/core.rs`、`shadow_git/tests.rs` 通过；全 crate
  `cargo fmt --check` 仍报告未触碰的 `fs.rs` / `llm_config.rs` 既有格式基线，本任务未扩散改写。

### 未验证与不能宣称

- **未实际静默安装/卸载 NSIS**。当前安装证据是 release resource-layout 冒烟、安装包成功生成，
  以及生成的 NSIS `File` / `Delete` 指令；不能写成真实安装目录和卸载残留已手工验收。
- **未对真实 StoryForge 仓执行 shadow snapshot dogfood**。作者 `.git` 不变由隔离 Rust fixture
  的 byte digest 测试证明；没有把测试 fixture 夸大为真实工程手工验收。
- **没有交付整项目一键恢复 UI**。tree 已包含作品版本记录、分支选择和作品状态，可作为后续整
  项目 diff/确认恢复的数据底座；本任务只接通现有按文件版本历史/分支画布。
- **没有宣称真机 GUI 多轮补丁确认完全验收**。本次是 deterministic Tauri smoke 与 release exe
  冒烟，不等同于人工点击装机版全链路。

## 2026-08-02 影子 Git 完成态审计：真安装、真实仓与 smoke 全身份隔离

本节是对上一节两个未验证项的后续完成证据。上一节的「未实际安装/卸载 NSIS」和「未对真实
StoryForge 仓 dogfood」在本节均已关闭；项目级一键恢复整个作品的 UI 仍保持原定 out of scope。

### 审计中发现并修复的真实问题

1. Tauri release 资源路径可能是 `\\?\D:\...`。MinGit 不接受
   `GIT_TEMPLATE_DIR=\\?\...`，导致已安装 exe 的 `git init` exit 128。修复仅在 bundled Git
   环境边界去除 verbatim 前缀，项目 canonical path 与分桶身份保持不变。
2. 既有 Tauri smoke 与当前欢迎页、活动栏、补丁二次拒绝、toast 状态契约已经漂移。Rust smoke
   和浏览器 smoke 已同步到当前 UI，并继续断言确认前不写盘、确认后 tree/ref/read 成立。
3. 初版安装 harness 只按目录存在判断卸载保留数据，且 shortcut cleanup 可递归删除未预检的同名
   目录。现改为完整 shadow tree digest 前后相等、Known Folder 桌面、配置目录预检、精确快捷方式
   删除和仅空目录删除。
4. 初版 smoke 继承 8000 端口和生产 identifier 数据面，可能终止既有 sidecar、写生产 SQLite/config、
   shadow Git 与 WebView localStorage，或被 single-instance 正常退出 0 假绿。现使用临时 API 端口、
   强制 local/config/WebView 隔离目录、smoke 禁止替换既有 API、smoke 禁用 single-instance，并要求
   `storyforge-smoke-isolation-v1` 和真实 result marker。
5. packaged smoke 过去可直接运行陈旧 release exe，安装态 `--executable` 也曾绕过协议预检。标准
   packaged 命令现先执行 current release no-bundle build；release 与显式 installed executable 统一在
   启动前扫描隔离协议，不具备能力的旧 exe 不会被执行。
6. 已有 Git 的 alternates 有断言，但兼容 index 成功复制没有直接行为证据。新增测试 seam 在 staging
   前比较 source/shadow index bytes，并再次比较作者 `.git` 完整摘要。
7. 初版 existing-Git 快照把作者 objects 永久留在 `alternates`，作者删除/移动 `.git` 后记录版本会
   丢 blob。现把 alternates 限定为初始化加速：tree 写出后以临时内部 ref + `repack -a -d` 物化全部
   可达对象，移除 alternates 并做 connectivity 校验；回归会移走作者 `.git`、执行 prune=now 后再读。
8. `.storyforge` 的 force-add 曾把内部 `.*.tmp-*`、嵌套 `node_modules` / `.pnpm-store` 重新带进
   tree。现只覆盖作者 `.gitignore`，force-add 后重新应用 StoryForge 托管排除，并有内部路径红绿回归。
9. release smoke 压力复跑曾出现一次接受事件丢失，失败出口又先 `process::exit`，遗留 sidecar 并锁住
   SQLite。接受动作现点击真实 UI 按钮；所有 probe 失败统一恢复 PATH、停服务、删 exact owned 临时项目，Node 在
   Windows 同步等待 taskkill。强制失败探针证明无 EBUSY/AggregateError/残留进程或目录，随后 10 次
   current release 写回连续通过。
10. 仅从 `ls-files --ignored` 删除托管垃圾仍会被作者 `.gitignore` 的 `!` negation 绕过，因为
    `info/exclude` 优先级更低。现从完整 cached index 硬过滤依赖、atomic temp、derived 和本轮大文件；
    行为回归显式反忽略全部路径，仍逐项证明不进入 tree。
11. probe 内失败清理收口后，sidecar 已启动但 main window/setup 失败，以及临时项目创建一半失败，
    仍在 cleanup 所有权之外。setup 现统一 shutdown；临时项目先以 `create_dir(root)` 独占所有权，
    预存 root 不复用/不删除、无宽前缀清理，取得所有权后的半建失败自行回滚；Node 对
    仍存活的进程树同步 `taskkill /T`、跳过可能已复用的退出 PID，并等待隔离 API 不可达。
12. 对象物化增加了写回耗时，原 release smoke 的 6 秒终态等待可在真实 `plan.mark_written` 已发出时
    抢先超时。现仅把真实接受后的终态预算扩至 20 秒，仍要求成功 toast 和写后正文；当前 release 与
    installed smoke 均通过。
13. `.storyforge` 被作者 ignore 时，普通 untracked 稳定性检查看不到 staging 后并发新增文件；Windows
    托管排除又曾大小写敏感。现额外无 ignore 枚举 `.storyforge`，Windows 路径 ASCII case-fold，且
    `node_modules` / `.pnpm-store` 只按目录组件排除；三条回归分别钉住并发新增、case variant 与普通同名文件。
14. PyInstaller `--onefile` sidecar 是 bootloader + API 子进程树，`CommandChild::kill()` 只杀根进程；
    随机端口实证中 API 子进程仍返回 200。Windows shutdown 现于根存活时先 `taskkill /T /F`，失败才
    fallback 到句柄 kill；最新 setup/probe 强制失败均在 API 已就绪后收敛到 process/data/project=0。
15. API stop 单次 fetch timeout 曾被误判为 unreachable，response body cancel 失败也会推翻已收到响应，
    signal exit 则被 `code ?? 0` 当成功。现 timeout/abort 保守视为未知、body cancel 为 best-effort、signal
    明确失败，只有总 stop wait 成功才删除 data root；Node 行为回归全部直接覆盖。
16. 最终证据复审发现 canonical bucket、v2 meta 关联字段和 alternates/index 各阶段 fallback 的断言过宽。
    新增精确 64-hex SHA-256 + alias 稳定性、全部 meta 关联字段 + 无正文副本、alternates 写入/index 复制
    两处 fault injection；报告矩阵不再用间接 containment 或单一坏 index 代替这些要求。

### 原任务 R1-R16 直接证据矩阵

| Requirement | 直接证据 | 结果 |
| --- | --- | --- |
| R1 独立 git-dir 与 canonical SHA-256 分桶 | Rust `repository_path_uses_stable_canonical_sha256_bucket` 精确断言 canonical key 的 64 位 lowercase SHA-256 路径与 `.` alias 同桶；真实仓 dogfood/三档 marker 断言 repo 位于隔离 data root 且不在工作树 | 通过 |
| R2 不修改作者 `.git` | `existing_git_repository_is_read_only_and_materializes_borrowed_objects`、`existing_git_repository_copies_source_index_seed_without_mutation`、seed/fallback fault tests；真实仓 dogfood 前后 digest | 通过，真实仓 digest `ec932093657b015f3909121d7b95635d8284f2545d94bc5bff3c2cdd22c01982` |
| R3 完整工作树与排除矩阵 | `snapshots_non_git_worktree_and_preserves_story_state` 逐项读取作品状态并逐项拒绝 `.git`、内外 atomic temp、derived、内外 dependency、large file；`force_includes_storyforge_even_when_author_gitignore_excludes_it`；`managed_excludes_override_author_gitignore_negations` | 通过，作者 negation 不能覆盖托管硬排除 |
| R4 existing Git alternates/index 与 fallback | `existing_git_repository_copies_source_index_seed_without_mutation` 直接比较 alternates/index；`alternates_or_index_seed_failures_fall_back_to_complete_snapshot` 分别注入 alternates write/index copy 失败；坏 seed 自动 fallback；对象物化测试移走作者 `.git` 后 GC/read | 通过 |
| R5 快照失败阻断正文写回 | frontend `tree, metadata, or retain failures reject...`、`快照失败阻断写盘`、`自动档下快照失败仍然阻断写盘` | 通过 |
| R6 tree hash 与版本元数据关联 | `new snapshots write only v2 metadata and retain the tree before returning` 逐项断言 tree/record/source/summary/file/patch/session/issues/context/parent/branch/run/created、写入/retain 顺序和无正文副本 | 通过 |
| R7 存在/不存在/删除三态 | Rust snapshot/read；frontend `created metadata still distinguishes...`、`legacy created snapshots restore as missing...` | 通过 |
| R8 恢复仍受确认、原子写与页签保护 | mounted writeback/restore tests，含「撤销新建是删文件并摘页签，不是写空文件」及失败保持页签/plan | 通过 |
| R9 legacy 与 v2 双读 | `legacy and v2 entries share one timeline and one structured reader`；repository failure 仍保留 legacy | 通过 |
| R10 refs 保活与 GC | Rust `retains_tree_through_gc_and_filters_only_live_refs` 对 retained tree 和 orphan tree 执行 `gc --prune=now`；source-Git 自包含回归移走作者对象库后再 GC/read | 通过 |
| R11 Windows/中文/长路径/CRLF/空项目/两类 Git 项目 | Rust `snapshots_empty_worktree_and_reads_windows_long_paths`、中文路径和 CRLF read、non-Git/source-Git tests | 通过 |
| R12 dev/installed 均只用受控 Git | dev/release/installed Tauri smoke 清空应用 PATH，marker 中 Git 均位于各自 resource 目录，版本固定 2.55.0 | 通过 |
| R13 供应链与明确失败 | MinGit Node tests 覆盖 SHA/cache/exe/version/license/arch；Rust 覆盖 missing runtime、坏输入和 verbatim resource 回归 | 通过 |
| R14 仅承诺 Windows x64 NSIS | manifest、host guard、overlay 和真安装探针都固定 win32/x64；未扩大其他平台声明 | 通过，范围限制保留 |
| R15 作品级 `.storyforge` 状态 | Rust 直接读取 book/cover/instructions/canon/versions/branches/plan/notes/author-loop，拒绝 canon/derived 与 `.storyforge` 内 atomic temp/dependency cache | 通过 |
| R16 meta/ref 任一步失败均阻断且无半记录 | frontend failure injection 覆盖 tree、meta disk full、update-ref；断言 release/delete meta、无 retain/writeback 成功 | 通过 |

### 原任务 16 条 Acceptance Criteria

| # | 验收项 | 直接证据与结论 |
| --- | --- | --- |
| AC1 | git-dir 在工作树外且作者 `.git` 不变 | fixture + 真实仓 dogfood 均通过 |
| AC2 | 相同 tree 稳定、正文变化 tree 改变 | Rust non-Git snapshot test 通过 |
| AC3 | existing Git 复用 alternates/index，失败 fallback | alternates/index bytes、alternates write fault、index copy fault、损坏 index staging fallback、借用对象物化并脱离作者 `.git` 均通过 |
| AC4 | non-Git 项目可快照 | Rust non-Git/empty worktree 通过 |
| AC5 | 快照失败阻断 write_file/F27 | frontend guarded writeback tests 通过 |
| AC6 | 从 tree 读取指定文件并预览 | Rust read + frontend structured reader + Tauri retained pre-write read 通过 |
| AC7 | 新建前恢复为删除，普通恢复为正文 | mounted auto-writeback/restore tests 通过 |
| AC8 | legacy/v2 同时列出与恢复 | versions checkpoint dual-read test 通过 |
| AC9 | tree 含 branches/meta/canon/book/author-loop，排除 derived | Rust 完整包含/排除矩阵通过，含 `.storyforge` 内托管 temp/dependency 排除 |
| AC10 | ref tree 经 prune=now 存活，orphan 被清理 | Rust GC 回归通过 |
| AC11 | 清 PATH 的安装态仍能创建/读取/恢复 | 真安装 exe 完成 proposed patch、tree/meta/ref/read；恢复语义由同一 frontend reader/writeback 测试覆盖 |
| AC12 | Git 版本与 executable path 均为 bundled | 三档 Tauri marker 与安装 resource 校验通过 |
| AC13 | 版本/arch/SHA/license 缺失失败 | `prepare-bundled-git.test.mjs` 7 项相关回归通过 |
| AC14 | meta/ref 失败不写盘、不返回成功记录 | frontend failure matrix 通过 |
| AC15 | 行为覆盖 create/modify/delete/中文/non-Git/existing Git/missing Git/seed failure/legacy | Rust + frontend 组合覆盖通过 |
| AC16 | frontend、Rust、typecheck、lint、verify、e2e | 全部通过，命令汇总见下 |

### 当前完成态任务验收

| 当前任务要求 | 完成证据 |
| --- | --- |
| R1 逐条证据矩阵 | 上述 R1-R16 与 AC1-AC16 均指向行为测试或 runtime probe，无“脚本存在即通过”替代 |
| R2 真实 StoryForge dogfood | tree `632e075387693c8e7a06b6c777c157fb08c81b43` 可读/保活/gc 后可读且对象已本地物化；`.git` digest `ec932093657b015f3909121d7b95635d8284f2545d94bc5bff3c2cdd22c01982` 前后相同；temp data 删除 |
| R3 隔离 NSIS 真安装 | 独立 product/identifier 真安装，installed exe smoke，真卸载，local shadow 数据卸载前后 digest 相同，最终测试 identity 全清 |
| R4 缺失边界回归 | 空项目、长路径、canonical bucket、完整状态、内部托管排除/case/并发新增、作者 negation、orphan GC、alternates/index fault、坏 seed、对象物化、完整 meta、半建/预存 smoke root、license/arch/verbatim resource 均有回归 |
| R5 审计缺陷保持红线 | 修复只改 bundled Git/smoke/installer 边界；无系统 Git fallback，无作者 `.git` 写入或持久依赖，无确认前正文写盘；PyInstaller tree-kill、timeout/abort/body-cancel/signal 分支均 fail-closed，强制 smoke 失败无残留 |
| R6 规范与报告 | `.trellis/spec/desktop/frontend/quality-guidelines.md` 与本报告已同步；整项目恢复 UI 继续 out of scope |

### 最终命令与结果

```text
npm --prefix apps/desktop run test:nsis-install
  -> 17 passed（含 runProcess signal-exit 与 settleSmokeCleanup stop-wait 失败编排回归）
npm --prefix apps/desktop run test:git-bundle
  -> 7 passed（含 license/arch）
npm --prefix apps/desktop/frontend run test
  -> 82 files / 533 passed
npm --prefix apps/desktop/frontend run typecheck
  -> passed
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml -- --nocapture
  -> 39 passed / 1 ignored（真实仓 probe 单独运行）
cargo test ... dogfoods_real_storyforge... -- --ignored --nocapture
  -> 1 passed
cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml
  -> passed
pnpm.cmd verify
  -> passed；API 1397 passed / 3 skipped；Desktop 533；project-core 7；Ruff/daily sidecar/OpenAPI drift passed
pnpm.cmd e2e
  -> 20/20 passed，OpenAPI 无漂移
npm --prefix apps/desktop run verify:tauri-smoke
  -> development smoke passed；临时 API/data/config/WebView；生产四份摘要前后相同
npm --prefix apps/desktop run verify:tauri-smoke:packaged
  -> current release no-bundle build + capability preflight + release smoke passed
STORYFORGE_DESKTOP_SMOKE_FORCE_FAILURE=1 + current release verifier
  -> expected exit 1；API 曾返回 200；新增 data/project root=0；新增 repo sidecar PID=0
STORYFORGE_DESKTOP_SMOKE_FORCE_SETUP_FAILURE=1 + current release verifier
  -> sidecar ready 后 expected exit 1；Windows tree-kill；API/process/temp root=0
pnpm.cmd smoke:sidecar:packaged
  -> passed；ready 7342ms，assistant/SSE/control/alembic/prompt bundled 全绿
npm --prefix apps/desktop run verify:nsis-install
  -> explicit executable capability preflight + isolated NSIS install/run/uninstall passed
git diff --check
  -> passed
```

### 真安装、生产保护与真实仓摘要

- Installer：`apps/desktop/.tauri-target-install-smoke/release/bundle/nsis/StoryForge Shadow Git Install Smoke_0.1.10_x64-setup.exe`。
- Installed Git：`git version 2.55.0.windows.3`；实际 executable 为安装资源目录下的 verbatim
  Windows path，已成功完成 `git init`、snapshot、retain 和 read。
- 卸载前后 shadow data digest：
  `ecfc0dc068c56a81c7a416ad29d02b029e2a0174e0a0e3882cf2412321217c60`，逐字节 tree 摘要相同。
- 卸载后：测试 install/local-data/config/registry/shortcut/process 全部为 0。
- 生产安装 tree digest 前后均为
  `a148760e043f37c9153d05f3f66a3e81c7bf4474cd20207fdb234f7ac4415fd2`。
- 生产 installed exe 仍为 15,629,312 bytes，SHA-256
  `2713983407B327457A7DD9697D480F8612D2E71D74D119260B1F28AA379FBFCE`，卸载键仍存在。
- dev/release smoke 前后生产 SQLite SHA-256 均为
  `CE5C274D797F1511293F03ADE7F4058AA0B5CC46E25358233E31AD1DE94FF12D`；生产 LLM config SHA-256
  均为 `F2BF579D2796AF310B8BDCDE5C6CBE11C196D215B3FF07AFDC11B7E463C0B4E0`；生产 shadow Git
  目录仍不存在；WebView tree digest 均为
  `790d0848e1883afdf1a15abb504b783365e63d05b4bede9ae9cccf795df53841`。
- 真实 `D:\StoryForge` dogfood：tree
  `632e075387693c8e7a06b6c777c157fb08c81b43`，作者 `.git` digest 前后均为
  `ec932093657b015f3909121d7b95635d8284f2545d94bc5bff3c2cdd22c01982`，临时 data root 已删除。

### 仍然不能宣称

- 没有交付「正文 + 版本记录 + 分支选择」的一键整项目恢复 UI。当前 tree 已完整保存这些作品状态，
  现有 UI 仍是按文件版本历史和分支画布；项目级 diff/确认恢复入口属于后续任务。
- 没有验收 macOS、Linux、Windows arm64 或 32 位 Git 包。
- deterministic dev/release/installed Tauri smoke 真实运行了 WebView 和补丁确认链，但不等于作者人工
  通读或真机多轮 GUI 体验验收；不能据此宣称生产级长篇闭环。

---

## 2026-08-03 旧任务与写回权限契约收口

### 结论

- `07-24-chat-ux-polish`：PRD 验收全勾，提交 `67c6af50` 与 Chat UX 行为测试可追溯；已归档为
  `completed`，`completedAt=2026-08-03`。
- `07-24-editor-patch-ux`：PRD 验收全勾，提交 `06c57254` 与 Patch Review 行为测试可追溯；已归档为
  `completed`，`completedAt=2026-08-03`。
- `07-31-trusted-writing-context`：PRD 验收全勾，提交 `0fc26735`、API sentinel/伪造防护/provenance
  测试与 frontend 投影测试可追溯；已归档为 `completed`，`completedAt=2026-08-03`。
- 父任务 `07-30-project-optimization-review` 保持 `planning`，`children` 仍为
  `07-31-trusted-writing-context` / `07-31-agent-permission-policy`，Trellis 显示 `2/2 done`；父任务自身
  未完成的作者通读、Chapter Writing Module 等范围未被误归档。

### 写回权限契约

用户独立决定保留项目级四档权限：`read` 禁止写类补丁，`ask` 必须停在最终 diff 确认，`auto` /
`full` 仅在作者对当前项目显式选择后可免逐次点击，且只有 `full` 额外免除长任务二次确认。任何档位下
后端都只产出 proposed patch；实际落盘仍必须经过 Desktop `performGuardedWriteback`、漂移拒写、项目
边界、派生目录只读、写前快照、版本与 author-loop 记录。

已同步根 `AGENTS.md`、`CONTEXT.md`、`CLAUDE.md`、`docs/architecture/ide-first-product-direction.md`、
`docs/internal/current-phase.md`、`docs/internal/TODO.md`、backend quality spec 与仍在规划中的父任务 PRD。
事实源契约测试也从旧短语断言改为验证 `ask`、`auto/full` 与 guarded writeback 三条边界。

### 验证

```text
npm.cmd --prefix apps/desktop/frontend run test -- <7 focused files>
  -> 7 files / 76 passed
npm.cmd --prefix apps/desktop/frontend run typecheck
  -> passed
uv run pytest tests/test_agent_llm_context.py tests/test_agent_loop_writing_context.py
  tests/test_agent_permission_policy.py tests/test_agent_loop_permission_writeback.py -q
  -> 46 passed
uv run ruff check <affected agent context/permission paths>
  -> All checks passed
uv run pytest tests/test_phase9_fact_sources.py -q
  -> 14 passed
uv run ruff check tests/test_phase9_fact_sources.py
  -> All checks passed
pnpm.cmd verify
  -> passed
  -> root lint/Prettier passed
  -> Desktop typecheck passed; Vitest 82 files / 533 passed
  -> project-core 7 passed; shared typecheck passed
  -> API 1397 passed / 3 skipped; Ruff passed
  -> sidecar daily smoke passed
  -> OpenAPI / Agent WS regenerated by drift gate; no drift
git diff --check
  -> passed
```

首轮 `pnpm.cmd verify` 的唯一失败是 `test_phase9_fact_sources.py` 仍断言旧短语
`确认写回防重复生成`；更新为三条权限边界断言后，定向测试与第二轮总门禁均通过。最初两条 Desktop
命令使用 `npm` 时被 PowerShell execution policy 拦截，按仓库 Windows 约定改为 `npm.cmd` 后通过，
不属于测试失败。

本轮未修改路由、DTO、Agent WS schema 或 OpenAPI 形状，无需人工刷新 contract；总门禁仍执行了生成与
drift 检查并确认零漂移。

### 归档异常与未验证项

- 可信上下文目录在归档区存在一份同名 `in_progress` 旧副本。源/副本 8 个文件的文件名与 SHA-256
  全量一致；移除冗余副本后，Trellis 的 Python `shutil.move` 仍在复制后删除源 `check.jsonl` 时遭遇
  Windows `Access denied`。文件同目录重命名往返成功，故使用等价回退：`apply_patch` 写入 completed
  状态，再用 PowerShell `Move-Item` 原子移动目录。归档后任务列表、父子引用与当前任务指针均复核正确。
- 未运行可信上下文任务遗留的真机 Desktop suggestion -> author-loop -> diff 点击链；不能宣称该 GUI
  链已验收。
- 未运行 `auto/full` 真机“改档 -> 自动落盘 -> 撤销 -> 重启后档位仍在”链路；现有证据是挂载行为测试、
  全量 Vitest、API policy/loop 测试与 guarded writeback 既有真机基线，不能替代该手工验收。

---

## 2026-08-03 受控 Project Knowledge 发现与追踪

范围：`.trellis/tasks/08-03-project-knowledge`。新增受控 `project.knowledge` 单一 action 工具、
Backend 资格策略与安全 trace；Desktop 新增 `knowledge` 语义、安全索引和按项目本机选择。未实现
Chapter Writing Module、会话压缩、新 route/DB/manifest，也未改变 proposed patch 或 guarded
writeback 边界。

行为结论：

- `.资料`、常规创作资料目录与五个作者所有 `.storyforge` 文件可发现；未知点目录、derived、
  versions、config/cache/log/db、敏感文件名、二进制和 512 KiB 以上文件失败关闭。
- 普通 `fs.list/search` 不放开隐藏目录；`fs.read` 仅保留既有 agent-instructions 豁免，其余隐藏
  knowledge 只能走 `project.knowledge`。读取与搜索内容脱敏，trace 不含正文、excerpt、绝对根或 secret。
- Book context 只给 Project Knowledge 路径/类型/体量，不再暴露 derived dossier 指针。
- knowledge 不自动进入 context；作者显式选择后才复用可信 snapshot -> inner draft/revise ->
  request-bundle provenance 链。存储路径必须先通过当前安全索引才恢复，陈旧项只显示 missing 并被清退；
  普通临时 pin 不持久化。

验证：

```text
API 定向 + source standards                    -> 99 passed, 1 skipped
Desktop 定向                                  -> 5 files / 30 passed
API 全量 pytest                               -> 1406 passed, 4 skipped
Desktop 全量 Vitest                           -> 82 files / 537 passed
Desktop typecheck                             -> passed
API Ruff                                      -> passed
pnpm.cmd openapi                              -> generated successfully; no tracked contract drift
pnpm.cmd verify                               -> passed
  root ESLint/Prettier                        -> passed
  shared typecheck / project-core             -> passed / 7 passed
  API pytest / Desktop Vitest                  -> 1406 passed, 4 skipped / 537 passed
  sidecar daily smoke                         -> passed
  OpenAPI + Agent frame drift                 -> no drift
git diff --check                              -> passed
```

契约判断：ToolSpec loop schema golden 新增 `project_knowledge` 是预期 drift；HTTP OpenAPI、Agent frame
schema 与 generated client types 均零 drift。`.trellis/spec/storyforge-api/backend/project-knowledge.md`
已记录七段跨层可执行契约，并由 API/Desktop 两个 spec index 共同引用。

未验证：未在真机 Tauri 中手动点穿“选择知识 -> 切会话/重启 -> 发起写章 -> 查看 diff”；未调用真实
provider，也未做章节质量人工通读。因此不能宣称真机 GUI 写回链或生产级长篇质量验收通过。

### 2026-08-04 渐进式 Project Knowledge 完整链路

在基础发现面之上完成结构化 Markdown v1、`knowledge.propose` durable artifact/event、项目级 Inbox、
强制确认单文件 patch、guarded writeback/reconciliation、冲突与四态生命周期、来源漂移、active retrieval
以及 entry 级安全 provenance。作者编辑只替换未决 proposal；同组 accepted/rejected 历史不会重新变成
pending。冲突 typed API 动态读取当前 Markdown 的旧 claim/source，通用 event/artifact/trace 不含 claim。

最终验证：

```text
pnpm.cmd verify
  -> passed
  -> root ESLint/Prettier passed
  -> Desktop typecheck passed; Vitest 84 files / 546 passed
  -> shared typecheck passed; project-core 7 passed
  -> API 1432 passed / 4 skipped; Ruff passed
  -> sidecar daily smoke passed
  -> OpenAPI / Agent frame regenerated; no drift
git diff --check
  -> passed
focused knowledge/provenance/lifecycle checks
  -> API 33 passed; Desktop Inbox 4 passed; provenance UI 15 passed
Playwright browser visual check
  -> 1280x800 and 390x844: Inbox tabs/badge/empty state fit
  -> conflict old/new claims + sources, decision gate, inline editor fit without overlap
```

首次浏览器检查因普通 Vite 页面没有 Tauri `invoke`，样例项目创建按预期不可用；随后只使用仓库自带
`__STORYFORGE_MOCK_FS__` 和浏览器层 typed Inbox response 做组件视觉检查。它不等同于真机 Tauri。

仍未验证：真机 Desktop 的 proposal -> edit -> materialize -> explicit confirm -> snapshot -> guarded writeback
-> restart recovery -> active retrieval 全链；严格并发 materialize 压测；真实 provider 与人工长篇质量通读。
因此不能宣称真机 GUI 写回链、稳定生产级长篇闭环或人工质量验收通过。

### 2026-08-04 Chapter Writing Module（brief → draft → check → proposed patch）

本轮新增 Desktop 对话显式 `chapter.write`：Chapter Brief 卡片确认、可信上下文快照、一次 repair/recheck
硬门禁、单一 proposed patch，以及 pending resume / F10 断流重建。后端只产补丁，未写项目正文；pending 与
permission 事件不携带绝对项目根路径。

验证：

```text
API chapter writing + resume + contract + runtime tool checks -> 41 passed
API source standards / Ruff                              -> 16 passed / passed
Desktop typecheck                                        -> passed
Desktop Vitest                                           -> 85 files / 549 passed
API full pytest                                          -> 1439 passed / 4 skipped
pnpm verify                                              -> passed
  root ESLint/Prettier                                   -> passed
  shared typecheck / project-core                        -> passed / 7 passed
  Desktop typecheck / Vitest                             -> passed / 85 files, 549 passed
  API pytest / Ruff                                      -> 1439 passed, 4 skipped / passed
  sidecar daily smoke                                    -> passed
  OpenAPI / Agent frame drift                            -> no drift
git diff --check                                          -> passed
```

根门禁首轮先发现两个局部收尾问题：Chapter Brief 文件未格式化，以及 `useRunAuthorAgent` callback
遗漏 `setChapterBrief` 依赖；修复后又触发该文件 503 行超过 500 行硬限制。删除三处纯空行后，source
standards 16 项与第二轮完整 `pnpm verify` 均通过。

未验证：未调用真实 provider，未在真机 Tauri 手动点穿 Brief -> diff -> guarded writeback；未做章节人工通读或
真实长程质量验收。会话压缩第一阶段尚未实现。上述证据不支持宣称真机 GUI 写回链或生产级长篇质量闭环。

### 2026-08-04 会话压缩第一阶段（真实运行时回注）

现有 deterministic `system_compaction` hidden artifact 已接入下一轮 live loop。artifact 记录 schema、完成状态
和被压缩前缀的最后一条 assistant message ID；读取端只接受当前 assistant session 最新且边界可验证的
artifact，注入一条历史摘要 system message 后再附未覆盖的 user/assistant 原始尾部。旧 schema、坏游标、
跨会话 artifact、查询异常或超过尾部预算时均 fail-open 回退最近 12 条原始消息。

验证：

```text
API compaction + transport + loop focused tests          -> 32 passed
API source standards                                     -> 16 passed
最终定向 compaction/transport/source 回归                 -> 20 passed
API full pytest                                           -> 1442 passed, 4 skipped
API Ruff                                                  -> passed
git diff --check                                          -> passed
pnpm.cmd verify                                           -> passed
  root ESLint/Prettier                                    -> passed
  Desktop typecheck / Vitest                              -> passed / 85 files, 549 passed
  shared typecheck / project-core                         -> passed / 7 passed
  API pytest / Ruff                                       -> 1442 passed, 4 skipped / passed
  sidecar daily smoke                                     -> passed
  OpenAPI / Agent frame drift                             -> no drift
```

未验证：未调用真实 provider，也未评估确定性摘要的事实召回质量。本轮没有引入结构化 provider 摘要、
token/cost 归因、baseline/delta/baseline_seq 或完整 Context Epoch，因此不能宣称高质量长上下文压缩或
生产级 Context Epoch 已完成。

### 2026-08-04 Provider SDK 基础

新增内部 `app/platform/ai_sdk`：provider-neutral message/request/response/tool-call/stream/usage/error/
health/capability contract、同步 `LLMProvider` protocol、deterministic provider 和 OpenAI-compatible typed
adapter。`app/common/llm_client.py` 保留全部既有 facade/monkeypatch seam，将非流式与流式结果通过 typed
adapter 往返投影；成本、latency、中文 `LLMError`、reasoning 清理和旧 dict shape 保持兼容。

定向回归首次发现旧工具 schema 未带 `description` 时 typed round-trip 自动补空字符串；修复为记录字段
是否原本存在，禁止 adapter 发明可选 wire 字段，并新增精确回归。SDK import-boundary 测试禁止生产模块
依赖 FastAPI、SQLAlchemy、`app.domains`、Desktop/Tauri 或小说领域类型。

验证：

```text
SDK contracts / OpenAI-compatible tests                 -> 10 passed
LLM channel + assistant stream + retry compatibility    -> 66 passed
BookRun/judge/usage representative callers              -> 35 passed
source code standards                                   -> 16 passed
targeted Ruff                                            -> passed
pnpm.cmd verify                                          -> passed
  root ESLint/Prettier                                   -> passed
  Desktop typecheck / Vitest                             -> passed / 85 files, 549 passed
  shared typecheck / project-core                        -> passed / 7 passed
  API pytest / Ruff                                      -> 1452 passed, 4 skipped / passed
  sidecar daily smoke                                    -> passed
  OpenAPI / Agent frame drift                            -> no drift
git diff --check                                         -> passed
```

未验证：未调用真实 provider；Anthropic、Gemini、完整 capability matrix、ToolCallingRuntime 和 live loop
内核迁移属于后续子任务。本切片不支持据此宣称多 provider 已完成或 SDK 已具备独立发布稳定性。

### 2026-08-05 多 Provider 与能力矩阵

内部 SDK 新增 Anthropic/Gemini native adapter，统一 messages/parts、tool use/function call、流式事件、usage、
finish reason 和安全错误分类。capability resolution 固定 `configured > probed > static > fallback`，未知模型能力
保持 `None`。DeterministicProvider 支持脚本化 response/stream/fault 和显式耗尽错误。

thinking 工具调用的原生签名通过不可变 `ProviderContinuation` 保存；Runtime 后续只需调用
`ChatResponse.to_assistant_message()` 原样传递，不需要 Provider 分支，且 continuation 不进入持久化证据。
真实 smoke 为独立显式 opt-in 脚本，默认不出网，输出不含正文、key、认证头或原始响应。

验证：

```text
SDK focused contracts/wire/error/smoke tests             -> 38 passed
LLM/provider/usage/source compatibility regression       -> 96 passed
targeted Ruff                                            -> passed
opt-in smoke default gate                                -> skipped as designed, zero network
pnpm.cmd verify                                          -> passed
  root ESLint/Prettier                                   -> passed
  Desktop typecheck / Vitest                             -> passed / 85 files, 549 passed
  shared typecheck / project-core                        -> passed / 7 passed
  API pytest / Ruff                                      -> 1480 passed, 4 skipped / passed
  sidecar daily smoke                                    -> passed
  OpenAPI / Agent frame drift                            -> no drift
git diff --check                                         -> passed
```

未验证：没有提供真实 Provider key，因此未执行 Anthropic/Gemini/OpenAI-compatible 的真实 complete/stream/tool
smoke；本轮也未接线默认 provider resolution、StoryForge live loop 或 ToolCallingRuntime。上述证据不支持宣称
真实多 Provider 联网已验收或 Agent Runtime 迁移已经完成。

### 2026-08-05 小说质量诊断与根因优化闭环规划

创建 Trellis 规划任务 `.trellis/tasks/08-05-novel-quality-diagnosis-loop/`，补充 `prd.md`、`design.md` 与
`implement.md`。经用户澄清，本任务定位为 StoryForge 内部 `Novel Quality Lab`，用于失败样本诊断、生成链路
根因归因、单变量 baseline/candidate 实验和项目优化决策，不是 Desktop 作者功能。方案复用 AI SDK、
AgentRun/ModelRun evidence、既有质量检查器和真实生成入口；代码盘点确认 `apps/api/scripts/prompt_lab` 已有
固定输入、生产 prompt 同源变体、repeat/merge、实时落盘与盲评地基，因此方案改为原地扩展 Prompt Lab，
不新增平行 runner。首版采用文件制品，不新增数据库 migration、OpenAPI 或第二套 runtime，也不以自动
总分替代人工通读。

验证：

```text
规划文档人工回读                                      -> passed
git diff --check -- .trellis/tasks/08-05-...           -> passed
```

未验证：本轮仅完成设计与执行计划，未修改运行时代码，未执行 pytest、真实 provider 或长篇人工盲评。
首套 benchmark 范围、默认重复次数和人工评审协议仍待用户设计评审确认。

### 2026-08-05 ToolCallingRuntime 核心

新增内部通用同步工具调用 Runtime：RuntimeTool/Registry、受限 JSON Schema 校验、ToolSelector、RuntimePolicy、
RunTracer、UsageSink、CheckpointStore、round/tool/output/token/cost 预算、多轮工具反馈、approval/interruption、
JSON checkpoint、idempotent resume 与非幂等 reconciliation。核心只接收标准消息和 opaque application context，
不依赖 StoryForge domain、FastAPI、SQLAlchemy、Desktop 或小说类型，尚未接线 live loop。

首轮完整门禁发现递归不可变 helper 被误用于既有 `ToolSpec.input_schema`，嵌套 `mappingproxy` 无法被旧
`llm_client` JSON 序列化，导致 7 个 BookRun/LLM 用例失败。修复为保持 Provider wire contract 的浅层不可变
行为，只对 RuntimeTool/Result/Artifact/ProviderContinuation 使用递归冻结，并新增嵌套 schema 序列化回归。

验证：

```text
Runtime registry/state/budget/recovery focused tests     -> 22 passed
all AI SDK tests                                        -> 60 passed
source code standards                                   -> 16 passed
first pnpm.cmd verify                                    -> failed (7 nested schema serialization regressions)
targeted original failures after fix                    -> 7 passed
final pnpm.cmd verify                                    -> passed
  root ESLint/Prettier                                   -> passed
  Desktop typecheck / Vitest                             -> passed / 85 files, 549 passed
  shared typecheck / project-core                        -> passed / 7 passed
  API pytest / Ruff                                      -> 1502 passed, 4 skipped / passed
  sidecar daily smoke                                    -> passed
  OpenAPI / Agent frame drift                            -> no drift
git diff --check                                         -> passed
```

未验证：未接线现有 StoryForge ToolSpec/PermissionGate/AgentRun trace/checkpoint，也未运行真实 provider 或真机
Desktop。当前证据只证明无 live 调用方的内部 Runtime 核心与离线状态机，不支持宣称 Agent Runtime 迁移完成、
任意指令级 exactly-once 或生产级自动写回闭环。

### 2026-08-05 StoryForge Agent Runtime 迁移

live free-text chat 已保留 `run_chat_loop` facade 与 StoryForge message/context assembly，内部切换为 typed provider +
`ToolCallingRuntime`。新增 ToolSpec/handler、PermissionGate、selector、feedback、usage/cost、trace/evidence、checkpoint
与 artifact adapters；SDK 不读取章节、canon、项目路径或 SQLAlchemy。`read/ask/auto/full`、protected arguments、
单补丁、proposed patch、pause/stop、首轮 fallback、compaction 与 AgentRun/assistant evidence wire shape保持不变。

第一次 API 全量门禁暴露了 SDK 不可变状态泄漏：嵌套参数在 checkpoint 内递归冻结后，以 tuple/`mappingproxy`
进入 StoryForge handler 或 `json.dumps`，造成 13 个 nested-tool 用例失败。修复为 handler 调用与 feedback 构造前
递归 thaw，并新增 nested array/object 回归；SDK checkpoint 内部仍保持不可变。

验证：

```text
live lifecycle/permission/compaction/resume/transport       -> 55 passed
SDK runtime/schema/source/WS focused regressions             -> 74 passed
first full API pytest                                        -> 1496 passed, 13 failed, 4 skipped
affected nested-tool regression after recursive thaw         -> 81 passed
final API pytest                                             -> 1510 passed, 4 skipped
API Ruff                                                     -> passed
headless OpenAI-compatible local tool boundary/transcript    -> passed
pnpm.cmd openapi                                             -> passed, no OpenAPI/Agent frame drift
pnpm.cmd verify                                              -> passed
  root ESLint/Prettier                                       -> passed
  Desktop typecheck / Vitest                                 -> passed / 85 files, 549 passed
  shared typecheck / project-core                            -> passed / 7 passed
  API pytest / Ruff                                          -> 1510 passed, 4 skipped / passed
  sidecar daily smoke                                        -> passed
  OpenAPI / Agent frame drift                                -> no drift
git diff --check                                             -> passed
```

未验证：本轮没有使用真实 Provider key，因此未执行外网 OpenAI-compatible/Anthropic/Gemini complete/stream/tool
smoke；也未宣称真机 Tauri 的自动写回与撤销链已完成验收。现有证据覆盖后端只产 proposed patch、确认位派生与
Desktop guarded writeback 自动化测试，不等同于真实 GUI 人工验收。

### 2026-08-05 最近 Desktop Agent UI 提交审查修复

范围：修复最近 5 个 Desktop 提交中发现的四类回归。对话区补丁接受/拒绝现在携带稳定
`patchId`，由编辑器校验匹配后复用既有 guarded writeback 或清理补丁；待确认 run 重新阻止新消息
静默覆盖；`stopped` 不再渲染空操作条；Composer 不再裁切向上展开的权限菜单。恢复 run 同样把补丁
目标投影到 approval step。DOM 事件契约已同步到 `docs/architecture/agent-shell-contracts.md`。

验证：

```text
失败回归（修复前）                                      -> 5 failed / 15 passed
目标回归（修复后）                                      -> 6 files / 67 passed
Desktop 全量 Vitest                                     -> 88 files / 569 passed
Desktop typecheck                                       -> passed
root ESLint                                             -> passed
本次改动文件 Prettier                                   -> passed
git diff --check                                        -> passed
API source standards                                    -> 14 passed / 2 failed
  既有失败：useRunAuthorAgent.ts 502 lines > 500 hard limit
pnpm.cmd lint                                           -> ESLint passed；Prettier 扫描被既有
  apps/desktop/frontend/src/.pytest_cache 的 EPERM 阻断
```

未修改 API route、DTO、OpenAPI 或 Agent frame schema，不需要刷新 generated contract。未运行真机
Tauri 点击链；补丁接受由跨组件行为测试证明走 `snapshot -> branch -> write -> record`，不能替代真机 GUI
验收。源码上限和 `.pytest_cache` 权限问题均不在本次 diff，按任务边界未顺手修改或删除。

### 2026-08-05 Desktop 布局与视觉交互审查修复

范围：修复最近 2 个 Desktop 提交审查发现的四项回归。无项目时 `Ctrl+3` 现在夹回均衡布局，避免隐藏
欢迎中栏后只剩空窗口；右键菜单改用 Tailwind 可生成的 92% 任意透明度类；行间补丁落位动画拆出纯缓动
token，避免复合 transition token 被解析成额外 120ms delay、导致 170ms teardown 截断动画；作品简介失焦
恢复静息内凹阴影并继续提交草稿。四项均先补失败回归，再修复至通过。

验证：

```text
目标回归（修复前）                                      -> 4 files / 4 failed, 35 passed
目标回归（修复后）                                      -> 4 files / 39 passed
Desktop 全量 Vitest                                     -> 89 files / 572 passed
Desktop typecheck                                       -> passed
Desktop production build                                -> passed（仅既有 chunk/dynamic-import 警告）
目标文件 ESLint / Prettier                              -> passed / passed
git diff --check                                        -> passed
pnpm.cmd verify                                         -> 1508 API passed, 4 skipped, 2 failed
  根 lint、Desktop、shared、project-core                 -> passed
  既有失败：useRunAuthorAgent.ts 502 lines > 500 hard limit（两条断言）
```

未修改 API route、DTO、OpenAPI 或 Agent frame schema，不需要刷新 generated contract。未执行真机 Tauri
人工点击验收；本轮证据覆盖组件行为、样式契约与生产 CSS 构建，不等同于真机 GUI 验收。源码行数门禁失败位于
未改动文件，且在本轮开始前已存在，按任务边界未顺手拆分。

### 2026-08-05 结构化拆书报告（本轮恢复与模型阶段）

范围：重新加入本地参考文本解析、中文章序识别、确定性代表章选择、有限上下文、版本化结构化分析、主模型严格 JSON 重试、`.storyforge/analysis/` 报告文件、AgentArtifact 运行记录和 Desktop 作品栏触发按钮；未接入网页抓取、下游创意生成和专用报告导出页。

验证：

```text
cd apps/api && uv run pytest tests/test_ide_book_breakdown.py tests/test_ide_commands.py -q -> 8 passed
cd apps/api && uv run ruff check app/domains/ide/book_breakdown.py app/domains/ide/command_registry.py tests/test_ide_book_breakdown.py -> passed
npm --prefix apps/desktop/frontend run test -- --run tests/book-profile-view.test.tsx -> 15 passed
npm --prefix apps/desktop/frontend run typecheck -> passed
```

未验证：真实 provider、模型联网质量、取消/漂移恢复、报告专用预览/导出、网页来源和真机 Tauri 点击链。全量 source standards 仍受未改动的 `useRunAuthorAgent.ts` 502 行既有问题阻断。

### 2026-08-05 结构化拆书报告（闭环补全）

本轮补充报告 Markdown 投影、Desktop 侧栏字段预览与 JSON/Markdown 打开入口，以及
`book.breakdown.status` 来源指纹检查。源文件变化时状态显示为 stale；模型 malformed JSON
仍保留确定性底稿并记录错误。

验证：

```text
npm.cmd --prefix apps/desktop/frontend run test -- --run -> 89 files / 574 passed
npm.cmd --prefix apps/desktop/frontend run typecheck -> passed
python -m py_compile <touched API modules/tests> -> passed
uv run python -c <breakdown drift smoke> -> completed_deterministic；fresh/stale 与 Markdown 断言通过
pnpm.cmd openapi -> passed, no contract drift
git diff --check -> passed
```

API pytest 未能启动：当前 `apps/api/.venv` 缺少 `prometheus_fastapi_instrumentator`，未擅自安装依赖。
真实 provider、网页来源和真机 Tauri 点击链仍未验证；source standards 的既有 502 行门禁问题保持不变。

### 2026-08-06 结构化拆书报告（取消协议）

补充 `analysis_id` 取消协议：后端登记进程内取消事件，新增 `book.breakdown.cancel`，
在解析/选章/模型返回边界检查取消并落盘 `cancelled` 部分报告；Desktop 运行中显示取消按钮，
取消请求不会被当作成功生成。

验证：

```text
Python py_compile -> passed
uv run cancellation smoke + IDE cancel command smoke -> passed
uv run persistence failure smoke -> passed
npm prettier -> passed
npm --prefix apps/desktop/frontend run typecheck -> passed
npm --prefix apps/desktop/frontend run test -- --run tests/book-profile-view.test.tsx -> 18 passed
```

完整 API pytest 仍受虚拟环境缺少 `prometheus_fastapi_instrumentator` 阻断。

源码标准检查结果：新增 `book_breakdown.py`（500 行）与 `book_breakdown_control.py`（29 行）均在限制内；
检查仍只剩既有 `apps/desktop/frontend/src/components/chat-window/useRunAuthorAgent.ts` 502 行超限。

### 2026-08-07 受控小说润色流水线

范围：`.trellis/tasks/08-05-controlled-novel-polishing`。新增独立润色 provider 槽位、章级
`chapter.polish` ToolSpec/固定管线、确定性本地清理、原文相对质量门禁、Desktop 主动触发与设置 UI，
并让 Ctrl+K 通过 `quality_gate="polish"` 复用同一候选门禁。后端始终只产出 proposed patch；本地降级
候选始终需要人工确认，专用槽位缺失时不会静默回退主模型。

质量审查补充了可信上下文约束投影：`context.load` 的已净化 snapshot 会把人物/设定文件名、人物备注、
设定/时间线事实及显式 Story Memory/章级目标送入实体与事实门禁。固定管线回归证明在线候选删除人物名时
被拒绝且不产生补丁。原生 provider 流式 HTTP 错误也改为固定安全摘要，不再复制上游响应正文。

验证：

```text
API 润色/provider 定向回归                         -> 30 passed
API Agent/provider/Ctrl+K/SDK/source standards     -> 150 passed
API targeted Ruff                                  -> passed
Desktop full Vitest                                 -> 89 files / 579 passed
Desktop typecheck                                   -> passed
Rust llm config tests / cargo check                 -> 2 passed / passed
rustfmt --check src/llm_config.rs                   -> passed
pnpm openapi                                        -> passed；仅 quality_gate DTO 预期 drift，Agent frame 无 drift
git diff --check                                    -> passed
```

`cargo fmt --check` 全 crate 仍会报告未改动 `apps/desktop/src-tauri/src/fs.rs` 的既有格式漂移，未顺手重写。
最终 `pnpm verify` 在根 lint 阶段被未改动
`apps/desktop/frontend/src/components/app/useProjectCommands.ts:81` 的
`react-hooks/set-state-in-effect` 阻断；该文件不在本任务 diff，后续总门禁阶段未在这次 invocation 中执行。

未验证：没有调用真实 provider；没有执行打包后 Tauri 真机的设置、整章动作、diff 确认和 guarded writeback
人工点击链；没有对真实小说样本做人工文学质量通读。因此不能宣称润色质量普遍提升、真实多 provider 联网
稳定或真机端到端写回已完全验收。
### 2026-08-31 Desktop dead-export cleanup

范围：移除未被当前源码、测试或文档引用的前端死导出/辅助函数；保留后端知识查询契约和实际图标导出。

验证：
```text
npm.cmd --prefix apps/desktop/frontend run typecheck -> passed
npm.cmd --prefix apps/desktop/frontend run test -> 89 files / 579 passed
git diff --check -> passed
pnpm.cmd lint -> blocked by existing useProjectCommands.ts:81 react-hooks/set-state-in-effect
```

未验证：Vite production build was blocked by EPERM while Tailwind scanned apps/desktop/frontend/src/.pytest_cache; no source compilation error was reported.

### 2026-08-31 API/workflow boundary and dead-code cleanup

范围：确认已退役的 `apps/workflow` 不再作为运行时入口；清理其在当前 API/Desktop 侧遗留的孤儿 helper、未引用导出和占位脚本。保留 `apps/api` 作为 Desktop sidecar 的业务事实源、Agent/IDE 路由和 OpenAPI 契约边界。

验证：
```text
cd apps/api && uv run pytest tests/test_book_run_workflow_dispatch.py tests/test_source_pruning.py tests/test_ide_book_breakdown.py tests/test_source_code_standards.py -q -> 55 passed
cd apps/api && uv run ruff check app --select F401,F841 -> passed
cd apps/api && uv run ruff check app/domains/ide/book_breakdown.py app/domains/ide/command_registry.py run_real_smoke.py -> passed
cd apps/api && uv run python -m compileall -q app -> passed
cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml -> passed
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml -> 41 passed, 1 ignored
npm.cmd --prefix apps/desktop/frontend run typecheck -> passed
npm.cmd --prefix apps/desktop/frontend run test -> 89 files / 579 passed
pnpm.cmd test:project-core -> 1 file / 7 passed
$env:UV_CACHE_DIR=.codex/tmp/uv-cache; pnpm.cmd check:drift -> passed, no OpenAPI/Agent WS drift
pnpm.cmd test:shared -> passed
git diff --check -> passed
```

本轮还修复了拆书命令返回值的回归：`_persist_report()` 返回完整报告时，调用方不再把完整对象嵌套到 `paths` 字段。未通过项：Vite production build 仍被 `apps/desktop/frontend/src/.pytest_cache` 的 EPERM 阻断；根级 `pnpm.cmd lint` 仍被未改动的 `useProjectCommands.ts:81` `react-hooks/set-state-in-effect` 阻断。两项均未报告本轮修改文件的编译错误。
补充收口：移除 `.env.production.example` 中无代码消费者的旧 Workflow runtime 变量，修正 README/运维手册/当前阶段 TODO 对已退役 `apps/workflow` 的活动入口描述，并删除 `.gitignore` 对已删除并发 smoke 脚本的例外。历史架构与迁移 ledger 文档保留不改，作为退役证据。
根级 `pnpm.cmd verify` 已复跑，仍在 lint 阶段被未改动的 `apps/desktop/frontend/src/components/app/useProjectCommands.ts:81` `react-hooks/set-state-in-effect` 阻断；本轮涉及的 Desktop/API 文件未出现在该错误中。
补充文档收口：更新 `CONTEXT.md`、`apps/desktop/README.md`、`docs/agents/domain.md` 与 `docs/operations/release-checklist.md` 中的退役入口描述；兼容 BookRun 调度路由仅改说明文字并执行 `pnpm.cmd openapi`，生成的 OpenAPI/TypeScript 差异仅为 description/summary，同步检查无漂移。
补充删除清单：移除已无调用方的 `apps/desktop/src-tauri/icons/crop_icon.py`、旧图标生成脚本、`apps/desktop/dev.sh`、前端占位 `index.html`、性能配置残留、`restart_api_server` 及其前端包装；smoke 不再 mock 已删除的 `/api/agent-runs/roles`，`run_real_smoke.py` 删除无效脱敏函数。`.env.production.example` 同步移除无消费者的 `WEB_BASE_URL` 与旧 Workflow runtime 配置。
最终复验（2026-09-02）：API 定向回归 55 passed，前端 89 files / 579 tests passed，Rust 41 passed / 1 ignored，project-core 7 passed，OpenAPI/Agent frame drift 无漂移，`git diff --check` 通过。根级 `pnpm.cmd lint` 与 Vite production build 仍分别受既有 `useProjectCommands.ts:81` 规则和 `src/.pytest_cache` EPERM 阻断。
追加修复（2026-09-02）：发现 `.codex/run-real-llm-acceptance-interactive.ps1` 仍指向已删除的并发 runner，且传递已不存在的 `--chapter-parallelism` 参数；已将其收敛到现存 `run-real-llm-long-direct.py`，并更新包装回归。连通性/包装测试 `uv run pytest tests/test_real_llm_connectivity_probe_script.py -q -> 10 passed`，Ruff 通过。为兼容 Windows PowerShell 5，连通性、10 章和交互验收 3 个 UTF-8 脚本补齐 BOM；脚本解析检查均为 0 errors。
追加回归复验：连通性包装、长跑包装、BookRun/IDE/source-pruning 和 source-standards 合计 `uv run pytest ... -q -> 81 passed`，API Ruff 通过，`git diff --check` 通过。
交互验收 wrapper 同步要求 `STORYFORGE_LLM_CONFIG_CONFIRMED_THIS_THREAD`，并在 `-Interactive` 下安全询问；与正式长跑 runner 的预检要求保持一致。

### 2026-09-04 清理任务最终复核

本轮登记任务：`.trellis/tasks/09-04-09-04-dead-code-cleanup/`。复核重点是删除项引用、退役 Workflow 边界、BookRun 兼容路由、拆书报告返回结构和跨层契约。

验证命令与结果：

```text
cd apps/api && uv run pytest tests/test_book_run_workflow_dispatch.py tests/test_source_pruning.py tests/test_ide_book_breakdown.py tests/test_source_code_standards.py tests/test_real_llm_connectivity_probe_script.py -q -> 65 passed
cd apps/api && uv run ruff check app/domains/agent_runs app/domains/book_runs app/domains/ide app/domains/runtime_tools app/common/llm_client.py run_real_smoke.py tests/test_real_llm_connectivity_probe_script.py -> passed
npm.cmd --prefix apps/desktop/frontend run typecheck -> passed
npm.cmd --prefix apps/desktop/frontend run test -> 89 files / 579 passed
npm.cmd --prefix apps/desktop/frontend run build -> passed
$env:UV_CACHE_DIR=D:\StoryForge\.codex\tmp\uv-cache; pnpm.cmd check:drift -> passed, OpenAPI 无漂移
git diff --check -> passed
```

Rust 本次尝试因 Cargo 首次下载 `tempfile` 时用户缓存权限/网络受限而中止；未发现代码编译错误。此前同一清理批次已验证 `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml -> 41 passed, 1 ignored`，本次不重复扩大环境权限范围。

复核修正：`.codex/run-real-llm-acceptance-interactive.ps1` 仍被 API 测试读取，因此恢复 `.gitignore` 对该 wrapper 的跟踪例外；已删除并发 runner 的例外继续移除。删除 `apps/workflow` 相关代码不影响历史文档、迁移 ledger、`workflow-dispatch` 路由、`BookRunWorkflow*` schema 或 `workflow_nodes` 兼容字段。

### 2026-09-06 Desktop UI/UX 首轮规划审查

范围：仅创建本地 Trellis 规划与截图证据，任务保持 planning。产品源码、测试、provider 配置和项目手稿未修改；本报告只追加，保留原有未提交内容。

证据：`D:/StoryForge/.trellis/tasks/09-06-desktop-uiux-optimization/research/audit.md`。

验证：
- `npm.cmd --prefix apps/desktop/frontend run dev -- --host 127.0.0.1`：Vite 6.4.3 预览；1280×720 默认视口与 1024×768 最小桌面窗口审查。
- 浏览器正常刷新后可复现：欢迎页“命令面板”进入文件搜索空态；设置弹窗 Shift+Tab 可落入背景欢迎页复选框。已保存截图及 DOM/焦点 JSON，未注入 mock runtime。
- `npm.cmd --prefix apps/desktop/frontend run test -- tests/settings-view.test.tsx tests/welcome-page.test.tsx tests/shortcuts.test.tsx tests/side-panel-resize.test.tsx tests/shell-panel-views.test.tsx tests/patch-review-panel.test.tsx tests/permission-profile-selector.test.tsx tests/behavior/writeback-guard.vitest.ts tests/behavior/agent-session-guard.vitest.ts tests/behavior/event-bus-contract.vitest.ts`：10 files / 78 passed，7.66s。
- `npm.cmd --prefix apps/desktop/frontend run typecheck`：通过。
- `git diff --check`：通过。

边界：以上是既有测试基线，无新增产品修复。未启动 API/Tauri/真实 provider；“本地服务 · 连接中断”来自纯前端预览环境，不计产品缺陷。未做生产构建、全量门禁、浅色/系统缩放验收、真实项目编辑/保存/diff 写回或长篇质量验收。窄窗口编辑区宽度仅为代码约束推断，尚未在项目态渲染复现。

2026-09-06 规划续记：用户确认“保留 IDE 骨架，渐进优化”。已同步至本地 PRD 与审查结论；首批场景优先级尚待确认，任务继续 planning。本次仅更新规划文档，`git diff --check` 通过，未改产品代码或重跑行为测试。

### 2026-09-06 Desktop UI/UX 首批实施与复验

用户已选择“保留 IDE 骨架，渐进优化”并要求开始。本轮仅实现欢迎页/设置 UX-01—UX-05：欢迎命令入口改 commands、空 explorer 让出空间、作者视角说明、设置焦点/表单可访问性与可展开技术详情。保存/探测函数、Agent/权限/写回契约未变，保留原有未提交后端与文档改动。

验证命令与结果：
- `npm.cmd --prefix apps/desktop/frontend run test -- tests/welcome-page.test.tsx tests/settings-accessibility.test.tsx tests/settings-view.test.tsx tests/app.test.tsx tests/shortcuts.test.tsx tests/side-panel-resize.test.tsx tests/shell-panel-views.test.tsx`：7 files / 50 passed。
- `npm.cmd --prefix apps/desktop/frontend run test`：最终 92 files / 615 passed。
- `npm.cmd --prefix apps/desktop/frontend run typecheck`、`pnpm.cmd lint`：通过，最终无 ESLint 告警。
- `npm.cmd --prefix apps/desktop/frontend run build`：通过；保留 Tauri event 混合导入与 chunk 大小告警，不压制。
- `node --check apps/desktop/frontend/scripts/verify-smoke.mjs`：通过；独立浏览器 smoke 脚本仅同步断言/语法检查，未运行。实际浏览器复验使用隔离 Vite 预览。
- `pnpm.cmd verify`：exit 0；Shared 类型通过，project-core 7 passed，Desktop 615 passed，API 1592 passed / 7 skipped / 6 warnings，Ruff 通过，独立临时库 daily sidecar 零 LLM 冒烟通过，OpenAPI 无漂移。API 既有弃用/测试 key 长度告警保留。
- `git diff --check`：通过。

渲染证据：1024×768 与 1440px 常规宽度、深浅两主题复验；最小窗口欢迎区 740px→976px，说明 11px→12px。欢迎命令/文件搜索分流、刷新后设置焦点环绕/恢复、无项目说明入口、技术详情搜索/展开均实际操作确认。截图为原始 JPEG；常规宽度截图实际为 1440×838，未伪称全高 1440×900 截图。

详细结果和原图入口：`D:/StoryForge/.trellis/tasks/09-06-desktop-uiux-optimization/research/implementation-verification.md`。总门禁原始日志：`D:/StoryForge/.trellis/tasks/09-06-desktop-uiux-optimization/research/pnpm-verify.log`。

未验证：真机 Tauri/WebView2、多轮真实 provider、真实项目打开/保存/diff 写回、系统缩放/屏幕阅读器/真实 IME、C-01/C-02 与长篇质量。浏览器没有连接真实后端，断连状态不计新增故障；总门禁的 sidecar 在独立临时环境运行。已恢复预览主题/视口并关闭本任务标签、停止本任务 Vite。代码未提交；Trellis finish-work 停在未提交检查，不自动提交、归档或改动其他任务。

### 2026-09-06 Desktop UI/UX 第二批阶段复验

本轮新增：项目打开异常接入现有可见弹窗（取消/切换守卫语义不变）；左侧栏支持 Tab、方向键/Shift 调宽、Home/End 和 Enter 复位；欢迎样例卡名称与原生实际生成的“StoryForge 示例项目”一致。不改 API、provider、权限或写回链路，保留所有已有未提交改动。

验证命令与结果：
- 定向 `npm.cmd --prefix apps/desktop/frontend run test -- tests/project-open-feedback.test.tsx tests/side-panel-resize.test.tsx`：2 files / 11 passed；新增错误反馈和键盘回归均先失败再修复。
- `npm.cmd --prefix apps/desktop/frontend run test`：最终 93 files / 620 passed（19:45:25，8.41s）。
- `npm.cmd --prefix apps/desktop/frontend run typecheck`、`npm.cmd --prefix apps/desktop/frontend run build`：通过；构建保留原有混合导入/chunk 告警。
- `pnpm.cmd exec eslint . --ignore-pattern '**/native-ui-20260906-192750/webview/**'`：通过；仅排除本次隔离 WebView 生成缓存的诊断检查，不是原样门禁。
- `pnpm.cmd exec prettier --check "apps/desktop/frontend/src/**/*.{ts,tsx}" "packages/shared/src/**/*.ts" "scripts/**/*.mjs"`：通过。
- `cargo build --manifest-path apps/desktop/src-tauri/Cargo.toml`：通过；原生验收临时观察分支已还原，最终重新构建通过（18.10s），Rust 源码无 diff。
- `node --check apps/desktop/frontend/scripts/verify-smoke.mjs`、`git diff --check`：通过。
- **原样 `pnpm.cmd lint` / `pnpm.cmd verify` 未通过**：eslint 扫到本轮任务隔离目录 `webview/EBWebView/Subresource Filter/Unindexed Rules/10.34.0.84/adblock_snippet.js`，10 个生成代码错误；verify 停在首道门禁，后续 API 等门禁本轮未重跑。尝试有路径边界检查的单一缓存清理被执行环境拒绝，保留缓存，未绕过拒绝或修改检查配置。

原生证据：获用户允许后，在独立配置、SQLite、WebView profile 和任务自有样例目录启动当前 debug 构建，通过真实样例按钮/目录选择器创建并打开正文，正常窗口 1402×880。没有写入真实手稿、填写 provider key 或发起模型请求。GUI/隔离后端已关闭，临时 Rust 改动已撤销；**最小窗口拖拽未取得可靠证据，C-01 仍未解决**。纯浏览器实测侧栏值与实际宽度、Tab 可达、刷新后保持 350px、复位 340px；浏览器错误弹窗因缺少 Tauri invoke 触发，仅验证展示，不计原生故障。

详细步骤、命令与边界：`D:/StoryForge/.trellis/tasks/09-06-desktop-uiux-optimization/research/second-batch-verification.md`。原生截图 `research/native-book-before-wide.png`，本轮预览原图 `research/13-open-project-error-preview.jpg` 至 `research/15-welcome-sample-title.jpg`。预览标签与 Vite 已关闭。未做 GUI diff 写回、多轮真实 provider、系统缩放/屏幕阅读器验收；任务继续 in_progress，代码未提交、未归档。

### 2026-09-06 写作区自适应与补丁头部续进

实现项目态 420px 主区、320—384px 弹性 Agent、只限制显示而不覆盖保存值的侧栏上限；拖拽和方向键从真实显示宽度起算，取消/卸载清理监听。补丁说明和操作组在窄栏换行，保留四个动作与原回调，补分组/展开/拒绝输入语义。无 API/权限/provider/写回契约变化。

- 真实 App 挂载回归确认项目选择后 1024↔1440 resize、Ctrl+3/1/2 实际模式切换、Editor/Agent 节点及状态计数器保留、保存的侧栏偏好不变；重型叶子替换为测试计数器，网络明确失败，不冒充真实 Monaco/Agent 验收。
- 显式标注的无后端组件夹具复用真实 SidePanel/AssistantPanelFrame/PatchReviewPanel：1024px 的侧/中/右为 236/420/320，无工作区横向溢出；1440px 为 420/588/384，保存偏好始终 420。窄栏补丁说明宽度约 156→396px，操作可达、回调可确认但不写文件。测试 HTML 未进入生产 dist。
- `npm.cmd --prefix apps/desktop/frontend run test`：最终 **95 files / 627 passed**（20:09:52，7.72s）；定向 3 files / 24 passed。
- `npm.cmd --prefix apps/desktop/frontend run typecheck`、前端 production build、原范围 Prettier check、`git diff --check`：通过。构建原有混合导入/chunk 告警保留。
- `pnpm.cmd exec eslint . --ignore-pattern '**/native-ui-20260906-192750/webview/**'`：通过，仍只是排除单一旧运行缓存的诊断检查。
- 原样 `pnpm.cmd verify`：**未通过**，仍在 lint 扫到旧 WebView adblock_snippet.js 的 10 个错误，后续门禁没有执行。日志 `D:/StoryForge/.trellis/tasks/09-06-desktop-uiux-optimization/research/pnpm-verify-layout.log`。未修改门禁配置，未绕过已被拒绝的缓存清理。
- 固定 1024×768 的临时原生观察构建通过，但隔离启动命令被执行环境拒绝；未使用其他工具重试。临时 Rust 改动已还原并重新构建通过（14.07s），源码无 diff。本轮未实际接管桌面；57506 无监听，Vite/浏览器夹具已关闭且临时视口 reset。

详细步骤、截图和边界：`D:/StoryForge/.trellis/tasks/09-06-desktop-uiux-optimization/research/layout-verification.md`。AC14 组件补丁布局完成，AC11 原生最小窗口/真实编辑状态和 AC12 完整门禁仍未完成；没有把组件夹具当作真机 GUI、真实 provider 或 diff 写回验收。保留未提交修改，不归档或缩小持续目标。

### 2026-09-06 完成性审查与剩余门禁补验

本轮无产品源码修改。复查 PRD R1—R15、AC1—AC14、当前工作树和关键证据后，保留 AC11（原生项目态最小窗口/真实状态）与 AC12（原样完整门禁）未完成。前一回合为真实实现/渲染进展，本轮补跑被 lint 提前退出挡住的门禁，不扩展新功能或缩小目标。

本轮实际执行：
- 前端 typecheck 通过；全量 **95 files / 627 passed**（20:16:36，7.87s）。
- 原样 `pnpm.cmd verify` 仍 exit 1：本任务旧 WebView 缓存 adblock_snippet.js 的 10 个 lint 错误，与前两回合一致。日志 `research/pnpm-verify-final-audit.log`。
- 独立执行剩余门禁：Shared tsc 通过，project-core **7 passed**；API `uv run pytest` **1592 passed / 7 skipped / 6 warnings**（228.99s）；Ruff 通过；daily sidecar 独立临时 SQLite/54527 端口、零 LLM 冒烟通过；OpenAPI/实时帧 schema/类型刷新无漂移。
- `node --check apps/desktop/frontend/scripts/verify-smoke.mjs`、`git diff --check` 通过。未额外跑 GUI smoke、packaged sidecar、pnpm e2e 或真实 LLM/写回。上轮 production build/源码诊断 ESLint/Prettier 结果保留，本轮没有再次执行这些项。
- sidecar 验收端口及 UI 验收端口均无监听，临时 smoke 根已移除；原生源码与观察前备份 SHA256 一致，Rust 与生成契约无 diff。

分项通过不能替代原样 verify 成功。旧缓存阻碍已连续三个目标回合复现，前次清理被执行环境拒绝；未通过其他方式清理、移动或改规则绕过。原生隔离启动也曾被拒绝，目前没有新原生验收证据。已没有可通过继续改本轮前端代码消除的已知验收阻碍，持续目标标记受阻，等待用户/环境协助，不标记完成、不提交或归档。

逐项审查、完整日志索引、精确缓存路径和恢复条件：`D:/StoryForge/.trellis/tasks/09-06-desktop-uiux-optimization/research/completion-audit.md`。

### 2026-09-07 UI/UX 接手：补齐原生布局与完整门禁

工作树：`C:/Users/kanye/.codex/worktrees/d84b/StoryForge`，`8b10ad2e` + 已迁移的未提交修改。接续原 UI/UX 任务；本轮无新增产品行为，不提交或归档。

- 原样 `pnpm.cmd verify` 全通过：Desktop **95 files / 627 tests**、API **1592 passed / 7 skipped**（226.87s）、project-core **7 tests**、Shared、Ruff、daily sidecar 及契约漂移检查通过。日志 `.codex/uiux-native/verify-20260907.log`。
- 首次门禁因新 worktree 未包含 `.codex/run-real-llm-long-direct.py` 导致 15 个 FileNotFoundError；已从 `D:/StoryForge` 原样补回后完整重跑。该脚本仍是未跟踪的本地测试依赖，不宣称干净 clone 可直接通过。没有修改 lint 规则或删除原仓库 WebView 缓存。
- `npm.cmd --prefix apps/desktop/frontend run build` 通过，保留既有 chunk/混合导入告警；依赖按现有锁文件恢复，无锁文件 drift。
- 真实 Tauri 客户区 **1024×768**：侧栏/编辑器/Agent 为 **236/420/320px**，无横向溢出。三种布局、最大化 **2560×1392** 与还原均保持真实 Monaco 未保存修改、Agent 未发送草稿和原 textarea 挂载；保存的 402px 侧栏只被临时夹限，放大后恢复。
- 原生独立配置/SQLite/WebView profile 和样例均在 `.codex/uiux-native/`；没有调用真实模型、读取真实小说或确认补丁写回。重启后浅色主题最小窗口复验通过。
- 一次设置菜单操作期间出现 WebView 退出、黑屏和 CDP 断开；主进程/API 未退出，无相应 Windows 崩溃记录。重启后未复现，原因未定位，保留为稳定性观察项，不声称已修复。

AC11（布局/状态）与 AC12（当前工作树门禁）已有新增证据；完整创作工作流、真实 provider/补丁写回和稳定性仍不作通过声明。详情 `.codex/uiux-native/acceptance-20260907.md`；原生截图及几何状态在 `output/playwright/uiux-20260907/`。

收尾：临时 Rust 入口已还原，`cargo build --manifest-path apps/desktop/src-tauri/Cargo.toml --target-dir D:/StoryForge/apps/desktop/src-tauri/target` 通过（27.87s），原生程序已关闭，独立 API/CDP 端口 51755/51756/56943/56944 无监听。Rust/OpenAPI 无 diff，`git diff --check` 通过。旧 3007 验收服务已停止，当前工作树前端预览在 `http://127.0.0.1:3008/`（PID 37984，纯前端预览）。本轮 `.codex/uiux-native/webview` 的精确路径清理被自动审批以 `blocked by policy` 拒绝，未换方式删除；缓存原位保留，不影响门禁。

### 2026-09-07 标题栏、搜索与页签键盘交互

- 标题栏按钮双击不再冒泡触发最大化；窗口图标/提示同步最大化与还原；搜索提示和面板展开状态准确。
- 命令面板忽略 IME 组合键，退出恢复入口焦点且不抢走命令已转移的焦点；读取失败时 Tab 可到达重试，Enter 可触发，重试后回到搜索框。
- 页签关闭按钮保留原生 Enter/空格行为；非当前页签右键“关闭其他”保留所点文件，继续使用原有保存、取消与丢弃确认。
- 三条新增行为回归先失败再修复。全量前端 **95 files / 639 passed**，最后重试焦点微调后定向 **5 passed**；typecheck、原样 lint、最终 production build、diff 检查通过。未再次运行 API/契约总门禁，上一轮原样 verify 通过的证据保留。
- 原生 1024x768 实测：最大化/还原提示正确，双击 Agent 切换不改窗口尺寸，Enter/空格能关闭真实页签，右键非活动页签“关闭其他”保留目标。仅使用任务样例；未发送消息或改写正文。临时 Rust 观察入口已撤销，原生/API/CDP 已关闭，62384/62385 无监听。
- 浏览器实测搜索退出焦点从 BODY 修正为原按钮；通过命令面板打开设置后焦点仍在设置搜索框。原生编译时尚未包含最后的 palette 焦点/重试补丁，故这两项只记浏览器与组件验证；真实 IME 未验证。

详见 `.codex/uiux-native/keyboard-acceptance-20260907.md`；原生截图为 `output/playwright/uiux-20260907/08-keyboard-maximized.png` 至 `10-keyboard-close-others.png`。持续目标仍 active；页签关闭后的焦点衔接、更多菜单键盘操作和完整写作流程继续待查。未提交，未宣称无优化空间。

### 2026-09-07 菜单导航与页签关闭后的焦点

- 上下文、文件操作、润色、最近项目与会话菜单统一初始焦点、方向键/Home/End、Escape 及 Tab/Shift+Tab 退出；组合输入不触发菜单命令。动作执行前恢复入口焦点，后续对话框或编辑器的焦点不被夺回。
- 最近项目删除后按删除前顺序聚焦下一存活菜单项；集成回归曾发现焦点落到下一行删除按钮，现已修正为下一行打开入口。
- 页签等待异步关闭结束后聚焦剩余活动页签；取消关闭恢复原关闭按钮，等待期间已转移到别处的焦点保持原位。预览页签支持局部 Ctrl+W，AppShell 保留关闭回调的 Promise。
- 全量前端 **96 files / 650 tests passed**；最终 typecheck、原样 `pnpm.cmd lint`、production build 通过，既有混合导入/chunk 告警保留。构建后仅格式和夹具外观调整；接手复核 `git diff --check` 通过。未重跑 API/总门禁，无 Rust 改动。
- 浏览器夹具 1024x768 实测 Enter 关闭后焦点衔接、菜单首项/方向/Home/End、Tab/Shift+Tab 退出、脏稿 Escape 取消、动作主动聚焦编辑器；深浅主题截图已检查。1440x900 会话菜单位于窗口内，文档无横向溢出。

详情 `.codex/uiux-native/menu-focus-acceptance-20260907.md`。截图 `output/playwright/uiux-20260907/11-menu-keyboard-light-1024.png` 至 `13-session-menu-dark-1440.png` 使用真实组件和内存回调，不能替代原生、Monaco、真实 provider 或写回验证。持续目标 active，未提交。

### 2026-09-07 弹窗与输入法边界

- `AppDialogHost` 在打开时聚焦输入框/主动作，Tab 在弹窗内环绕，Escape 和输入法组合键不会穿透；关闭时恢复入口焦点，动作主动把焦点移到编辑器时保留该转移。
- 对话请求改为 FIFO。并发 `prompt`、`alert`、`confirm` 依次显示并分别 resolve，不再覆盖前一请求造成永久等待。
- App 全局快捷键跳过 `defaultPrevented`、IME composing 与 keyCode 229；行间修订的 document 捕获 Escape/Alt+Enter 在有活跃弹窗时让出处理权。
- 新增对话框焦点、IME、后台快捷键隔离及并发队列回归；定向 17 项通过。随后全量前端 **96 files / 659 tests passed**；typecheck、相关 ESLint、Prettier、production build 和 `git diff --check` 通过。构建保留既有动态导入与大 chunk 告警。

边界：行间修订与弹窗的跨层优先级以 DOM 模态存在性保护，未发起真实模型或写回；未重跑 API/完整 verify。详情见 `.codex/uiux-native/dialog-input-acceptance-20260907.md`。持续目标 active，未提交。

### 2026-09-07 状态反馈可访问性

- 编辑器文件读取中/失败、AI 修订请求中、Agent 会话加载失败、项目上下文索引加载中/失败均补上 `status` 或 `alert`、`aria-live` 和必要的 `aria-busy`，视觉文案与时序不变。
- `editor.test.tsx` 与 `chat-window-error-states.test.tsx` 定向验证通过；没有改变文件读取、会话加载或 Agent 请求逻辑。
- 本批仍未进行真实屏幕阅读器、原生 WebView 或 provider 验收；完整目标保持 active。

### 2026-09-07 Agent 角色建议键盘可达性

- Composer 的 `@剧情` / `@人物` 建议现在使用 listbox/option 语义，支持 ArrowUp/ArrowDown 循环和 Enter 选择；鼠标点击行为保留。
- 选中后仍写入带空格的 mention，不触发消息发送；无建议时 Enter、Shift+Enter、历史回溯和 IME 行为保持原语义。
- `permission-profile-selector.test.tsx` 新增真实受控 Composer 回归，定向 6 项通过。未发送模型请求或改变 Agent payload。

### 2026-09-07 Agent 消息日志语义

- 非空 Agent 会话消息区声明 `role="log"`、`aria-label` 和 `aria-relevant="additions text"`，让辅助技术能够识别动态回复区域；空会话欢迎态保持原布局。
- `chat-ux-polish.test.tsx` 新增静态渲染回归，定向 15 项通过；本轮累计全量前端 **96 files / 660 tests passed**，不改变消息内容、滚动或流式逻辑。

### 2026-09-07 Agent 操作区语义

- 运行状态文字声明 `role="status"` / `aria-live="polite"`；有详情的 Agent 步骤按钮声明 `aria-expanded`。
- 补丁确认面板声明待确认区域，Monaco 差异区声明“补丁差异”区域，辅助技术可从状态、决策操作和差异内容建立清晰位置关系。
- `chat-ux-polish.test.tsx` 与 `patch-review-panel.test.tsx` 定向 28 项通过；本轮全量前端 **96 files / 661 tests passed**，typecheck、ESLint、Prettier、production build 和 `git diff --check` 均通过。构建保留既有动态导入与大 chunk 告警。

### 2026-09-07 会话边界与权限菜单焦点

- 权限档位 listbox 选择后、Escape 或 Tab 关闭均回到入口按钮；IME composing 与 keyCode 229 不触发档位切换或关闭。定向 `permission-profile-selector.test.tsx` **8 项通过**。
- 补丁审查和对话运行条的拒绝输入忽略 IME 组字回车，Escape 收起输入框后恢复拒绝入口焦点，避免误提交和焦点落到 `body`。
- 会话切换/新建会话清空未发送草稿、待执行修复命令、运行投影和待确认面板；权限等待时 Composer 阻止发送会提示先批准或拒绝权限请求。生命周期定向 **12 项通过**。
- 本轮完整前端回归 **96 files / 663 tests passed**（`vitest --pool=forks --maxWorkers=2`），typecheck、Prettier、production build 与 `git diff --check` 通过。构建保留既有动态导入和大 chunk 告警。

真实 WebView、屏幕阅读器、IME、provider 请求和补丁写回仍未在本轮验证；持续目标保持 active，未提交。

### 2026-09-07 焦点恢复回归与构建复验

- 全量前端回归重新通过：**96 个测试文件、666 项测试**。此前回归中出现的 16 个未捕获异常来自写回测试替身缺少 Monaco `focus` 方法；`useSuggestionWriteback` 现在先捕获编辑器实例和方法，并仅在运行时确认方法可调用后恢复焦点。
- 写回与拒绝行为定向回归 **23 项通过**，覆盖补丁接受、拒绝、自动写回和无完整 Monaco 实例的测试夹具。
- 对话运行条焦点回归 **7 项通过**；测试显式聚焦权限/补丁按钮后再点击，确认操作条卸载仍把焦点交还 Composer。
- `pnpm.cmd --dir apps/desktop/frontend run build` 通过；保留既有 `@tauri-apps/api/event` 混合导入及大 chunk 警告。
- 焦点恢复、权限批准/拒绝、补丁接受/拒绝、会话切换清理和 IME 边界均完成代码级回归；真实 provider 请求、真实补丁写回、屏幕阅读器和中文 IME 仍未验证。工作树未提交。

### 2026-09-07 命令面板与壳层可访问性收口

- 活动栏补充工作区导航名称、活动视图 `aria-current`、设置入口和知识待处理徽标语义；高频纯图标按钮补显式 `aria-label`，观测面板关闭按钮补 `type="button"`。
- 命令面板结果区声明 `listbox`，输入框关联 `aria-controls` / `aria-activedescendant`，选项声明 `role="option"` / `aria-selected`；查询结果缩减时视觉高亮和 Enter 执行统一使用夹限后的活动索引，避免 stale index。
- 定向命令面板与壳层回归 **46 项通过**；新增筛选收缩键盘回归 **7 项命令面板测试通过**。
- 变更后前端全量回归 **96 个测试文件、668 项测试通过**；TypeScript、ESLint、production build、Prettier 与 `git diff --check` 均通过。
- Playwright 浏览器实测欢迎页和设置页 1024×768：主内容无横向溢出，设置长内容在模态内部滚动；纯前端预览中的 Tauri invoke 断连错误属于预览边界，不计为原生故障。
- Composer 输入区补充上下文添加/发送按钮的显式名称，并将角色建议输入关联到 `listbox`、`aria-activedescendant` 和稳定选项 ID；权限与角色建议回归 **8 项通过**，production build 复验通过。
- Knowledge Inbox 补充刷新按钮名称和状态 tablist 名称；面板回归 **4 项通过**。最新全量前端回归仍为 **96 个测试文件、668 项测试通过**，production build 复验通过。
- 故事导航与 Knowledge Inbox 的 tablist 改为 roving tabindex，支持方向键循环、Home/End 和 IME 边界；定向导航回归 **6 项通过**。
- 故事索引和 Knowledge Inbox 的首次加载补充 `status` / `aria-busy`，避免空白区域缺少反馈；新增状态回归后，最新全量前端回归为 **97 个测试文件、671 项测试通过**，production build、typecheck、仓库级 lint、Prettier 与 `git diff --check` 均通过。

### 2026-09-07 接手复验与权限拒绝可恢复性

- 发现权限拒绝控制在发送后端请求前提前清理待执行修复命令；现改为仅在成功 ack 后清理，控制发送失败时保留命令，作者可以重试。
- 补丁拒绝入口与表单补齐 `aria-expanded`、`aria-controls`、`role="group"`、表单标签和输入标签，并保留 IME 组字回车保护。
- 接手后全量前端回归 **97 个测试文件、671 项测试通过**；production build、TypeScript、仓库 lint、Prettier 与 `git diff --check` 均通过。构建保留既有 Tauri 动态/静态混合导入与 Monaco 大 chunk 告警。
- API 定向 pytest 未能启动：当前环境缺少 `prometheus_fastapi_instrumentator`；API Ruff 也未能启动：当前环境没有 `ruff` 可执行文件。未修改环境依赖。

### 2026-09-07 编辑器页签键盘导航补齐

- 编辑器页签行现在支持左右方向键循环、Home/End 首尾定位，并忽略 IME 组合输入；移动焦点会同步激活目标页签。
- 页签关闭控件补 `type="button"` 与按文件名生成的 `aria-label`，避免表单默认提交和无名称图标按钮。
- 新增页签导航与关闭控件回归；全量前端回归 **97 个测试文件、673 项测试通过**，TypeScript、Prettier 与 `git diff --check` 通过。

### 2026-09-07 补丁决策操作忙碌态

- 补丁接受整块、接受分块、保存旁注和拒绝提交统一加同步忙碌锁；同一 tick 的重复点击只执行一次，异步完成后恢复操作。
- 操作按钮在写回期间原生禁用，面板声明 `aria-busy`，并用 `role="status"` 告知“正在写回/保存旁注/提交拒绝”状态。
- 定向补丁与对话控制回归 **20 项通过**；随后全量前端回归 **97 个测试文件、673 项测试通过**，TypeScript、仓库 lint、Prettier、production build 与 `git diff --check` 通过。

### 2026-09-07 文件树与通知控件语义收口

- 资源树文件夹展开、新建文件/文件夹、版本历史预览/恢复、项目侧栏新建入口和 Toast 操作/关闭按钮补齐显式 `type="button"`；纯图标控件补充可访问名称。
- 定向资源树、侧栏、Toast、版本历史回归 **21 项通过**；全量前端回归保持 **97 个测试文件、673 项测试通过**。

### 2026-09-07 会话切换加载反馈

- 历史会话切换在消息清空到请求完成期间显示独立加载占位，不再把异步窗口误报为“空会话”；会话加载完成或失败后自动撤下。
- 加载占位声明 `role="status"`、`aria-live="polite"` 与 `aria-busy="true"`，并显示目标会话编号；新建草稿会话保持即时空态。
- `chat-window-error-states.test.tsx` 与 `chat-ux-polish.test.tsx` 定向 **24 项通过**；TypeScript、Prettier 与 `git diff --check` 通过。真实 Tauri/WebView、屏幕阅读器和 provider 链路仍未验证。

### 2026-09-07 会话发送边界与 API 复核

- 历史会话加载期间 Composer 现在禁用发送并显示“正在加载会话…”，提交守卫也给出明确提示；首次草稿升级为正式会话时保留当前消息，不再闪回加载占位。
- 定向会话状态回归 **24 项通过**；全量前端回归 **97 个测试文件、675 项测试通过**，TypeScript 与 Prettier 通过。
- 使用 `apps/api` 工作目录的 uv 环境复核本轮 API 改动：定向 pytest **19 项通过**，对应 Ruff **All checks passed**。
- `verify:smoke` 当前被 Playwright 浏览器二进制缺失阻断（需安装 `chromium_headless_shell`）；脚本未报告应用断言失败。
- 随后安装所需 Playwright Chromium headless shell 并重跑 `pnpm.cmd --dir apps/desktop/frontend run verify:smoke`，结果 `Desktop frontend smoke passed`；覆盖欢迎页、1024 窄屏、活动栏折叠和项目打开后的三栏工作区。

### 2026-09-07 最终门禁复验

- 会话状态、控件语义和补丁决策改动完成后，前端全量 Vitest **97 个测试文件、675 项通过**；仓库 lint、TypeScript、Prettier、production build、`git diff --check` 均通过。
- API 本轮改动定向 pytest **19 项通过**，Ruff **All checks passed**。
- `verify:smoke` 已成功通过；Playwright 覆盖欢迎页、窄屏视图、活动栏折叠和项目打开后的编辑/助手工作区。
- 仍未宣称真实 Tauri/WebView2、屏幕阅读器、中文 IME、真实 provider 与真实补丁写回验收完成；这些需要外部运行环境或凭据。

### 2026-09-07 设置、命令和资源控件边界

- 设置弹窗 Escape 处理补齐 WebView `keyCode=229` 的 IME 保护；关闭和 ActionRow 按钮显式声明 `type="button"`。
- 命令面板文件/命令结果按钮显式声明 `type="button"`，避免宿主表单上下文触发隐式提交。
- 文件树文件夹操作补充展开/折叠名称，版本历史操作补充文件上下文标签，项目侧栏与 Toast 操作按钮补齐按钮类型和图标名称。
- 相关定向回归 **21 项通过**；全量前端回归保持 **97 个测试文件、675 项测试通过**，TypeScript、lint、Prettier、production build 与 `git diff --check` 通过。

### 2026-09-07 分支画布与编辑器读取失败恢复

- 分支画布空态、分支/节点选择和比较结果补齐可访问状态；父版本比较加入异步互斥、过期响应保护，失败后可重试。
- 编辑器文件读取失败增加“重试读取”入口，重试会清除错误并重新进入加载流程；AI 修订加载提示声明 `role="status"`。
- 定向分支画布与编辑器回归 **20 项通过**；全量前端回归 **98 个测试文件、680 项通过**，TypeScript、仓库 lint（含 Prettier check）、production build、smoke 和 `git diff --check` 均通过。
- `format:check` 不是仓库脚本，格式校验由仓库 lint 中的 Prettier check 完成。真实 Tauri/WebView2、屏幕阅读器、中文 IME、provider 请求和真实补丁写回仍未验证。

### 2026-09-07 状态栏、搜索与刷新交互收口

- 状态栏观测入口的可访问名称现在区分未启用、加载失败、无未处理项和具体未处理数量；状态色点标记为装饰内容。
- 全文搜索输入、清空按钮、搜索中/空结果/失败状态补齐名称与 live region；观测面板处理按钮补齐按钮类型和动态名称。
- 手稿、观测、作品档案、Knowledge Inbox 刷新在请求进行中禁用重复触发；版本历史和折叠分区补齐加载播报、`aria-controls` 与 region 关联。
- 全量前端回归 **99 个测试文件、683 项通过**；TypeScript、仓库 lint（含 Prettier check）、production build、smoke 和 `git diff --check` 均通过。
- 本轮仍未验证真实 Tauri/WebView2、屏幕阅读器、中文 IME、provider 请求和真实补丁写回。

### 2026-09-07 浏览器视觉复验

- 使用真实 Chromium 对欢迎页与打开项目后的编辑/助手工作区分别在 1280×720 和 1024×768 截图复验。
- 四个视口均无 `document.documentElement` 横向溢出；欢迎页、空编辑器、右侧 Composer、状态栏布局正常，控制台无 smoke 错误。

### 2026-09-07 命令面板与版本预览细节

- 欢迎页发送按钮、命令面板搜索输入和文件读取状态补齐可访问名称/live region；版本历史“对比当前”在异步读取期间禁用重复操作并显示“对比中”。
- 阶段性前端回归 **99 个测试文件、683 项通过**；production build、verify:smoke 和 `git diff --check` 通过。构建仅保留既有 Tauri 混合导入与 Monaco 大 chunk 警告。
- 搜索清空后焦点保持在输入框，sidecar 状态栏改为 polite live region；定向搜索/状态栏回归 **7 项通过**，typecheck、lint 通过。
- 刷新与版本预览按钮的禁用态统一显示等待光标和半透明反馈；相关壳层/编辑器定向回归 **58 项通过**。
- 当前工作树最终前端回归 **99 个测试文件、684 项通过**；lint、typecheck、production build、verify:smoke 与 `git diff --check` 均通过。

### 2026-09-07 版本历史关闭后的焦点恢复

- 版本历史关闭、恢复文件内容和恢复到文件不存在状态后，统一通过 `requestAnimationFrame` 将焦点还给文件操作入口；页签关闭与异步关闭取消仍保留合理焦点。
- 新增页签外部焦点 ref 与编辑器恢复路径回归；定向 2 个测试文件 **31 项通过**。
- 本轮全量前端回归 **99 个测试文件、686 项通过**；TypeScript、仓库 lint（含 Prettier check）、production build、verify:smoke 和 `git diff --check` 均通过。
- 真实 Tauri/WebView2、屏幕阅读器、中文 IME、provider 请求和真实补丁写回仍需外部环境验证。

### 2026-09-08 compact Agent 面板主动展开边界

- 真实 Chromium 复现确认：320/360px 下用户通过标题栏主动展开 Agent 时，固定 320px 最小宽度会把面板右边界推出视口；compact 模式现将 `AssistantPanelFrame` 最小宽度设为 0，保留 flex 收缩并把面板限制在活动栏之后的剩余空间内，桌面宽度仍保持原有 320/420px 约束。
- `assistant-panel` 与 `workspace-layout-app` 定向回归 **4 项通过**；前端全量 Vitest **100 个测试文件、715 项通过**。
- `verify:smoke` 现在覆盖 600px 主动展开 Agent、360px/320px 右边界与文档宽度、320px 会话下拉菜单边界，以及恢复到 1280px；真实 Chromium smoke 通过。TypeScript、仓库 lint（含 Prettier check）、production build 和 `git diff --check` 均通过。
- 构建仍保留既有 Tauri event 动静态导入和 Monaco 大 chunk 警告；真实 Tauri/WebView2、屏幕阅读器、中文 IME、provider 请求和真实补丁写回仍需外部环境验证。

### 2026-09-08 最终键盘交互与完整门禁复验

- 行间聊天接受、弃用、取消按钮统一支持鼠标与原生键盘 click，避免鼠标 `mousedown` 与后续 `click` 重复执行；补充明确 `aria-label`、`aria-keyshortcuts` 及对应 DOM 回归。
- 页签关闭按钮、Agent 步骤自动折叠、Composer 固定按钮、观测行按钮和资源树文件夹操作继续保持键盘可达与焦点可见。
- 前端全量 Vitest **100 个测试文件、713 项通过**。
- `pnpm lint`、前端 `typecheck`、production `build`、`verify:smoke` 和 `git diff --check` 全部通过。
- 构建仅保留既有 Tauri event 动静态导入与 Monaco 大 chunk 警告；真实 Tauri/WebView2、屏幕阅读器、中文 IME、provider 请求和真实补丁写回仍需外部环境验证。

### 2026-09-07 当前 Chromium 窄屏复核

- 基于最新代码和隔离 mock 文件系统，在真实 Chromium 600px 视口重新打开项目并检查资源树、故事标签和编辑空态；当前中心区保持可读宽度，没有旧截图中出现的逐字竖排或横向溢出。
- 新截图保存在 `output/playwright/project-600-current.png`、`resource-600-current.png` 和 `story-600-current.png`；设置 360/500px 截图仍显示单列表单和可见移动端返回入口。
- 本次浏览器直接打开开发服务会产生预期的非 Tauri `invoke` 噪声，因此只将几何和交互结果作为视觉证据，不把浏览器预览当作真实 Tauri/WebView2 验收。

### 2026-09-07 StoryNavigator、ResourceExplorer 与章节简报视觉审计

- 真实 Chromium 使用临时 mock 文件系统覆盖 360×800、500×800、600×900；资源树和故事索引仅在自身区域纵向滚动，底部条目可滚动到并显示，页面 `body` 与文档均无横向溢出。
- 故事 tab 的 `aria-controls`/`aria-labelledby` 关联稳定；Arrow、Home/End 后焦点与 `aria-selected` 同步。章节简报卡片三种宽度均不溢出，目标文本域自动聚焦，取消卸载后焦点恢复到外层入口按钮。
- 截图保存在 `output/playwright/audit-files-{360,500,600}.png`、`audit-story-{360,500,600}.png` 和 `audit-brief-{360,500,600}.png`；本轮未发现需要继续修改的问题。

### 2026-09-07 资源树与 Knowledge Inbox 异步状态

- 资源树加载状态补齐 `role=status`、`aria-live`、`aria-busy`；失败重试后焦点落到加载状态，键盘工作流不会回到 `body`。
- Knowledge Inbox 在已有条目刷新时增加隐藏 live 状态，保留原有可见条目和忙碌禁用态。
- 定向资源树与 Knowledge Inbox 回归 **14 项通过**；全量前端回归 **99 个测试文件、689 项通过**。
- TypeScript、仓库 lint（含 Prettier check）、production build、verify:smoke 和 `git diff --check` 均通过；构建仍只有既有 Tauri 动态/静态导入与 Monaco 大 chunk 警告。

### 2026-09-07 窄屏三栏布局约束

- 真实 Chromium 发现 900px 项目工作区原先把右侧 Agent 栏裁到视口外；中栏最小宽度现按视口动态让位，900px 下实测为侧栏 200px、中栏 332px、Agent 栏 320px，三栏右边界与视口重合。
- `verify:smoke` 新增 900px 项目态文档宽度、body 宽度和 Agent 右边界断言；1024px 既有布局保持 420px 中栏。
- 响应式布局定向回归 3 项通过；全量前端回归保持 **99 个测试文件、689 项通过**。
- TypeScript、仓库 lint（含 Prettier check）、production build、verify:smoke 和 `git diff --check` 均通过。Tauri 原生窗口最小宽度仍为 1024px，真实 Tauri/WebView2、屏幕阅读器、中文 IME、provider 请求和真实补丁写回仍需外部环境验证。

### 2026-09-07 对话头部与浏览器窄屏收口

- 对话头部的新建会话、观测镜、布局切换图标补齐显式 `aria-label`；新增静态回归，防止 title-only 图标退化为无可访问名称。
- Titlebar 在 639px 以下保留可点击搜索图标、隐藏文字与快捷键，品牌区和窗口控件释放固定最小宽度；359px 以下隐藏品牌文字。真实 Chromium 在 300/359/500/600px 验证右侧控件完整且无横向溢出。
- 浏览器视口不超过 719px 时自动进入编辑聚焦布局，收起侧栏和 Agent 栏以避免中栏缩到不可写作的 32px；恢复到宽视口时还原进入窄屏前的布局。900px 三栏策略保持不变。
- `verify:smoke` 增加 500px Titlebar、600px 紧凑项目态和恢复到 1280px 的边界检查，并等待 500px/600px/900px 实际几何满足条件后再断言，消除 resize 后采样旧布局的竞态。
- 当前前端全量 Vitest **99 个测试文件、690 项通过**；TypeScript、仓库 lint、Prettier、production build、verify:smoke 和 `git diff --check` 均通过。构建仍保留既有 Tauri 混合导入与 Monaco 大 chunk 警告。

### 2026-09-07 compact 恢复与菜单焦点收口

- compact 进入前记录侧栏/Agent 的布局状态；返回宽屏时只恢复未被作者在窄屏期间手动覆盖的维度，避免覆盖活动栏或标题栏的明确选择。
- 侧栏或 Agent 内的控件在窄屏卸载/隐藏前记录焦点来源；布局完成后分别回到当前活动栏入口或标题栏 Agent 切换按钮，body 获得焦点时保持原生行为。焦点来源在 resize 捕获阶段记录，避免 React 提交隐藏面板后丢失。
- 右键菜单支持显式回焦点目标，资源树、编辑器页签和设置菜单关闭或执行动作后回到实际触发控件；菜单键盘导航继续忽略 IME 组合输入。
- compact 边界回归覆盖 719px 启用、720px 退出；`workspace-layout-app`、菜单和页签定向回归 **23 项通过**。
- 最新前端全量 Vitest **99 个测试文件、693 项通过**；TypeScript、仓库 lint（含 Prettier check）、production build、verify:smoke 和 `git diff --check` 均通过。Chromium smoke 覆盖 1024/900/600/500/1280px 项目态与标题栏边界。
- 仍未验证真实 Tauri/WebView2、屏幕阅读器、中文 IME、provider 请求和真实补丁写回；构建保留既有 Tauri 混合导入与 Monaco 大 chunk 警告。

### 2026-09-07 作品档案与项目打开焦点

- 真实 Chromium 审计确认欢迎页、1280px 项目态和 600px compact 项目态没有横向溢出或控制台错误；临时 Vite 预览使用隔离项目和模拟文件系统。
- 作品档案的书名、题材、简介、全书目标、灵感速记输入现在都有稳定的 label/`aria-labelledby` 关联，屏幕阅读器不再只读出无上下文的编辑框。
- 从欢迎页打开最近项目后，原触发按钮卸载留下的 `body` 焦点只在没有其他控件接管时转移到当前活动栏入口；编辑器或命令流程主动接管焦点时不会被抢回。
- 权限档位菜单点击不可聚焦的外部背景会回到入口，点击外部按钮等可聚焦控件则保留原生焦点移动；相关定向回归 **30 项通过**。
- 最新前端全量 Vitest **99 个测试文件、695 项通过**；TypeScript、仓库 lint（含 Prettier check）、production build、verify:smoke 和 `git diff --check` 均通过。构建仍保留既有 Tauri 混合导入与 Monaco 大 chunk 警告。
- 仍未验证真实 Tauri/WebView2、屏幕阅读器、中文 IME、provider 请求和真实补丁写回；持续 UI/UX 目标保持 active。

### 2026-09-07 动态面板焦点与图标控件名称

- Knowledge Inbox 的编辑、审阅预览和写回关闭路径现在将焦点落到明确的标题或原触发按钮；编辑器首字段在进入编辑态时自动聚焦，Escape 取消不会把焦点留在 `body`。
- 观测镜实体出现位置补充 `aria-expanded`、`aria-controls` 与内容区域关系；无定位回调时不再留下可操作但无动作的按钮。
- 底部观测面板声明命名区域，打开后焦点落到关闭入口，关闭后回到状态栏观测入口；状态栏入口只在面板存在时声明 `aria-controls`。
- 观测行定位控件改为原生按钮；没有定位锚点的行使用禁用状态，不再把无动作的 `span[role=button]` 放进键盘路径。
- 欢迎页关闭与编辑器文件操作图标补齐显式 `aria-label`。
- 本轮动态面板、焦点和图标控件定向回归通过；前端全量 Vitest **99 个测试文件、699 项通过**；TypeScript、仓库 lint（含 Prettier check）、production build、verify:smoke 和 `git diff --check` 均通过。真实 Chromium smoke 额外覆盖观测面板打开/关闭后的焦点往返与 disclosure 属性。
- 真实 Tauri/WebView2、屏幕阅读器、中文 IME、provider 请求和真实补丁写回仍需外部环境验证。

### 2026-09-07 动态步骤与版本面板焦点收口

- Agent 步骤折叠按钮补充 `aria-controls`，内容区声明 `aria-hidden`；折叠后的步骤按钮移出 Tab 顺序，装饰性星号和箭头不再污染可访问名称。
- 版本历史成为命名 `region`，打开后焦点落到关闭按钮，Escape 可关闭并沿用编辑器原有入口回焦点；新增打开焦点和 Escape 行为回归。
- 拒绝修订表单的顶部按钮在显示“取消”时只收起草稿并恢复入口焦点；上下文选择、恢复状态和写作进度补充 disclosure、pressed、live region 与 busy 语义。
- 前端定向回归覆盖版本历史、Agent 步骤和聊天动态控件；全量 Vitest **99 个测试文件、703 项通过**。TypeScript、仓库 lint（含 Prettier check）、production build、verify:smoke 和 `git diff --check` 均通过。
- 构建保留既有 Tauri event 动静态导入和 Monaco 大 chunk 警告；真实 Tauri/WebView2、屏幕阅读器、中文 IME、provider 请求和真实补丁写回仍需外部环境验证。

### 2026-09-07 设置窄屏布局与导航状态

- 真实 Chromium 检查发现 500px 设置弹窗的固定侧栏挤压表单，字段标签会逐字竖排；设置页现在在窄屏隐藏侧栏、将设置行堆叠为单列，并提供可见的移动端“返回”入口。
- 设置页的模型探测、连接测试异步状态补充 `status`/`alert`、`aria-live` 和 `aria-busy`；故事导航 tab 与动态 `tabpanel` 增加稳定的 `id`、`aria-controls` 和 `aria-labelledby` 关联。
- `verify:smoke` 新增 500px 设置布局断言：设置弹窗与文档不横向溢出，字段控制项位于标签说明之后，移动端关闭按钮可见并可用。
- 设置与故事导航定向回归 **10 项通过**；前端 smoke、TypeScript、仓库 lint（含 Prettier check）和 `git diff --check` 通过。全量回归随后复验。
- 真实 Tauri/WebView2、屏幕阅读器、中文 IME、provider 请求和真实设置写入仍需外部环境验证。

### 2026-09-07 章节简报焦点恢复与最终前端门禁

- `ChapterBriefCard` 在挂载时把焦点落到章节目标字段，Escape 触发取消；卸载时捕获稳定的卡片节点引用，并将焦点还给打开前仍连接的控件，避免 React 卸载阶段读取变化中的 ref。
- 章节简报测试夹具将 opener 放到 React root 外部，真实覆盖焦点恢复路径；移除临时调试输出。
- 前端全量 Vitest **99 个测试文件、705 项通过**；TypeScript、仓库 lint（含 Prettier check）、production build、`verify:smoke` 和 `git diff --check` 均通过。构建保留既有 Tauri 混合导入与 Monaco 大 chunk 警告。
- 真实 Tauri/WebView2、屏幕阅读器、中文 IME、provider 请求和真实补丁写回仍需外部环境验证。

### 2026-09-08 搜索、资源树与编辑器面板语义收口

- Toast 在 320px 视口增加 `max-w-[calc(100vw-1.5rem)]`，避免通知右边界超出窗口；工作区三栏断点从 719px 调整为 899px 以下进入编辑聚焦、900px 保留三栏，覆盖 899/900px 几何回归。
- Composer、补丁审查、运行操作栏、Knowledge Inbox、权限档位、状态栏及多个菜单补齐条件性的 `aria-controls`、稳定关联 id 和按钮名称；Composer 角色建议移出 Tab 序列，Knowledge Inbox 待处理数量并入活动栏按钮名称。
- Escape 处理增加中文输入法组合保护（`isComposing` / `keyCode=229`），覆盖行间聊天与版本历史；搜索文件结果、资源树文件夹、版本历史筛选/视图/对比当前、编辑器页签分别补齐 `aria-expanded`、`aria-pressed`、`aria-controls`、`role=group/region` 和 `editor-panel` 关联，折叠内容通过 `hidden` 表达。
- 定向搜索、资源树、版本历史和页签回归 **4 个文件、33 项通过**；前端全量 Vitest **100 个测试文件、721 项通过**。
- `pnpm.cmd lint`、前端 `typecheck`、production `build`、`verify:smoke` 和 `git diff --check` 全部通过。构建仍保留既有 Tauri event 动静态导入与 Monaco 大 chunk 警告；smoke 通过真实 Chromium。
- 仍未验证真实 Tauri/WebView2、屏幕阅读器、中文 IME 硬件行为、provider 请求和真实补丁写回。

### 2026-09-08 接手复验与静态/视觉审查

- 原会话因 `401 invalid_api_key` 无法继续；在共享工作树上接手后未重置或清理既有未提交改动。
- 重新执行前端完整门禁：Vitest **100 个测试文件、722 项通过**；TypeScript、`pnpm.cmd lint`（含 Prettier）、production build、`verify:smoke` 和 `git diff --check` 均通过。
- 真实 Chromium smoke 的 320px 欢迎页、900px 工作区和既有 360/500/600px 审计截图复核未发现横向溢出、断裂控件或控制台级新问题；构建仍只有既有 Tauri event 动静态导入与 Monaco 大 chunk 警告。
- 只读 ARIA/焦点审查确认欢迎页“更多”按钮已关联隐藏的最近项目区域并声明展开状态，观测镜提示点已标记为装饰性内容；补充 `welcome-page` 与 `observatory-linkage` 回归共 **16 项通过**。本轮只补可访问性语义，不改变业务行为。
- 仍未验证真实 Tauri/WebView2、屏幕阅读器、硬件中文 IME、provider 请求和真实补丁写回；未提交或推送。

### 2026-09-08 页签关系与最终门禁复验

- 故事导航的“文件 / 故事”两个页签现在始终指向同一个稳定 `tabpanel` ID，切换前后辅助技术都能保持页签与面板关系。
- 将运行控制、章节简报和编辑器页签的 SSR 回归断言改为 DOM 属性验证，避免 React 属性输出顺序变化造成误报。
- 最终前端全量 Vitest **100 个测试文件、736 项通过**；TypeScript、`pnpm.cmd lint`（含 Prettier）和 `git diff --check` 通过。此前同一工作树上的 production build 与 `verify:smoke` 也已通过。
- 构建保留既有 Tauri event 动静态导入与 Monaco 大 chunk 警告；真实 Tauri/WebView2、屏幕阅读器、硬件中文 IME、provider 请求和真实补丁写回仍需外部环境验证；未提交或推送。

### 2026-09-08 动态操作区与树焦点收口

- 资源树改为 roving `tabIndex`：Tab 只进入一个当前节点，方向键移动后由当前节点接管；刷新或节点删除使路径失效时回退首项，边界方向键不再滚动外层面板。
- 左侧视图容器改为带动态名称的 `aside` 地标，Agent 右栏补充“Agent 对话面板”地标；项目菜单分隔线补充水平 separator 语义。
- 作品封面按钮补充可访问名称；分支画布选中版本的操作区补充 `aria-expanded`、`aria-controls` 和命名 region。
- Composer 在无项目/加载时禁用无效上下文操作并声明角色建议 autocomplete；补丁审查防止重复异步操作并恢复拒绝后的焦点；版本历史筛选空态、对比加载和恢复并发状态得到明确反馈。
- 定向回归 **10 个文件、98 项通过**；前端全量 Vitest **100 个测试文件、733 项通过**。
- `pnpm.cmd lint`（含 Prettier）、前端 `typecheck`、production `build`、`verify:smoke` 和 `git diff --check` 均通过；构建仍保留既有 Tauri event 动静态导入与 Monaco 大 chunk 警告。
- 仍未验证真实 Tauri/WebView2、屏幕阅读器、硬件中文 IME、provider 请求和真实补丁写回；未提交或推送。

### 2026-09-08 资源树键盘导航与接手收口

- 修正编辑器页签语义回归断言：通过 DOM 解析确认文件操作菜单不在 `tablist` 内，避免用跨层级字符串正则误报。
- 资源树增加命名 `tree`、文件/文件夹 `treeitem` 及 `aria-level`；折叠子树继续由稳定 `aria-controls` 和 `hidden` 表达。
- 资源树支持 ArrowUp/Down、ArrowLeft/Right、Home/End：上下移动可见项，左右折叠/展开或回到父级，隐藏子树不会进入移动序列。
- 新增资源树语义与方向键回归；本轮定向回归 **6 个文件、67 项通过**，前端全量 Vitest **100 个测试文件、726 项通过**。
- `pnpm.cmd lint`（含 Prettier）、前端 `typecheck`、production `build`、`verify:smoke` 和 `git diff --check` 均通过；构建仍保留既有 Tauri event 动静态导入与 Monaco 大 chunk 警告。
- 仍未验证真实 Tauri/WebView2、屏幕阅读器、硬件中文 IME、provider 请求和真实补丁写回；未提交或推送。

### 2026-09-08 接手后最终门禁复验

- 前端全量 Vitest **100 个测试文件、736 项通过**。
- 前端 TypeScript、仓库 lint（含 Prettier）、production build、`verify:smoke` 和 `git diff --check` 全部通过。
- 只读复查确认观测面板 Escape 关闭、上下文菜单 separator 语义、资源树 tree/treeitem 与方向键导航均已落地；未发现新的可复现焦点、ARIA 或窄屏溢出问题。
- 构建仍保留既有 Tauri event 动静态导入与 Monaco 大 chunk 警告；真实 Tauri/WebView2、屏幕阅读器、硬件中文 IME、provider 请求和真实补丁写回仍需外部环境验证；未提交或推送。

### 2026-09-08 Knowledge Inbox 并发状态修复

- 修复拒绝提议请求的旧闭包会误清理后来打开的另一条写回预览：`useKnowledgeInbox.reject` 现在基于最新 `reviewPatch` 做函数式条件更新。
- 新增回归覆盖“预览 A → 拒绝 A 未返回 → 打开预览 B → A 晚返回”，确认 B 保持打开。
- 前端全量 Vitest **101 个测试文件、737 项通过**；TypeScript、仓库 lint（含 Prettier）、production build、`verify:smoke` 和 `git diff --check` 全部通过。
- 构建仍保留既有 Tauri event 动静态导入与 Monaco 大 chunk 警告；真实 Tauri/WebView2、屏幕阅读器、硬件中文 IME、provider 请求和真实补丁写回仍需外部环境验证；未提交或推送。


### 2026-09-08 原任务接手续修：Knowledge Inbox 保存失败保留草稿

- 接手任务：`01a0777c-2cbe-7702-b705-cc81ae192aeb`（继续 StoryForge Desktop UI/UX 优化）。通过任务读取工具获得历史，无需扫描本地 sessions。
- 继续工作的代码根：`C:/Users/kanye/.codex/worktrees/d84b/StoryForge`，保留原 detached worktree 的全部已有未提交修改；未向 `D:/StoryForge` 复制产品代码，未提交、推送、归档或新建任务。
- 项目 Trellis 元数据仅存在于主 checkout：从 `D:/StoryForge/.trellis/tasks/09-06-desktop-uiux-optimization` 恢复 in_progress 计划与既有只读 shell 检索授权。补充的编辑结果规则追加到主 checkout 的 `.trellis/spec/desktop/frontend/state-management.md`，明确注明实现尚在 worktree。

#### 本轮问题与最小修复

- 真实 hook + KnowledgeInboxView 挂载复现：进入提议编辑 → 输入新标题 → 保存请求失败。旧 `revise` 捕获异常后正常结束 Promise，View 的无条件 `.then()` 关闭编辑器，丢弃未保存草稿。
- 新增两条 API 边界回归，分别注入 Error 和非 Error 拒绝；修复前均在“保存失败后不能卸载编辑器或丢弃草稿”断言失败。既有“旧拒绝请求晚返回不清理新预览”测试仍通过。
- `useKnowledgeInbox.revise` 明确返回 `Promise<boolean>`：成功为 true，失败/无项目为 false；保留既有错误呈现和 busy 清理。View 仅在成功后关闭草稿、恢复编辑入口焦点。
- 回归同时验证请求携带作者修改、失败后原编辑节点/输入/焦点保持、错误可见，以及原草稿重试成功后的新内容呈现、错误清理与焦点恢复。
- 同步 View 测试 mock 的成功结果；修正既有拒绝回归使用 Inbox 响应结构，并用 fake timers 隔离轮询、统一 reset mock，未绕开真实 hook/View。
- 本轮代码/测试仅涉及 `apps/desktop/frontend/src/components/app/useKnowledgeInbox.ts`、`apps/desktop/frontend/src/components/shell/KnowledgeInboxView.tsx`、`apps/desktop/frontend/tests/use-knowledge-inbox.test.tsx`、`apps/desktop/frontend/tests/knowledge-inbox.test.tsx`。保持 LF，避免整文件换行差异。

#### 已执行验证

所有命令在上述 worktree 执行；API 命令的工作目录为其 `apps/api`。

- `pnpm.cmd --dir apps/desktop/frontend exec vitest run tests/use-knowledge-inbox.test.tsx`：修复前 **2 failed / 1 passed**，失败点符合目标缺陷。
- `npm.cmd --prefix apps/desktop/frontend run test -- tests/use-knowledge-inbox.test.tsx tests/knowledge-inbox.test.tsx tests/knowledge-writeback.test.ts`：修复后 **3 files / 15 passed**。
- `npm.cmd --prefix apps/desktop/frontend run typecheck`：通过。
- `pnpm.cmd verify`：**失败，不能宣称总门禁通过**。前序 lint/Prettier、Desktop typecheck、Shared 契约、project-core **7 passed**、Desktop 全量 **101 files / 739 passed**；API pytest **1590 passed / 7 skipped / 2 failed**，耗时 220.54 秒。
- 两项失败均来自本轮未修改的 `AppShell.tsx`：当前 **648 行 > 500 行**。失败测试为 `test_completed_wave_source_files_meet_hard_line_limits` 与 `test_new_live_modules_stay_within_line_limit`。按同一测试规则只读枚举确认该 live-module 检查范围内仅此文件超限，未放宽门禁或增加例外。
- `npm.cmd --prefix apps/desktop/frontend run build`：通过；仍有既有 Tauri event 混合导入及 Monaco 大 chunk 警告。
- `npm.cmd --prefix apps/desktop/frontend run verify:smoke`：真实 Chromium smoke 通过。
- 总门禁在 pytest 阶段中止，后续门禁单独补跑：`uv run ruff check .`、`node scripts/sidecar-smoke.mjs`（daily，零 LLM）、`node scripts/check-openapi-drift.mjs` 均通过；OpenAPI 无漂移。
- 四个本轮代码/测试文件的显式 `prettier --check`、`git diff --check` 均通过。
- 完整日志：`.codex/uiux-handoff-20260908/{verify,build,smoke,ruff,sidecar,drift}.log`。

#### 未验证与下一步

- 本轮没有真机 Tauri/WebView2、真实 provider、屏幕阅读器或真实知识文件写回验收；挂载回归使用 API mock，Chromium smoke 不等同于真机写回。
- 原 UI/UX 持续任务保持 in_progress。本轮单点修复完成，但工作树总门禁仍被 AppShell 行数阻断；下一步应在保留现有交互与未提交改动的前提下，以零行为变化的拆分处理该壳层问题，再复跑完整 verify。


### 2026-09-08 持续 UI/UX 优化：恢复总门禁与保存交互竞态

继续使用 `C:/Users/kanye/.codex/worktrees/d84b/StoryForge`；目标保持 active，未提交、推送或归档，原有未提交改动全部保留。上一目标回合为实质进展，本回合先处理已确认门禁阻塞，再以真实 Chromium 和挂载回归继续审查。

#### 1. AppShell 零行为变化拆分

- 将 Props 类型移至 `apps/desktop/frontend/src/components/app/app-shell-types.ts`，保留 `AppShell.tsx` 对 `ObservatoryHandle` 的类型 re-export。
- 将原项目进入焦点和 compact 布局副作用移至 `apps/desktop/frontend/src/components/app/useWorkspaceLayoutEffects.ts`，不更改原响应式算法、偏好、调用顺序或组件树。
- AppShell **648 → 456 行**；新类型模块 72 行、布局 hook 145 行，均未修改源码规范的 500 行上限或添加豁免。
- 原始快照和提取校验：`.codex/uiux-layout-20260908/AppShell.before.tsx.txt`、`extraction-check.json`。校验确认 return 组件树及搬迁的副作用代码文本一致。
- 拆分前后，同一组布局/欢迎页/Agent/侧栏/设置挂载测试均为 **6 files / 38 passed**；源码规范 **16 passed**、typecheck、lint、Chromium smoke 通过。

#### 2. 保存的迟到成功不能丢弃当前草稿或抢焦点

- Chromium 明确复现：编辑 A → 保存请求等待 → 编辑并修改 B → A 返回成功。旧界面 editorCount=0、焦点回到“编辑”，B 草稿被卸载。
- 挂载回归进一步覆盖切换提议、保存后继续输入、取消后重新编辑和外部焦点；修复前 **4 failed / 3 passed**，对应的丢稿/抢焦点断言均失败。
- `KnowledgeInboxView` 使用 layout effect 同步的当前编辑快照，并在 cleanup 失效。保存完成仅能关闭提交时同一对象；后续输入/新编辑会话不被关闭。
- 成功关闭前检查焦点仍在原编辑区域，回焦点帧再确认没有外部控件取得焦点。覆盖“请求返回前移焦点”和“返回后、回焦点帧前移焦点”。
- Chromium 修复后及最终代码复验：草稿仍为“提议 B 未保存草稿”，焦点标签为“知识标题”；600px 视口中 scrollWidth=600，无横向溢出。原始和修复截图分别保存，没有用测试自评替代界面证据。

#### 3. 保存中反馈与同表单同步防重

- Chromium 原有按钮可重复点击，pending 请求数实测 **2**。同帧连点挂载回归在旧实现上 **2 failed / 8 passed**，明确断言收到两次 API 请求。
- `ProposalEditor` 保存中显示“保存中…”并禁用保存按钮，提供 busy 状态及 busy 区域外的 status 提示；字段仍可编辑，由提交快照保护后续输入。
- 同步请求 token 阻止同一表单同帧连点；finally 仅释放自己的 token，卸载时失效，失败保留草稿并重新允许保存。此保护不宣称整个 hook 所有操作全局串行，也不代表关闭编辑取消已发出的 API 请求。
- Chromium 修复后双击实际保存请求数 **1**，禁用状态断言通过；成功/失败解锁及成功重试有挂载回归。知识相关定向测试 **3 files / 22 passed**。

#### 隔离浏览器证据与回放

- 开发夹具为 `apps/desktop/frontend/tests/fixtures/knowledge-inbox-uiux.html` / `.tsx`，挂载真实 hook 和 View。仅浏览器运行器注入的启用标记允许挂载；直接访问的 API 请求计数实测为 **0**。
- API 在浏览器请求边界拦截，materialize / resolve 一律拒绝，外部请求阻断；未使用真实项目、provider 或知识写回。最初直接访问测试误把静态 `/src/lib/api/*` 模块当作 API 请求拦截，随后按 fetch/xhr 资源类型修正测试路由并通过；未修改产品代码规避该测试。
- 截图：`output/playwright/uiux-inbox-20260908/`，包含 `after-save-completes.png`（旧缺陷）、`fixed-after-save-completes.png`（最终草稿/焦点保持）、`pending-save-button.png`、`fixed-pending-save-button.png`。
- 回放片段：`.codex/uiux-layout-20260908/replay/{setup,race,race-fixed,double-save,double-save-fixed,fixture-guard}.cjs`。它们是 Playwright CLI 函数参数，不是产品 JS 模块；第一次总门禁因放在 output 下被源码扫描报错，已移入既有 `.codex` 诊断目录，未放宽 lint 配置。原失败日志保留为 `verify-diagnostic-location-failed.log`。
- 回放：在 worktree 以 `pnpm.cmd --dir apps/desktop/frontend exec vite --host 127.0.0.1 --port 3011` 启动；用命名 Playwright CLI 会话打开 about:blank，依次执行 `run-code --filename .codex/uiux-layout-20260908/replay/setup.cjs`、`snapshot`、对应的 `race-fixed.cjs` 或 `double-save-fixed.cjs`。切换场景前重跑 setup。所有模拟数据均明确标注为验收夹具。
- 本轮命名浏览器 `uiux-inbox-20260908` 与独立 3011 预览服务已关闭，未操作其他浏览器/预览服务。

#### 最终门禁

- `pnpm.cmd verify`：**全部本地核心门禁通过**。Desktop **101 files / 746 passed**；API **1592 passed / 7 skipped / 6 warnings**（219.98 秒）；Shared 契约、project-core **7 passed**、lint/Prettier、typecheck、Ruff、daily sidecar 与 OpenAPI 刷新/漂移检查通过。
- `npm.cmd --prefix apps/desktop/frontend run build`：通过；既有 Tauri event 混合导入及 Monaco 大 chunk 警告仍在。
- `npm.cmd --prefix apps/desktop/frontend run verify:smoke`：最终真实 Chromium smoke 通过。
- 本轮文件显式 `prettier --check`、`git diff --check`：通过。OpenAPI / Agent schema / generated types 无新增漂移。
- 详细日志统一在 `.codex/uiux-layout-20260908/`：`verify.log`、`build.log`、`smoke.log`、`inbox-regression-red.log`、`inbox-duplicate-red.log`、`inbox-browser-evidence.log`、`inbox-double-save-fixed-evidence.log`、`fixture-guard-evidence.log`。
- 规范同步到主 checkout 的 `.trellis/spec/desktop/frontend/state-management.md`，明确注明实现只在 worktree，未合并主 checkout 产品代码。

#### 持续目标的未覆盖项

本轮不是“UI/UX 已无可优化点”的完成证明。继续优先审查项目切换/关闭、面板卸载与迟到响应的归属，以及其他创作面板的真实交互。真实 Tauri/WebView2、多轮 provider、屏幕阅读器、硬件中文 IME 和真实手稿写回仍未在本轮验收；不把 mock/Chromium/自动测试当作完整创作工作流或长篇质量验收。

## 2026-09-08：Knowledge Inbox 跨项目生命周期隔离

实现仅在 `C:/Users/kanye/.codex/worktrees/d84b/StoryForge`，未复制回主 checkout、未提交/推送。保留前序未提交修改。

### 修复与边界

- `useKnowledgeInbox` 用 committed project lifetime 授权回调，独立 scope stamp 投影状态；切项目/关闭立即不再暴露旧 inbox、preview、busy、error，A→B→A 不恢复第一代回调资格。所有异步结果与 finally 必须属于当前 lifetime。
- `KnowledgeInboxView` 按 projectRoot 重建编辑/标签状态；卸载清理待执行焦点帧。旧草稿和旧焦点回调不进入新项目同 ID 条目。
- `accept(): Promise<boolean>` 只有当前项目成功完成才返回 true 并恢复预览入口焦点；失败保留预览/焦点。已启动的写回仍使用原项目及原 patch，不宣称关闭项目能取消已授权写回；过期结果不触发新项目 toast 或后续旧项目刷新。
- 不改 API/DTO、guarded writeback 或文件写回权限；同项目多次 materialize 乱序、刷新与 mutation 排序仍是后续检查点，不宣称所有并发安全。

### 验证

- 新 `tests/knowledge-inbox-lifecycle.test.tsx` 初始 39 cases 在旧实现为 **33 failed / 6 passed**；最终扩充为 50 cases，覆盖切 B、关闭、A→B→A、卸载、成功/失败、过期 callbacks、toast、busy 和焦点。
- 四个 Knowledge Inbox/writeback 测试文件 **72 passed**；frontend typecheck、`pnpm.cmd lint` 通过。
- 原样 `pnpm.cmd verify` exit 0：frontend **102 files / 796 passed**，project-core **7 passed**，API **1592 passed / 7 skipped / 6 warnings**，Ruff、daily sidecar、OpenAPI drift 门禁通过。
- frontend production build 与 Chromium `verify:smoke` 均 exit 0。构建仍有现有 chunk > 500 kB 警告，未修改阈值或规则。
- 独立 Chromium + 3012 Vite fixture：按 project_root 返回同 proposal_id 的不同项目内容；延迟 A materialize，先显示 B，再释放 A，B 预览与 H3 焦点保持；A 未保存草稿切 B 后不残留；关闭项目后 preview 清空。截图已人工查看渲染，B 内容清楚且无水平截断。
- 浏览器所有 knowledge API 被拦截，除 refresh/materialize 外均拒绝；mock filesystem 的 pathExists 抛错，阻断真实文件访问。未点击真实写回，未调用真实 provider。CLI 首次旧 element refs 失效，重新 snapshot 后用已观察到的语义控件重放成功，最终脚本日志无 `### Error`。
- 证据目录 `.codex/uiux-inbox-lifecycle-20260908/`：`regression-red.log`、`verify.log`、`lint.log`、`build.log`、`smoke.log`、`browser-cross-project.log`、`browser-draft-close.log`、`browser-results.log`，可重放脚本在 `replay/`；截图在 `output/playwright/uiux-inbox-lifecycle-20260908/`。

真实 Tauri/WebView2、真实手稿写回、多轮 provider、屏幕阅读器和硬件 IME 本轮未验收。本轮不构成“已无 UI/UX 可优化点”的完成证明。

## 2026-09-08：Knowledge Inbox 同项目预览顺序

上一回合为有效进展。本轮继续原 worktree，不改主 checkout 产品代码、不提交/推送。

- 复现：依次请求预览 A、B，A 的迟到成功覆盖 B / 新 B 等待中显示 A，迟到失败污染错误；已有预览关闭后，另一个尚未完成的 materialize 可重新打开预览。
- `useKnowledgeInbox` 的 committed project lifetime 新增独立 `reviewVersion`；开始 materialize 递增，成功/失败只有最新版本可以更新展示；clearReview 递增使待展示请求失效。busy 的释放仍按原 operation token，未更改 API 或写回语义。该版本只管理预览请求选择，不宣称同项目 mutation/refresh 全部排序安全。
- 新增 6 项行为回归：新请求等待/完成 × 旧请求成功/失败，以及关闭后成功/失败；旧实现 **6 failed / 10 passed**，修复后四个知识相关测试 **78 passed**。
- 完整 `pnpm.cmd verify` exit 0；frontend **102 files / 802 passed**，project-core **7 passed**，API **1592 passed / 7 skipped**，lint/typecheck/Ruff/daily sidecar/OpenAPI drift 均通过。
- production build、Chromium smoke、Prettier 和 `git diff --check` 通过；仍有既有大 chunk 警告，未绕过规则。
- 隔离 Chromium 在同一 project_root 下先请求 A 再 B，释放 A 后 B 预览和 H3 焦点保持；再次延迟 A 后关闭已有 B 预览，释放 A 后不重开且外部焦点保持。截图已查看。夹具标题中的 A/B 是模拟提议标签，本场景没有切项目；所有 API 均拦截，无真实写回/模型调用。
- 重放/日志：`.codex/uiux-inbox-order-20260908/` 的 `red.log`、`green.log`、`verify.log`、`build.log`、`smoke.log`、`browser-results.log`、`replay/setup.cjs`、`replay/race.cjs`；截图 `output/playwright/uiux-inbox-order-20260908/latest-review.png`。已关闭本轮专用 Chromium session 和 3012 Vite。

未验证真实 Tauri/WebView2、provider、硬件 IME、屏幕阅读器或真实文件写回。后续继续检查同项目刷新覆盖 mutation、已授权写回完成对后来预览的影响，以及整体 UI/UX 验收缺口；不标记持续目标完成。

## 2026-09-08：Knowledge Inbox 迟到写回保留新预览和作者焦点

- 上轮为有效进展，本轮继续 d84b worktree，保留前序修改、未提交/推送。
- 当前实现复现：确认写回后打开另一份预览，旧 applyKnowledgePatch 成功无条件置空 reviewPatch；成功回调安排的 rAF 无条件把焦点还给原审阅入口。
- 修复：写回成功的 functional state update 仅清理与提交 patch 同一对象的预览，不能按 proposal_id 推断展示会话（同 ID 重开也必须保留）；写回成功回焦点在 rAF 执行时检查 body，作者已移到其他控件则不抢焦点。显式关闭仍保留原回焦点语义。
- 写回继续用原 projectRoot/patch，成功结果、toast 和刷新契约不变；不取消已授权写回，不绕过 guarded writeback，也不将新预览存在误报为写回失败。
- 新增 4 项回归在旧实现 **4 failed / 50 passed**，覆盖同/不同 proposal ID 新预览，以及结果前/结果后至帧执行前的外部焦点移动；修复后知识相关四文件 **82 passed**。
- 原样 `pnpm.cmd verify` exit 0：frontend **102 files / 806 passed**、project-core **7 passed**、API **1592 passed / 7 skipped**；lint/typecheck、Ruff、daily sidecar 和 OpenAPI drift 通过。
- production build、Chromium smoke、Prettier、`git diff --check` 通过。沿用既有 chunk 大小警告，未改规则。
- 日志：`.codex/uiux-inbox-accept-20260908/{red,green,verify,build,smoke}.log`。竞态验证使用真实 hook + View 和延迟 mock writeback；本轮无真实文件写回或该竞态的独立浏览器重放，不把通用 smoke 当成原生写回验收。

持续目标未完成。后续优先核查刷新响应覆盖更新后列表，以及更广的编辑/Agent 交互；真实 provider 与完整创作写回链仍不在本轮验证声明内。

## 2026-09-08：旧刷新不得覆盖 Knowledge Inbox 操作结果

- 上轮为有效进展；本轮仍在 d84b worktree，未提交/推送，主 checkout 产品代码未改。
- 复现：refresh 在 revise/reject 之前或进行期间启动，操作成功返回完整 inbox 后，旧 refresh 成功覆盖新列表、失败覆盖为过期错误。
- 修复：revise/reject 成功返回完整 inbox 时递增该 lifetime 的 refreshVersion，使之前发起的 refresh 成功/失败/finally 全部失效；同时释放被淘汰刷新对应的 loading。后续新刷新仍照常工作。失败 mutation 不伪造新列表；不改变 API、请求载荷或真实写回语义。
- 新增 8 项真实 hook 回归：revise/reject × 刷新先/后启动 × 旧刷新成功/失败；旧实现 **8 failed / 54 passed**，修复后四个知识测试文件 **90 passed**，并断言后续新刷新能够正常更新与释放 loading。
- 原样 `pnpm.cmd verify` exit 0：frontend **102 files / 814 passed**，project-core **7 passed**，API **1592 passed / 7 skipped**；lint/typecheck、Ruff、daily sidecar、OpenAPI drift 均通过。
- production build、Chromium smoke、Prettier、`git diff --check` 通过，未调整既有大 chunk 警告规则。
- 独立 Chromium：真实 hook/View 的隔离 fixture 中编辑标题 → 暂挂旧刷新 → 保存成功显示新标题 → 释放旧刷新 → 新标题仍在、aria-busy=false；截图已查看。API 全部拦截，materialize/resolve 拒绝，无真实项目或文件写回。本轮专用 browser 和 3012 Vite 已关闭。
- 证据 `.codex/uiux-inbox-refresh-20260908/`：red/green/verify/build/smoke/browser-results 日志与 `replay/` 重放脚本；截图 `output/playwright/uiux-inbox-refresh-20260908/saved-title-preserved.png`。

持续目标未完成。本轮证明的是旧 read 不覆盖 mutation 结果，不证明多个 mutation 的服务端提交顺序或全部创作链已验收。后续应回到更广的工作区/编辑器/Agent 键盘、动态状态与布局审查，避免把单个面板测试通过当作全局完成。

## 2026-09-08：Composer 方向键保留原生文字编辑

- 上轮为有效进展；本轮转向 Agent 输入交互，仍只改 d84b worktree，保留前序修改，未提交/推送。
- 复现：Shift/Ctrl/Alt/Meta+ArrowUp 在草稿首部触发历史回溯，或改变角色候选；busy=true 时角色列表隐藏但 ArrowUp/Down 仍被角色逻辑 preventDefault。
- 修复：Enter/IME 原有处理不变，其余带修饰键的方向键交还浏览器；用同一 showRoleSuggestions 条件管理渲染、ARIA 和方向键处理。plain arrows 仍可选择可见角色，历史边界逻辑未改变，busy 期间仍可预写。
- 新增 10 项测试在旧实现 **10 failed / 10 passed**，修复后相关测试 **20 passed**。覆盖四种 modifier × 历史/候选，以及 busy 隐藏候选的上下键。
- `pnpm.cmd verify` exit 0：frontend **102 files / 824 passed**、project-core **7 passed**、API **1592 passed / 7 skipped**；lint/typecheck/Ruff/daily sidecar/OpenAPI drift 通过。build、Chromium smoke、Prettier、git diff --check 通过，既有大 chunk 警告未绕过。
- Chromium 隔离挂载真实 ComposerSurface：Shift+Up 不替换草稿，在多行末尾产生原生选区 [7,11]；Shift+Up 不切角色、普通 Down 仍切角色；busy 下 Up 从末行移动至前行 caret=3。截图已查看。无 API、真实项目或 provider 调用。
- 夹具初始化曾因 Vite CommonJS default 导出未解包失败，已纠正；路由拦截从 URL-only 收窄到 fetch/xhr，避免拦截静态 api/*.ts；模拟运行按钮被角色浮层覆盖，重放改为先清输入再切 busy，不强制点击或改产品布局。最终从重新导航的基线运行成功，最终脚本日志无 Error。
- 证据 `.codex/uiux-composer-keys-20260908/` 的 red/green/verify/build/smoke/browser-results 日志及 replay 脚本；截图 `output/playwright/uiux-composer-keys-20260908/native-selection.png`。本轮专用 Chromium 和 3012 Vite 已关闭。

本轮没有硬件中文 IME、屏幕阅读器、真机 Tauri/provider 验收；不宣称完整 UI/UX 已无优化点。继续审查编辑/Agent 的动态输入、焦点与布局边界。

## 2026-09-08：角色候选退出与点击后续写

- 上轮为有效进展，本轮继续 d84b worktree；未提交/推送、保留前序更改。
- 修复 Composer 角色候选无法 Escape 关闭，以及点击后焦点落到消失按钮而不能继续输入的问题。
- Escape 仅在候选可见时 preventDefault/stopPropagation，记住被关闭的 value；草稿和输入焦点不变，ARIA 同步收起，再次 Escape 不拦截。实际输入变化重新允许候选；Enter 使用同一可见条件，不能选择已关闭的角色。IME 守卫保持在 Escape 前。
- 角色插入是显式编辑，退出历史回溯并同步恢复 textarea 焦点；不调用 onSubmit，不引入延迟抢焦点。
- 3 个新增回归在旧实现 **3 failed / 20 passed**，修复后 **23 passed**；包括 Escape 后 Enter 正常调用 submit、继续输入重现候选，以及 pointer 选择后的焦点/不提交断言。首次红测因 DOM 对象差异格式化停滞，已终止该测试进程，改为布尔身份断言后重新获得红测结果。
- 原样 `pnpm.cmd verify` exit 0：frontend **102 files / 827 passed**、project-core **7 passed**、API **1592 passed / 7 skipped**；lint/typecheck/Ruff/daily sidecar/OpenAPI drift 通过。production build、Chromium smoke、Prettier、git diff --check 通过，未绕过既有 chunk 警告。
- 独立 Chromium 挂载真实 Composer：输入 @ → Escape 保留 @ 并关闭 → 继续输入重开 → 点击 @剧情 → 不再点击输入框直接输入“继续写作”，最终内容“@ @剧情 继续写作”；已查看截图。本轮无 API/provider/真实写回。
- 证据 `.codex/uiux-role-dismiss-20260908/` 日志与 replay 脚本；截图 `output/playwright/uiux-role-dismiss-20260908/continued-input.png`；专用 Chromium 和 3012 Vite 已关闭。

未完成整体目标。硬件 IME、屏幕阅读器、真实 Tauri/provider/写回工作流未在本轮验收，继续审查其他可复现的编辑/焦点/动态状态问题。

## 2026-09-08：窄栏 Composer 固定参考可展开管理

- 上轮为有效进展，本轮继续 d84b worktree，未提交/推送，保留已有更改。
- 旧实现超过 3 个固定参考仅渲染不可交互 +N span，第 4 项以后不可直接取消；工具栏单行不换行，多个固定宽度标签挤占发送区域。
- 改为原生 button（aria-expanded/可访问名称）切换全部参考，保留默认 3 项折叠；展开后逐项调用原 onTogglePinnedContext(path)，不批量删除前面的参考。工具栏 flex-wrap，保持发送按钮可达。disabled 时取消固定按钮也禁用。
- 新增 2 项回归在旧实现 **2 failed / 23 passed**，修复后 **25 passed**；断言展开/取消第 4 项精确路径/收起与 disabled 边界。
- 完整 `pnpm.cmd verify` exit 0：frontend **102 files / 829 passed**，project-core **7 passed**，API **1592 passed / 7 skipped**；lint/typecheck/Ruff/daily sidecar/OpenAPI drift 通过。build、Chromium smoke、Prettier、git diff --check 通过，既有 chunk 警告未绕过。
- 隔离 Chromium 的 320px Composer 中，5 个参考按 Enter 展开，全部按钮处于工具栏边界内（clientWidth=scrollWidth=318）；点击第 4 个取消后其他参考保留，Space 收起恢复前三个。已查看展开截图，发送与取消控件均可见。无 API/provider 或真实文件操作。
- 证据 `.codex/uiux-context-pins-20260908/` 的日志、replay 脚本；截图 `output/playwright/uiux-context-pins-20260908/expanded-320.png`。专用 Chromium/3012 Vite 已关闭。

持续目标未完成；本轮只证明参考管理和局部窄栏布局，不能代替完整 Tauri/Agent 创作链验收。继续检查动态移除焦点和会话切换时输入状态等交互。

## 2026-09-08：Composer 会话归属与历史草稿隔离

- 上轮为有效进展，本轮继续 d84b worktree，未提交/推送，保留全部前序修改。
- 复现：A 会话草稿按 Up 回溯历史，切另一会话/新草稿/另一项目后按 Down，Composer 内 draftRef 会把 A 草稿送入新会话的 onChange。
- 最终修复为 `useComposerScope`：layout effect 比较项目/会话并生成 Composer key；只有 Composer 重建，不重建 MessageList、Agent 运行时或父输入 state。同一会话重渲染保留节点与历史草稿恢复；显式新建（包括 null→null）单独递增 generation。
- 首次方案直接用 project/session key，通过了最初切换回归，但源码证据表明 selfPersistedSessionIdRef 代表当前草稿首次持久化，不是导航。补充该边界后改为在 layout effect 读取 marker，首次获得 ID 保留输入节点/焦点；无 render ref 读取。marker 逻辑放独立 hook，避免 React refs 分析把整个 view state 判为 ref；未禁用 lint 规则。
- 最初红测 **3 failed / 2 passed**；细化阶段新增两个边界在首次方案 **2 failed / 5 passed**。最终新增共 6 项回归；相关 3 文件 **36 passed**，涵盖旧草稿不跨项目/会话、同会话保留、首次持久化保持焦点、草稿态显式新建清缓存。测试挂载真实 ChatWindowView/Composer，父 state/handlers 为测试夹具。
- 最终原样 `pnpm.cmd verify` exit 0：frontend **102 files / 835 passed**、project-core **7 passed**、API **1592 passed / 7 skipped**；lint/typecheck/Ruff/daily sidecar/OpenAPI drift 全过。
- 最终 production build、Chromium smoke、Prettier、git diff --check 通过。早期 verify/build 不用于证明最终实现；仅以 verify-final/build-final/smoke-final 日志为最终依据。既有大 chunk 警告未绕过。
- 证据 `.codex/uiux-composer-scope-20260908/`：red/refinement-red/green 日志与 lint-final/verify-final/build-final/smoke-final 日志。

本轮未做该竞态独立浏览器重放或真实 provider/持久化端到端，仅有组件边界行为证据和通用 Chromium smoke。整体目标仍未完成，继续审查动态控件焦点与整体创作流，不宣称 UI/UX 已无可优化点。

## 2026-09-08：取消固定参考后的连续键盘操作

- 上轮为有效进展。本轮继续 d84b worktree，未提交/推送，保留前序修改。
- 已复现聚焦的取消固定按钮被移除后，焦点落到 body。修复在显式操作且当前按钮拥有焦点时，同步移到下一枚可见参考、或上一枚；只有一枚时返回 textarea。外部控件已有焦点则不改变。通过局部 button ref map 找目标，不引入全局 selector/rAF，也不改变 onTogglePinnedContext(path) 数据回调。
- 4 个新增回归：旧实现 **3 failed / 26 passed**，修复后 **29 passed**；覆盖首项/末项/唯一项删除与外部焦点保持。
- 完整 `pnpm.cmd verify` exit 0：frontend **102 files / 839 passed**、project-core **7 passed**、API **1592 passed / 7 skipped**；lint/typecheck/Ruff/daily sidecar/OpenAPI drift 通过。build、Chromium smoke、Prettier、git diff --check 通过，既有 chunk 警告未绕过。
- 隔离 Chromium 320px Composer 中从首个取消固定按钮开始，连续按 Enter 5 次移除 5 个参考；焦点顺序为第 2/3/4/5 项后进入 textarea，不用鼠标重找控件即可接着输入文字；截图已查看。参考路径为纯内存夹具，无 API/provider 或真实文件写回。
- 证据 `.codex/uiux-pin-focus-20260908/` 日志与 replay 脚本，截图 `output/playwright/uiux-pin-focus-20260908/keyboard-removal.png`；本轮专用 Chromium 和 3012 Vite 已关闭。

持续目标未完成；本轮局部 keyboard evidence 不代表完整原生创作流、屏幕阅读器或真实 provider 验收。

## 2026-09-08：RunActionBar 拒绝草稿不跨修订残留

- 上轮为有效进展；本轮继续 d84b worktree，未提交/推送，保留前序修改。
- 复现：打开拒绝表单并输入意见后，更换 run、替换 patchId 或 waiting→running→waiting，旧 rejectDraft 仍残留，可能被提交给新修订。
- RunActionBar 保留公开 props，以 run.id/sessionId/status/patchId 列表为局部 ScopedRunActionBar key；实际操作归属变化时只重建操作条表单，不更改 Agent 执行、Composer、数据回调或补丁写回。同一补丁更新 busy/时间等字段保留输入。
- 4 个新增回归旧实现 **3 failed / 9 passed**；最终 3 个相关文件 **40 passed**，断言重开为空、同 scope 节点/草稿保留且未调用拒绝 handler。
- 原样 `pnpm.cmd verify` exit 0：frontend **102 files / 843 passed**，project-core **7 passed**，API **1592 passed / 7 skipped**；lint/typecheck/Ruff/daily sidecar/OpenAPI drift 通过。build、Chromium smoke、Prettier、git diff --check 通过，既有 chunk 警告未绕过。
- 隔离 Chromium 挂载真实 RunActionBar，输入旧意见后切 patch-A→patch-B，表单关闭；重新点击拒绝显示空输入。已查看截图。浏览器脚本未确认拒绝、handler 禁止拒绝执行，无 API/provider/真实文件操作。
- 日志与 replay 在 `.codex/uiux-run-draft-20260908/`；截图 `output/playwright/uiux-run-draft-20260908/fresh-reject.png`。专用 Chromium/3012 Vite 已关闭。

整体目标未完成。本轮仅解决表单归属；尚不能宣称所有运行控制的 busy/迟到焦点回调安全或完整 Tauri/provider 写回链验收。

## 2026-09-08：RunActionBar busy 期间拒绝表单守卫

- 上轮为有效进展，本轮继续 d84b worktree，未提交/推送，保留已有修改。
- 复现：拒绝表单先打开后 controls.busy=true，确认按钮未禁用，输入框 Enter 也绕过顶排 busy 禁用继续调用 onRejectPatch。
- 修复：确认按钮 disabled 与等待样式跟随 controlsBusy；handleRejectPatch 在改草稿、调用 handler、回焦点前先检查 controlsBusy。输入继续可编辑，不取消/清空作者草稿；busy 解除后仍用原修改方向调用原 handler。
- 新增点击/Enter 两项回归，旧实现 **2 failed / 12 passed**；修复后 3 个相关文件 **42 passed**，包括 busy 阻止提交/保留节点草稿/解除后成功调用的完整序列。
- 原样 `pnpm.cmd verify` exit 0：frontend **102 files / 845 passed**，project-core **7 passed**，API **1592 passed / 7 skipped**；lint/typecheck/Ruff/daily sidecar/OpenAPI drift 通过。build、Chromium smoke、Prettier、git diff --check 通过；既有 chunk 警告未绕过。
- 证据目录 `.codex/uiux-reject-busy-20260908/`：red/green/verify/build/smoke 日志。本轮为真实组件挂载测试和通用 Chromium smoke，没有该 busy 竞态独立浏览器重放/真实 provider/写回验收。

整体目标未完成。此修复只保证已呈现的 controlsBusy 状态不能被表单入口绕过，不声明所有尚未传播 busy 的同帧重复请求或迟到焦点已解决。

## 2026-09-08：运行操作后的延迟焦点归属

- 上轮为有效进展。本轮继续 d84b worktree，未提交/推送、保留前序修改。
- RunActionBar 原先在 rAF 执行时重新全局查询 Composer，无条件聚焦；作者已移到外部控件或 Composer 被新会话替换后仍会抢焦点。
- 修复在排队时捕获原 Composer 节点与焦点来源；执行时要求节点仍 connected/非 disabled，且当前焦点仍在来源或 body。不会重新命中新会话输入框；原运行正常结束导致按钮卸载时仍回到原输入框。不取消正常 terminal 的回焦点，也不改运行控制回调。
- 新增 3 项回归：旧实现 **2 failed / 15 passed**，最终相关 3 文件 **45 passed**。覆盖外部焦点、输入节点替换与正常 terminal 正向恢复，均断言接受回调仅一次。
- 原样 `pnpm.cmd verify` exit 0：frontend **102 files / 848 passed**，project-core **7 passed**，API **1592 passed / 7 skipped**；lint/typecheck/Ruff/daily sidecar/OpenAPI drift 通过。build、Chromium smoke、Prettier、git diff --check 通过，既有大 chunk 警告未绕过。
- 日志 `.codex/uiux-run-focus-20260908/`：red/green/verify/build/smoke。本轮焦点序列由真实 RunActionBar 挂载与 rAF 行为测试验证，未做该竞态独立浏览器重放或真实 provider/写回。

持续目标未完成；局部焦点归属不代表所有编辑/Agent/原生创作交互均已验收。

## 2026-09-08：全文搜索防抖期间的结果归属

- 上轮为有效进展。本轮继续 d84b worktree，未提交/推送，保留前序修改。
- 复现：useProjectSearch 只在 220ms 后开始新搜索时递增 seq，旧文件读取可在新查询/清空/大小写切换的防抖窗口内回填旧结果；旧 rerun callback 也可在换查询/项目或卸载后重新读取。
- 改用 projectPath/query/caseSensitive 的 scope 投影结果，以及 layout effect 建立/失效的 committed lifetime。变更立即显示空的 waiting/idle 投影，旧回调无读取资格，旧结果和错误不回填；每个 lifetime 内仍以 seq 排序重复搜索。移除旧的 project-only effect 清理与其 set-state-in-effect 豁免，无新增 lint 例外。
- 保留 220ms 防抖、8 路读取上限、渐进结果、文件可见性过滤、readProjectFile containment 和命中上限算法。已经发出的 IPC 不声称被取消，过期任务不再继续批次或更新界面。
- 新增 `tests/project-search-lifecycle.test.tsx` 8 项，旧实现 **7 failed / 1 passed**，修复后相关 3 文件 **21 passed**；覆盖查询/清空/大小写/切项目/关闭，以及旧 rerun 与 A→B→A/卸载。
- 原样 `pnpm.cmd verify` exit 0：frontend **103 files / 856 passed**、project-core **7 passed**、API **1592 passed / 7 skipped**；lint/typecheck/Ruff/daily sidecar/OpenAPI drift 通过。build、Chromium smoke、Prettier、git diff --check 通过，既有 chunk 警告未绕过。
- 隔离 Chromium 挂载真实 SearchView+hook，内存 FS 暂挂旧词读取；改为新词后释放旧读取，旧命中不呈现，随后新词正常显示 1 个命中。截图已查看；未访问真实文件、点击结果或调用 provider。专用 browser/3012 Vite 已关闭。
- 证据 `.codex/uiux-search-scope-20260908/` 日志与 replay；截图 `output/playwright/uiux-search-scope-20260908/new-query.png`。

整体目标未完成；本轮不证明真实文件权限故障或所有搜索部分失败的反馈均已验收，继续检查搜索结果完整性提示及更广创作体验。

## 2026-09-08：全文搜索部分失败明确提示与重试

- 上轮为有效进展，本轮继续 d84b worktree，未提交/推送，保留前序修改。
- 复现：readProjectFile 失败被静默跳过，全部不可读仍显示“没有匹配的内容”，会把未搜索误当作无命中。
- 搜索状态新增 unreadableCount，按实际失败文件计数，在现有 scope/lifetime/seq 保护下渐进发布；不猜测权限/占用原因，不泄露原异常。可读文件命中照常保留，读取失败不阻断全部搜索。
- SearchView 明确显示“有 N 个文件未能读取，结果可能不完整”及重试搜索；零命中且存在未读文件时不再宣称完整无匹配。重试按钮在 searching 时禁用，开始重试前将焦点还给搜索框，避免提示消失后焦点丢失；成功后计数和提示清除。
- 新增部分失败/全部失败到成功重试的 2 项真实 hook+View 回归，旧实现 **2 failed / 8 passed**；最终相关 3 文件 **23 passed**，保留全部生命周期回归。
- 原样 `pnpm.cmd verify` exit 0：frontend **103 files / 858 passed**、project-core **7 passed**、API **1592 passed / 7 skipped**；lint/typecheck/Ruff/daily sidecar/OpenAPI drift 通过。build、Chromium smoke、Prettier、git diff --check 通过，既有 chunk 警告未绕过。
- 隔离 Chromium 内存 FS 先抛模拟读取错误，显示 1 个未读文件与不完整说明；恢复内存读取并点击重试，命中出现、提示消失、搜索框保持焦点。已查看截图；未模拟真实 OS 权限、未访问真实文件/provider。专用 browser/3012 Vite 已关闭。
- 证据 `.codex/uiux-search-partial-20260908/` 日志和 replay；截图 `output/playwright/uiux-search-partial-20260908/incomplete.png`。

整体目标未完成。本轮未验证真实文件权限恢复、屏幕阅读器或完整原生创作链，不用局部测试代替整体验收。

## 2026-09-08：全文搜索全局上限在批次内生效

- 上轮为有效进展，本轮继续 d84b worktree，未提交/推送，保留前序修改。
- 复现：总上限只在每批 8 文件开始前检查，16 文件各 40 命中会产出 **640** 条；首文件 35 命中、其他每文件 40 时可产出 **475** 条，均超过配置 400。
- 修复：批次内处理每个文件前检查剩余全局预算，传给 findHitsInContent 的 maxHits 为 min(单文件上限, 全局剩余)；最后文件可只保留 5 条并正确 truncated，不是粗暴跳过整个文件。既有读取并发、命中顺序、capped 提示与文件安全边界不变。
- 2 个新增真实 hook+SearchView 回归旧实现 **2 failed / 10 passed**，最终相关 3 文件 **25 passed**；断言 totalHits=400、DOM 命中行数=400、上限说明一致与最后文件 5 条/截断。
- 原样 `pnpm.cmd verify` exit 0：frontend **103 files / 860 passed**，project-core **7 passed**，API **1592 passed / 7 skipped**；lint/typecheck/Ruff/daily sidecar/OpenAPI drift 通过。build、Chromium smoke、Prettier、git diff --check 通过，既有大 chunk 警告未绕过。
- 证据 `.codex/uiux-search-cap-20260908/`：red/green/verify/build/smoke 日志。本轮使用内存文件 mock 与真实组件挂载验证命中数量，未另做 400 行独立浏览器重放或真实项目性能压测。

整体目标未完成；上限正确不代表长项目性能、原生滚动和所有搜索语义已验收。

## 2026-09-08：全文搜索响应文件变更通知

- 继续 d84b worktree，保留前序未提交修改，未提交或推送。
- 复现：全文搜索未监听已有 FS_MUTATION_EVENT，文件保存后旧结果会保留到查询改变。新增有效查询监听，以 fileVersion 纳入结果 scope，使旧结果和在途旧读取失效；复用现有 220ms 防抖合并连续通知。空/短查询、无项目不监听，卸载清理监听与 timer。
- 3 项新增真实 hook+SearchView 回归覆盖 5 次通知合并一次读取、在途旧读取拒绝回填、空查询和卸载后不读取。旧实现 2 failed / 13 passed；最终相关 3 文件 28 passed。
- pnpm.cmd verify 日志确认所有本地核心门禁通过：frontend 103 files / 863 passed，project-core 7 passed，API 1592 passed / 7 skipped / 6 warnings；lint/typecheck/Ruff/daily sidecar/OpenAPI 无漂移通过。原 session 已结束且不可再次查询，以完整日志末尾成功标记确认。
- npm.cmd --prefix apps/desktop/frontend run build 和 run verify:smoke 连续执行 exit 0；既有大 chunk 警告未绕过。Prettier 与 git diff --check 通过。
- 证据 .codex/uiux-search-refresh-20260908/：red.log、green.log、verify.log、build.log、smoke.log。
- 范围：内存 FS 事件与真实组件测试，加通用 Chromium smoke；未单独进行 mutation 浏览器重放、真实文件写回、外部 OS watcher 或大型项目性能验收。没有修改写回权限、containment、API/DTO 或 filesystem watcher。

整体目标仍未完成；本轮只证明已有文件变更通知能使搜索更新，不宣称覆盖所有外部文件变化。

## 2026-09-08：Unicode 大小写搜索高亮映射

- 上轮为有效进展，本轮继续 d84b worktree，保留全部前序修改，未提交/推送。
- 复现：İ 转小写为两个 UTF-16 单元，直接使用小写文本偏移截取原文，会让后续中文命中错位；查询自身转换扩展时也会错误截取长度。3 项纯逻辑回归在旧实现为 3 failed / 9 passed。
- 修复：保持原有整行 toLowerCase + 字面量 indexOf 匹配（含上下文 sigma），仅在原文/小写文本长度不同时构建源码点范围映射。命中起止从实际 needle.length 映射回原文，长度相同的常规行无需映射。保留行号、非重叠推进、大小写开关和命中预算。
- 新增 3 项纯逻辑和 1 项真实 hook+SearchView 高亮回归；覆盖长段落、多命中、astral 前缀、查询/原文扩展、上下文 sigma、字面量、区分大小写及 DOM mark。相关 3 文件 32 passed。
- pnpm.cmd verify exit 0：frontend 103 files / 867 passed，project-core 7 passed，API 1592 passed / 7 skipped / 6 warnings；lint/typecheck/Ruff/daily sidecar/OpenAPI 无漂移通过。build、Chromium smoke、Prettier、git diff --check 通过；未修改警告阈值。
- 隔离 Chromium 真实 hook+SearchView 配内存文件，输入“目标”正确高亮原文“目标”，输入 i + combining dot + x 正确高亮原文 İX。DOM 断言通过，两个截图已查看。专用浏览器与 3012 Vite 已关闭，未访问真实项目或 provider。
- 证据 .codex/uiux-search-unicode-20260908/（red/green/verify/build/smoke/browser 日志及 replay），截图 output/playwright/uiux-search-unicode-20260908/chinese.png、expanded.png。

整体目标仍未完成；本轮不是 Unicode 规范化/语言区域排序功能，也未验收所有字素边界、真实 Tauri 项目写回或大型项目性能。

## 2026-09-08：搜索整体失败重试的键盘焦点恢复

- 上轮为有效进展，继续 d84b worktree，保留前序修改，未提交/推送。
- 复现：整体目录读取失败后的重试按钮直接调用 rerun，进入 searching 后按钮卸载，焦点落到 body；部分读取失败的重试已有回焦点，两个入口不一致。
- 修复：SearchView 两类重试共用 retrySearch，在发起搜索前同步 focus 稳定搜索输入，不在异步成功/失败时追加 focus。保留查询、失败文案和底层 scope/lifetime 保护。
- 2 项真实 hook+View 回归旧实现 2 failed / 16 passed，最终相关 3 文件 34 passed。覆盖延迟重试立即恢复输入焦点、成功保留查询和焦点、用户主动移焦后晚失败不抢焦点。
- pnpm.cmd verify exit 0：frontend 103 files / 869 passed，project-core 7 passed，API 1592 passed / 7 skipped / 6 warnings；lint/typecheck/Ruff/daily sidecar/OpenAPI 无漂移通过。build、Chromium smoke、Prettier、git diff --check 通过，既有 chunk 警告未绕过。
- 隔离 Chromium 真实 hook+View + 内存 FS：先模拟 listDir 失败，再恢复并用 Enter 触发重试；命中出现后输入框仍有焦点，可直接键入“续”，query 从“目标”变为“目标续”。DOM 断言通过，已查看 recovered.png（继续输入后 searching 状态）。专用 browser/3012 Vite 已关闭。
- 证据 .codex/uiux-search-retry-focus-20260908/（red/green/verify/build/smoke/browser 日志、replay），截图 output/playwright/uiux-search-retry-focus-20260908/error.png、recovered.png。

整体目标仍未完成。本轮不代表真实 OS 目录权限恢复、屏幕阅读器或完整原生写作/写回链路验收。

## 2026-09-08：忙碌时取消拒绝草稿的输入方式一致性

- 上轮为有效进展，继续 d84b worktree，保留前序修改，未提交/推送。
- 复现：拒绝草稿已展开时 busy 会禁用顶部“取消”，鼠标无法关闭；Escape 虽关闭却向禁用按钮回焦点，造成焦点丢失。2 项新回归旧实现 2 failed / 17 passed。
- 修复：busy 时仅允许已展开表单的本地取消，关闭后入口重新禁用；确认提交与 handleRejectPatch 的 busy 守卫不变。鼠标/Escape 共用取消 handler，忙碌时同步聚焦具名的运行操作 group（tabIndex=-1），非忙碌仍回拒绝入口。不在 busy 解除时自动转移焦点。
- 2 项真实组件测试覆盖点击/Escape、关闭后的禁用、无后台接受/拒绝调用、解除 busy 后可重新打开空草稿。操作条全部 19 passed。
- pnpm.cmd verify exit 0：frontend 103 files / 871 passed，project-core 7 passed，API 1592 passed / 7 skipped / 6 warnings；lint/typecheck/Ruff/daily sidecar/OpenAPI 无漂移通过。build、Chromium smoke、Prettier、git diff --check 通过。
- 隔离 Chromium 使用真实 RunActionBar + ComposerSurface、模拟 busy、不调用后台：Escape 取消后焦点在运行操作 group，截图可见焦点框，拒绝入口禁用；随后 Tab 正常进入 composer-input。浏览器与 3012 Vite 已关闭。
- 证据 .codex/uiux-reject-cancel-busy-20260908/（red/green/verify/build/smoke/browser 日志及 replay）；截图 output/playwright/uiux-reject-cancel-busy-20260908/cancelled.png 已查看。

整体目标仍未完成；本地取消草稿不代表取消已经提交的后台操作，未进行真实 provider 或 Tauri 补丁写回验收。

## 2026-09-08：Composer 历史回溯光标与新选区隔离

- 上轮为有效进展，继续 d84b worktree，保留前序修改，未提交/推送。
- 复现：历史回溯的 requestAnimationFrame 无条件将当前 textarea 选区移到末尾，覆盖在帧执行前作者设置的新选区；相同历史文本没有 value 变化时也要等帧才能定位。新测试旧实现 2 failed / 1 passed。
- 修复：历史文本变更同时发布一次性 caret request，在 layout effect 对匹配文本且当前聚焦的可用输入框设置选区，并用 request 身份防重放。不再排队历史光标帧；相同文本也触发一次提交，普通重渲染不重复设置选区。保留原草稿恢复和历史边界行为。
- tests/composer-history-caret.test.tsx 新增 3 项真实 Composer 回归：新反向选区不被帧覆盖、同值回溯即时定位、下键恢复原草稿/重渲染保留选区。与权限/跨会话组件测试共 39 passed。
- pnpm.cmd verify exit 0：frontend 104 files / 874 passed，project-core 7 passed，API 1592 passed / 7 skipped / 6 warnings；lint/typecheck/Ruff/daily sidecar/OpenAPI 无漂移通过。build、Chromium smoke、Prettier、git diff --check 通过。
- 隔离 Chromium 真实 ComposerSurface：Ctrl+Home/ArrowUp 取回历史，Shift+ArrowLeft 选中末字，等待两帧后仍为 start=3/end=4/backward；Ctrl+End/ArrowDown 恢复原三行草稿。截图 selection.png 已查看。专用 browser/3012 Vite 已关闭，没有 API/provider/真实写回。
- 证据 .codex/uiux-history-caret-20260908/（red/green/verify/build/smoke/browser 日志与 replay）；截图 output/playwright/uiux-history-caret-20260908/selection.png。

整体目标仍未完成；本轮不代表真实 IME、多 provider 或完整 Tauri 写作链验收。

## 2026-09-08：整体验收覆盖复核与补丁方向输入保护

- 上轮为有效进展，继续 d84b worktree，未提交/推送。重新核对 PRD R1—R15 与原生 acceptance-20260907.md，将证据和下一步缺口记录到 .codex/uiux-workflow-audit-20260908.md；没有把局部测试或旧原生截图升级为当前完整工作流验收。
- 沿 R2/R3 补丁流程确认：保存旁注未结束时 Enter 提交拒绝会先清草稿/移焦点，随后 runAction 忙碌锁阻止请求，作者的修改方向丢失。2 项新回归旧实现 2 failed / 15 passed，覆盖普通等待和同一 React 提交帧。
- 修复只在 submitRejection 开头检查现有 busyActionRef；被阻止时不修改草稿和焦点。busy 结束后原方向可提交，既有双击保护、写回 callback 与权限不变。补丁面板/RunActionBar 相关 2 文件 36 passed。
- pnpm.cmd verify exit 0：frontend 104 files / 876 passed，project-core 7 passed，API 1592 passed / 7 skipped / 6 warnings；lint/typecheck/Ruff/daily sidecar/OpenAPI 无漂移通过。build、Chromium smoke、Prettier、git diff --check 通过。
- 隔离 Chromium 真实 PatchReviewPanel/Monaco、420px 宽、所有动作回调模拟：输入修改方向 → 保存旁注暂挂 → Enter 不清输入、不移焦点、不提交 → 完成旁注 → Enter 原方向仅提交一次。preserved.png 已查看；未调用真实文件写回/API/provider。动态夹具首次遇到 createRoot 默认导出解包问题，修正夹具后重放通过；产品代码未因此变更。
- 证据 .codex/uiux-patch-draft-busy-20260908/（red/green/verify/build/smoke/browser 日志与 replay）；截图 output/playwright/uiux-patch-draft-busy-20260908/preserved.png。专用 browser/3012 Vite 已关闭。

整体目标仍未完成；动态夹具未初始化完整 App 的 Monaco 主题，不用于产品主题评判。当前真实 Tauri diff 确认→guarded writeback→版本记录 GUI 链仍缺完整证据。

## 2026-09-08：补丁替换后的忙碌状态归属

- 上轮为有效进展，继续 d84b worktree，未提交/推送。确认 Editor 的 PatchReviewPanel 没有 suggestion key，会复用实例。
- 最初假设“新补丁应立即解锁”在追踪 useSuggestionWriteback 后被否定：旧操作可能仍在写文件，不能靠重建组件绕过互斥锁。未实施此方案；red.log 为已废弃假设，不是最终缺陷证明。
- 最终问题：patch-A 的旁注操作未结束时换到 patch-B，仍显示“正在保存旁注”，没有区分操作属于上一份。保留已有共享 busyActionRef，只让 busyAction 状态记录 kind + suggestionId；不匹配当前 suggestion 时显示“正在完成上一份修订的操作…”。旧操作结束后正常解锁，同一补丁仍显示具体操作。
- 最终红绿为 red-owner.log 1 failed / 18 passed，新增两项回归覆盖换身份/不换身份、旧操作仍互斥、结束解锁及新操作显示当前状态。相关补丁面板与 RunActionBar 共 38 passed。
- pnpm.cmd verify exit 0：frontend 104 files / 878 passed，project-core 7 passed，API 1592 passed / 7 skipped / 6 warnings；lint/typecheck/Ruff/daily sidecar/OpenAPI 无漂移通过。build、Chromium smoke、Prettier、git diff --check 通过。
- 隔离 Chromium 真实 PatchReviewPanel/Monaco + 模拟回调：A 旁注暂挂→B 替换→显示上一份操作且按钮仍禁用→A 完成→B 可操作并显示当前旁注状态。420px 截图已查看，不作 App 主题验收。专用 browser/3012 Vite 已关闭。
- 证据 .codex/uiux-patch-scope-20260908/（red-owner/green/verify/build/smoke/browser 日志及 replay）；截图 output/playwright/uiux-patch-scope-20260908/previous-action.png。

整体目标仍未完成；没有修改写回串行性、guarded writeback、权限或实际文件，也不声称已解决所有跨补丁后台回调问题。

## 2026-09-08：旧旁注保存完成不误关新提议

- 上轮为有效进展，继续 d84b worktree，保留前序修改，未提交/推送。
- 复现：handleSaveSuggestionNote 捕获 A 并等待写入；期间通过真实提议事件接收 B，旧保存完成后 setPendingSuggestion(null) 会关闭 B。B 即便复用 A 的 ID 但内容已更新，也会被误关。
- 修复：完成时以函数式状态更新和对象身份判断，只清除提交的 suggestion；仅当前提议与项目仍匹配时安排原有回编辑器焦点。保存仍写原 project/notePath，成功 toast 明确原旁注路径，没有取消已授权的写入或改变文件权限。
- 在既有真实 useSuggestionWriteback harness 暂挂 mock note write，新加不同 ID 替换、同 ID 新对象替换和无替换正常完成 3 项回归。旧实现 2 failed / 14 passed，最终 hook/补丁面板相关 2 文件 35 passed；检查新提议保留、无旧焦点动作、原旁注内容只写一次，正常完成仍关闭并回焦点。
- pnpm.cmd verify exit 0：frontend 104 files / 881 passed，project-core 7 passed，API 1592 passed / 7 skipped / 6 warnings；lint/typecheck/Ruff/daily sidecar/OpenAPI 无漂移通过。build、Chromium smoke、Prettier、git diff --check 通过。
- 证据 .codex/uiux-note-late-20260908/：red/green/verify/build/smoke 日志。本轮没有独立旁注竞态浏览器重放，使用真实 hook + 事件 + 内存写入 mock；通用 smoke 不等于真实 Tauri 旁注保存验收。

整体目标仍未完成。整份/分块接受的晚回调、已排队焦点帧与文件切换仍需独立核查；本轮不宣称所有写回并发路径已安全。

## 2026-09-08：排队的回编辑器焦点绑定原上下文

- 上轮为有效进展，继续 d84b worktree，保留前序修改，未提交/推送。
- 复现：focusEditorAfterAction 的帧回调会重新取当前 editorRef，且只要焦点在任意 patch-review 内就移动到编辑器；排队后切文件、收到新提议或聚焦另一输入框都会被旧回调覆盖。新增 4 项真实 hook 回归，旧实现 3 failed / 17 passed。
- 修复：排队时捕获 editor/file/project/suggestion 与源焦点；执行时拒绝不同编辑器、路径、项目、非空新提议，且只允许焦点仍在源控件或因卸载落到 body 时回焦点。不改变实际编辑/旁注/写回行为。
- tests/behavior/auto-writeback.test.tsx 覆盖换文件、换提议、同补丁区内新输入焦点，以及无变化正常回编辑器；全部拒绝操作不写文件。相关 hook/补丁面板 2 文件 39 passed。
- pnpm.cmd verify exit 0：frontend 104 files / 885 passed，project-core 7 passed，API 1592 passed / 7 skipped / 6 warnings；lint/typecheck/Ruff/daily sidecar/OpenAPI 无漂移通过。build、Chromium smoke、Prettier、git diff --check 通过。
- 证据 .codex/uiux-editor-focus-scope-20260908/：red/green/verify/build/smoke 日志。本轮用真实 hook+提议事件、可控帧和 DOM 焦点验证，Monaco focus 为 spy；未独立做原生/Monaco 浏览器时序重放。

整体目标仍未完成。这里只保护排队之后的上下文变化，不代表接受/分块接受开始到异步结果返回之间的全部状态安全，也不覆盖所有 A→B→A 生命周期重入。

## 2026-09-08：接受完成只更新提交时的提议

- 上轮为有效进展，继续 d84b worktree，保留前序修改，未提交/推送。
- 复现：接受旧补丁期间收到新提议，整份/最后一块完成会 setPendingSuggestion(null) 误关新提议，部分块完成则以旧 suggestion 的剩余内容覆盖新提议。新增 6 项回归旧实现 3 failed / 23 passed。
- 修复：整份/最后块完成只函数式清除相同 suggestion 对象，部分块只在该对象仍为当前提议时更新 before；回焦点仅在提议和文件仍对应时安排。未取消原授权写入，未修改 writeAcceptedSuggestion、快照、版本记录、漂移拒写或计划标记。
- 真实 useSuggestionWriteback 回归覆盖 whole/partial-hunk/last-hunk 各自替换与不替换，新提议复用旧 ID 但内容不同；验证原写入一次且内容正确、快照/闭环记录仍执行、只有整份接受标记完成。相关 hook/补丁面板 2 文件 45 passed。
- pnpm.cmd verify exit 0：frontend 104 files / 891 passed，project-core 7 passed，API 1592 passed / 7 skipped / 6 warnings；lint/typecheck/Ruff/daily sidecar/OpenAPI 无漂移通过。build、Chromium smoke、Prettier、git diff --check 通过，既有 chunk 告警未绕过。
- 证据 .codex/uiux-accept-late-20260908/：red/green/verify/build/smoke 日志。本轮用真实 hook/事件与内存写入、版本、计划边界 mock 验证；没有独立并发浏览器重放或真实 Tauri 文件落盘。

整体目标仍未完成。保留新提议不等于它在旧写入完成后仍可直接应用，既有漂移拒写必须继续生效；跨项目异步元数据归属和所有操作并发仍待独立验证。

## 2026-09-08：异步接受的记录与章节标记绑定原项目

- 上轮为有效进展，继续 d84b worktree，保留前序修改，未提交/推送。
- 复现：A 写入暂挂期间切项目 B，write 已捕获 A，recordRevisionLoop 却读取当前 projectPathRef=B；整章 mark 同样读取当前项目，混合旧文件与新项目。2 项新对照测试旧实现 1 failed / 27 passed。
- 修复：writeAcceptedSuggestion 中 snapshot/write/record 统一使用原 projectRoot，snapshot/record 的 sessionId 也在开始时捕获；返回该 projectRoot 给整份接受后的 markChapterWrittenInPlan 使用。不修改调用先后、失败门禁、权限、项目 containment 或后端契约。
- 真实 hook 回归覆盖切项目与不切项目：捕获 mock 写入根、闭环 record 的 projectPath/filePath、plan 命令参数，均属于 A，正文只写 A 一次。相关 hook/补丁面板 2 文件 47 passed。
- pnpm.cmd verify exit 0：frontend 104 files / 893 passed，project-core 7 passed，API 1592 passed / 7 skipped / 6 warnings；lint/typecheck/Ruff/daily sidecar/OpenAPI 无漂移通过。build、Chromium smoke、Prettier、git diff --check 通过。
- 证据 .codex/uiux-writeback-origin-20260908/：red/green/verify/build/smoke 日志。本轮使用真实 hook 和内存副作用 mock，不涉及真实双项目落盘或独立 Tauri GUI 重放。

整体目标仍未完成。useBranchManifest.advanceBranchHead 自身读取当前项目/文件，在快照等待期间切换时仍需独立验证；撤销动作与其他跨项目元数据链也未作全部安全声明。

## 2026-09-08：分支头推进绑定原项目、文件与分支

- 上轮为有效进展，继续 d84b worktree，保留前序修改，未提交/推送。
- 复现：advanceBranchHead 原先在执行时读取当前 manifest/project/file，快照等待后切项目/切文件/切分支会更新错误分支头。3 项新 hook 回归旧实现全部失败。
- 引入 BranchHeadTarget（内部 TS 类型，非 API DTO）；advanceBranchHead 支持明确 projectPath/filePath/branchId，非活动文件加载并保存原目标清单，只有仍匹配且 manifest 身份未变化时更新活动 UI。保留无 target 的现有即时调用兼容与原保存错误处理。
- Editor 保存、恢复文件不存在版本、useSuggestionWriteback 接受路径均传递快照时的目标；快照与 advance 共用捕获的 branch。没有更改正文写入、快照失败阻断或权限语义。
- tests/branch-manifest-scope.test.tsx 覆盖项目/文件/分支切换，断言保存目标、原分支头与当前选择不受污染。auto-writeback 新增真实调用链测试，暂停 snapshot 后切项目，验证推进参数和正文/记录仍为原项目。相关 4 文件 63 passed。
- pnpm.cmd verify exit 0：frontend 105 files / 897 passed，project-core 7 passed，API 1592 passed / 7 skipped / 6 warnings；lint/typecheck/Ruff/daily sidecar/OpenAPI 无漂移通过。build、Chromium smoke、Prettier、git diff --check 通过。
- 证据 .codex/uiux-branch-origin-20260908/：red/green/verify/build/smoke 日志。真实 hook 与分支纯逻辑，load/save/snapshot/file 边界均为内存 mock；未独立做原生分支画布/双文件实际持久化重放。

整体目标仍未完成。此处明确来源，不等于所有分支读改写已经实现事务串行化；并发清单保存、返回原文件的加载时序与撤销 scope 仍需独立核查。

## 2026-09-08：撤销与版本历史入口确认原目标

- 上轮为有效进展，继续 d84b worktree，保留前序修改，未提交/推送。
- 复现：offerUndo 仅比较当前 editor 内容，不确认原文件/项目；切到相同正文的另一文件或项目后，旧通知仍触发原路径反向写入或删除。4 项新建/普通修订×文件/项目回归旧实现 4 failed / 29 passed。
- 修复：offerUndo 使用写入结果的 projectRoot 固定来源；执行撤销前确认 project/file 同时匹配，不匹配则提示完整原文件路径并保留“回到原文件后重试”动作，不导航、不写入或删除。新建撤销删除使用固定来源项目。内容漂移仍保留版本历史退路，该后续入口也确认原目标并可重试。
- 5 项新增真实 hook/通知 action 回归覆盖不同目标阻断、同正文不能绕过、回原目标恢复写回/删除，以及延迟打开版本历史不会打开另一文件历史。相关 hook/补丁面板 2 文件 53 passed。
- pnpm.cmd verify exit 0：frontend 105 files / 902 passed，project-core 7 passed，API 1592 passed / 7 skipped / 6 warnings；lint/typecheck/Ruff/daily sidecar/OpenAPI 无漂移通过。build、Chromium smoke、Prettier、git diff --check 通过。
- 证据 .codex/uiux-undo-target-20260908/：red/green/verify/build/smoke 日志。写入/删除/版本历史为边界 mock，未触碰真实手稿；未独立进行该通知的 GUI 重放或原生撤销删除验收。

整体目标仍未完成。此处保护动作启动时的目标身份，异步撤销期间的新提议收尾、多个操作串行化和原生文件真实性仍需后续验证。

## 2026-09-08：通知动作防重复与失败反馈

- 上轮为有效进展，继续 d84b worktree，保留前序修改，未提交/推送。
- 复现：ToastHost 点击动作后 setItems 尚未提交时再次 click 会第二次调用 run。新回归旧实现 1 failed / 4 passed。
- 修复：以 ToastItem 对象身份 WeakSet 同步领取动作执行权，每条通知只运行一次，不阻止另一条通知使用同一回调；先 dismiss 再执行。捕获同步抛错与异步拒绝，显示带动作名称的错误提示，不输出原始异常，不自动重试或暗示副作用已回滚。
- 新增 4 项真实 ToastHost 回归覆盖同帧双击、同步/异步失败、不同通知与回调生成的新反馈不丢失；与撤销 hook 相关 2 文件 42 passed。
- pnpm.cmd verify exit 0：frontend 105 files / 906 passed，project-core 7 passed，API 1592 passed / 7 skipped / 6 warnings；lint/typecheck/Ruff/daily sidecar/OpenAPI 无漂移通过。build、Chromium smoke、Prettier、git diff --check 通过。
- 隔离 Chromium 挂载真实 ToastHost，模拟动作 Promise.reject 后显示“未能完成，请检查当前状态后再重试”，role=alert 断言通过，截图 failure.png 已查看，无真实文件操作。专用 browser/3012 Vite 已关闭。
- 证据 .codex/uiux-toast-action-20260908/（red/green/verify/build/smoke/browser 日志及 replay）；截图 output/playwright/uiux-toast-action-20260908/failure.png。

整体目标仍未完成；单条通知防重复不是整个编辑器写回事务互斥，也不保证不同通知代表同一底层动作时全局去重。

## 2026-09-08 通知交互暂停倒计时（d84b）

- 修复 ToastHost 在鼠标悬停或键盘焦点仍位于通知内时自动消失。分别记录 pointer/focus 原因，二者均离开后按剩余时长恢复；内部按钮间移动焦点不恢复计时。默认时长未改。
- 清理手动关闭、队列淘汰和卸载计时器，保留前轮动作去重与失败提示。产品只改 ToastHost.tsx 与 toast.test.tsx。
- Red：3 failed / 8 passed；Green：通知与 auto-writeback 共 46 passed（新增 4 项通知回归）。
- 最终 pnpm.cmd verify exit 0：前端 105 files / 910 passed；project-core 7 passed；API 1592 passed / 7 skipped / 6 warnings；lint/typecheck/Ruff/daily sidecar/OpenAPI drift 门禁通过。首次 lint 对事件函数的 purity 检查失败，改为 useCallback 后重跑通过，未禁用规则。
- 最终 production build、verify:smoke、git diff --check 通过；保留既有 hook dependency 与构建 chunk 警告。
- Chromium 隔离真实 ToastHost：受控时钟推进 70 秒，分别验证 focus/pointer 暂停，再验证离开后恢复消失。截图 output/playwright/uiux-toast-pause-20260908/focused.png 已查看；replay 和日志在 .codex/uiux-toast-pause-20260908/。浏览器与本轮 Vite 已关闭。
- 不是原生 Tauri、真实 provider 或完整 guarded writeback 验收；未提交、推送。整体 UIUX 目标继续。

## 2026-09-08 通知突发时保留交互目标（d84b）

- 复现：聚焦或悬停第一条通知后，同帧发送 5 条后台通知，原卡片被 slice 淘汰，键盘操作目标消失。Red 2 failed / 12 passed。
- 修复：队列超限优先淘汰最早未交互卡片，当前交互卡片与 DOM 焦点保留；新消息正常展示，上限仍为 4。离开后旧卡片重新参与淘汰。计时器与可见 ID 同步，不修改默认时长或动作语义。
- 最小测试 14 passed；pnpm.cmd verify exit 0，前端 105 files / 912 passed，project-core 7 passed，API 1592 passed / 7 skipped / 6 warnings；lint/typecheck/Ruff/daily sidecar/OpenAPI 无漂移。
- production build、verify:smoke、git diff --check 均通过。原有 warning 未扩大或抑制。
- 隔离 Chromium 验证真实 ToastHost：聚焦按钮→5 条新通知→焦点及最多 4 条保留→Tab/Enter 可关闭原通知。截图 output/playwright/uiux-toast-overflow-20260908/retained.png 已查看，日志与 replay 在 .codex/uiux-toast-overflow-20260908/。本轮 Vite 与浏览器已关闭。
- 未验证关闭最后一条通知后的焦点恢复、真实 Tauri 全链与系统辅助技术；不把本轮证据当作完整 UIUX 终验。未提交、推送，目标继续。

## 2026-09-08 当前原生写回与退出验收
- 真实当前 Tauri 资源 index-K_CUIlkA.js，隔离样例/配置/DB/profile。Monaco 输入 Ctrl+S、模拟补丁 GUI 接受、磁盘/写前 shadow Git 检查点/闭环记录/历史对比验证通过；内容漂移拒写且 buffer、磁盘、提议状态保留。
- 发现 P1：dirty 文档点击窗口关闭无确认，正常退出后重启同一 profile 未恢复草稿。已取得原生复现与重启证据，尚未修复，优先下一轮处理。
- 详细路径 .codex/uiux-native-writeback-20260908/acceptance.md；原生截图 output/playwright/uiux-native-writeback-20260908/。
- 临时 debug smoke 暂停探针已移除，main.rs 与原备份一致，恢复 cargo build exit 0；git diff --check 通过。本轮无产品行为改动，未新增完整门禁结论；未发送模型请求，未提交/推送。两个原生会话均已关闭。

## 2026-09-08 P1 原生退出丢稿修复
- 新增 useNativeCloseGuard 并在 tabs hook 接入原生 close-request，复用未保存决策；允许 SDK 确认后的 destroy。保存等待提高至 15 秒，取消/失败/重复请求/卸载晚回调不退出。
- 新增 4 项回归，相关 15 passed；最终完整门禁 106 files / 916 frontend，1592 API / 7 skipped，project-core 7，OpenAPI 无漂移；build、smoke、恢复 cargo build、diff check 通过。
- 首轮一项既有 API 探针 stdout 断言失败，未绕过，完整重跑通过；详见 .codex/uiux-window-close-20260908/acceptance.md。
- 真实 Tauri 验证取消保留、保存退出、磁盘内容、重启恢复与干净关闭。首次 2 秒超时安全保留窗口，15 秒最终版本通过。临时观察代码已还原，所有本轮实例关闭。未提交/推送。

## 2026-09-08 skipped 保存应答不得放行
- 修复非活动目标 skipped 被当成成功的问题，明确 saved/clean 成功、skipped/error 拒绝、无效应答忽略。真实关闭脏页签回归不再丢稿。
- 新增 4 项回归，相关 34 passed；完整门禁前端 920 / API 1592 passed（7 skipped），project-core 7，OpenAPI 无漂移；build/smoke/还原 cargo build/diff check 均通过。
- 隔离原生当前资源 index-DByGI4vH.js 验证真实 Editor clean/skipped/saved 分类及真实落盘与干净关闭。详见 .codex/uiux-save-ack-20260908/acceptance.md。
- 临时诊断移除，原生/API 会话已关闭。未提交/推送；并行请求关联和保存期间新输入仍需继续核查。

## 2026-09-08 保存握手 requestId 隔离
- 修复同文件旧/并行请求互认应答；请求与应答共享唯一 requestId，消费者同时核对目标/请求。更新真实 Editor 和事件测试假编辑器，不回退无 ID 成功兼容。
- 新增 2 条时序回归；相关 36 passed，完整门禁 frontend 922 / API 1592 passed（7 skipped），project-core 7；OpenAPI 无漂移，build/smoke/恢复 cargo build/diff check 均通过。
- 原生实际资源 index-DBjuFz_l.js，真实保存退出捕获同 ID saved，应答与磁盘一致，窗口正常关闭。详见 .codex/uiux-save-correlation-20260908/acceptance.md。
- 临时 Rust 诊断已恢复，原生与 API 停止，未提交/推送。此修复不是写入串行化或全部保存竞态的保证。

## 2026-09-08 保存期间后续输入不得误放行退出
- 原生 Red：buffer 有新输入但磁盘无，旧版仍回 saved。现使用实际保存 receipt + 目标/model/内容复验；在途新增内容回 error，保留窗口；queued flush 目标变化拒绝，clean 不依赖延迟 dirty ref。
- 新增 3 项回归，相关 32 passed；完整门禁前端 925 / API 1592 passed（7 skipped），project-core 7，OpenAPI 无漂移；build/smoke/恢复 cargo build/diff check 通过。
- 原生 Green：保存中输入→明确取消关闭→重试保存退出→磁盘包含全部输入。截图 output/playwright/uiux-save-late-input-20260908/blocked-close.png 已查看。详情 .codex/uiux-save-late-input-20260908/acceptance.md。
- 临时 Rust 观察代码已恢复，原生/API 已停。未提交或推送，整体目标继续。

## 2026-09-08 未发送 Agent 消息退出保护
- App 根据 ChatWindow 上报的布尔状态，在正文退出守卫前增加未发送消息确认；取消保留文字，后续正文取消也不提前清空消息，纯空白不警告。不新增消息磁盘存储。
- 两条回归由红转绿；完整门禁 frontend 927 / API 1592 passed（7 skipped），project-core 7，OpenAPI 无漂移；build/smoke/恢复 cargo build/diff check 通过。
- 原生当前资源 index-Befy3kGI.js 完整组合验收通过，详见 .codex/uiux-unsent-close-20260908/acceptance.md，截图已查看。临时 Rust 诊断已恢复，原生/API 已停。未提交/推送。
- 项目/会话切换时草稿处理、运行中任务退出、崩溃恢复未因此宣称通过。

## 2026-09-08 新建/切换会话的未发送草稿保护
- 新建、切换会话统一要求显式确认；取消不重置文字或 Composer。当前会话不重复切换，空白直接放行；缺失确认能力时保留输入并提示。
- 待确认期间去重，项目、会话、输入变化或卸载后拒绝旧确认提交。新增 3 条回归，相关文件 10 passed；既有历史缓存测试调整为等待异步确认。
- pnpm verify 日志确认全部核心门禁通过：frontend 930 / API 1592 passed（7 skipped、6 warnings），project-core 7，OpenAPI 无漂移。生产构建、恢复后的 Rust build、Chromium smoke 和 diff check 通过。
- 原生 Tauri 当前资源 index-D4E2_WxW.js：输入草稿→新建→取消保留→再次新建并明确放弃→清空并正常退出；截图已查看。临时 Rust 诊断无残留，隔离 API/CDP 端口均已关闭。
- 原生仅验收新建会话；切换已存会话由组件回归覆盖。项目切换、运行中任务退出和崩溃恢复不在本轮验收范围。未提交/推送。

## 2026-09-08 项目切换消息保护与弹窗重渲染修复
- App/tabs 项目导航先确认未发送消息，再确认正文；取消保留页签/草稿，当前项目重复选择不重置，后台移除不影响当前输入。共享导航去重及项目/卸载有效性检查。
- 新增 7 条行为回归，相关 13 passed；初次原生失败暴露 callback identity 被误当项目身份，deferred + render 回归由红转绿，绑定真实项目生命周期后原生菜单取消/确认通过。
- 最终 pnpm verify exit 0：frontend 937 / API 1592 passed（7 skipped、6 warnings），project-core 7，OpenAPI 无漂移；build/smoke/恢复 Rust build/diff check 通过。
- 原生资源 index-COWRcnku.js，取消保留消息与正文，明确放弃后才切换。截图已查看；临时 main.rs 诊断已恢复，原生/API/CDP 全部停止。详情 .codex/uiux-project-draft-20260908/acceptance.md。
- 未提交/推送。异步启动恢复、在途项目创建、运行中任务退出等仍需验证，不宣称整体完成。

## 2026-09-08 启动恢复不得覆盖手动导航
- 显式区分自动恢复与手动导航，已批准手动导航同步使旧恢复失效、清空恢复状态并放行新现场持久化；覆盖同项目和偏好重新启用。正常恢复不受破坏。
- 新增4项回归，相关11 passed；最终 pnpm verify exit 0，frontend 941 / API 1592 passed（7 skipped、6 warnings），project-core 7，OpenAPI 无漂移。build/smoke/恢复 Rust build/diff check 均通过。
- 原生资源 index-bcBtGd41.js：正常恢复通过；现有 FS seam 仅延迟真实 path_exists IPC，用户从欢迎页打开 other 后旧校验完成，项目/正文/消息未被覆盖，新现场在旧 I/O 完成前即可持久化。详见 .codex/uiux-restore-navigation-20260908/acceptance.md。
- 截图已查看；临时观察代码恢复，原生/API/CDP 停止。未提交/推送，整体目标仍继续。

## 2026-09-08 项目创建晚返回与重复创建保护
- 两类创建共享 mutex/busy UI；旧成功不切走当前项目，只通知实际落点并提供安全打开；旧失败不弹目录选择器。自动首句绑定项目，离开后不再复活旧首句。
- 新增7项回归通过；最终 pnpm verify exit 0：frontend 948 / API 1592 passed（7 skipped、6 warnings），project-core 7，OpenAPI 无漂移。production build、恢复 cargo build、Chromium smoke、diff check 均通过。
- 原生验收未完成：目录选择器尝试中断后用户允许继续，但重载产生叠加窗口和失效控件索引；未进入创建阶段。没有将超时/普通 smoke 算作完整真机创建成功。详情 .codex/uiux-project-create-20260908/acceptance.md。
- 已核实路径并终止本轮隔离 PID 14144 进程树（非正常退出验收），API/CDP 端口均关闭；Rust pause 补丁完全恢复。未提交/推送，完整原生创建链仍待补验。
