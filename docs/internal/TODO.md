# StoryForge 待办清单

生成时间：2026-07-11 12:00:00 +08:00

## 当前执行入口

StoryForge 当前处于 Desktop 对话式 Agent 与私测 Alpha 收口阶段。产品契约为：StoryForge = Cursor for Fiction（作者辅助 IDE），`apps/desktop` 是唯一主体验；默认开发入口为 `pnpm dev` / `pnpm desktop:dev`；`apps/web` 已退场（2026-06-21 已完成 `apps/web` 退场收口）。2026-06-30 拍板：交互中枢为 Claude Code/Codex 式对话 agent，批量自动整书不再是主线；长篇、短篇、章节和修订输出统一表达为 Writing Run / 写作任务；BookRun 是 managed full-book run 的内部兼容实现与后台工具，不是主产品控制台。

真实 LLM 1/3/10 章 smoke 已通过记录，其中 10 章 smoke 已完成人工通读；一次 30 章真实长程已跑完并导出制品，但人工通读结论为“退回重跑”；2026-06-30 Q9 16 章真实跑修复门禁丢章四根因并抢救为完整 16 章、人工通读通过。2026-07-01 已合并：UI 单色改版（PR #42）、私测 Alpha 单机 sidecar + BYO-key + NSIS（PR #43/#44）、对话式 Agent + `chat.explain` 接真·LLM（PR #46）。2026-07-02 已合并：事实源刷新（PR #47）；左栏会话历史列表接真后端 + 欢迎页输入框接真发送（PR #48）；Agent loop 三步落地——path-scoped 只读 fs 工具、chat 自由文本 LLM 工具循环、前端流程树全事件驱动（PR #49/#50/#51）。

2026-07-03 起按架构审计蓝图完成 W0-W7 全波结构收口；2026-07-05 桌面壳子 redesign P0-P4 合并（PR #81-#85）；2026-07-07 E2E-1 真机验收首轮门禁 G.1 全 PASS；2026-07-08 canon 防漂移 slice1/2（PR #114/#115）；2026-07-10/11 两轮过夜重构（PR #124/#125）收口 LLM 出网单通道、前端 vitest 单跑与新 agent 工具。**2026-07-11 拍板路线**：先把编辑器做到「安全可日更」（装机前两小刀 → 重建 0.1.2 → AI 装机预验 → 真机第二轮观感波 → 修复锁版），再在编辑器上接续 n=1 连载写作；08-31 盛夏寻章征文不当锚；愿景 = 写 → 发 → 收集信号 → 喂 → 进化编辑器 → 写出更有风格的作品。

## 当前事实边界

- 30 章真实长程证据目录：`.codex/real-llm-30ch-mimo25pro-20260611-192356`；运行链路、Markdown、EPUB 和审计报告导出完成，但人工通读退回重跑。
- 30 章退回阻塞：测试痕迹残留、章节结构模板化、重复表达、人物称谓混乱、17/18 章时间线冲突、线索膨胀和结尾收束不足。
- 后续工程修复已覆盖 recap 膨胀、计数失真、collapse_judge 误报、S3 bucket 缺失和 reasoning token 泄漏；Q9 16 章真实跑又修复了门禁丢章四根因（字数容差、judge 误标、grounding 部分提交、缺章护栏）；这些修复需要通过新一轮长程运行与人工通读验证。
- Desktop IDE Agent 已支持后端意图源收口、真实文件修订、多视角审稿、稳定 issue id、修订范围控制、proposed patch、确认写回防重复生成；Tauri 写回护栏已有脚本级 smoke 与两轮真机 GUI 验收证据，写回红线保持确认制。
- 对话式 Agent 现状（2026-07-02 至 07-12）：`chat.explain` 已接真·LLM，对话为项目级会话、切换文件不丢；左栏会话历史列表与欢迎页输入框已接真；chat 自由文本走 LLM 工具循环（path-scoped 只读 `fs.list` / `fs.read` / `fs.search`，最多 8 轮，首轮失败回落单轮），前端流程树全事件驱动、预制骨架步骤已删。边界：工具循环入口是 chat 自由文本，审稿 / 修订 / 新文件起草 / 一致性观察已作为循环内工具并入（`file.review` / `file.revise` / `file.create` / `project.consistency`，一次对话最多一个待确认补丁，一致性工具只报机械观察不下结论），显式按钮路径仍走固定管线；chapter.review / bookrun.* 绑定 DB 实体且 BookRun 定位后台工具，不并入循环（已记为决定）；真·LLM tool-calling headless 与真机 GUI 工具循环均已通过，写回仍走 proposed patch 前端确认。
- 私测 Alpha（2026-07-01，PR #43/#44）：sidecar exe 独立起服、`llm-provider.json` 写盘换模型即生效、NSIS 安装包内嵌 sidecar 均已本机验证；真机 GUI 双击装机端到端未验。
- W2「sqlite schema 单一事实源」（2026-07-04 合并）：sidecar 起服跑 alembic 收口（存量库备份 + quick_check + stamp head 纳管、已纳管库 upgrade head），alembic 脚本打进冻结 exe，daily/packaged 两档 smoke 断言 managed=true；**schema 冻结已解除**，此后 ORM 列变更写 batch 安全迁移（约定见 `CLAUDE.md` §6）。这解锁了 Q1-Q8 一致性工具化（可再加列）。真机「旧版存量库换新 exe 起服 + 会话史完整」归 E2E-1 未验。
- 第一阶段核心组件链路和两轮真实 Tauri 桌面端到端均已通过：本地文件审稿 -> 修订 -> diff 确认 -> 写回护栏 -> 版本记录；Phase A「安全可日更」验收完成。
- `apps/web` 不再作为主体验、维护入口、调试入口、兼容入口或契约验证入口；BookRun 控制台也不作为主产品入口。
- 2026-07-03 至 07-11 结构收口（已合并）：架构蓝图 W0-W7 全波完成；W4 batch-2 六域 router 全卸（PR #119/#120）+ 冻结域死码物理清理（PR #121）；LLM 出网传输全收敛 `app/common/llm_client.py`（judge/story_state PR #124、retrieval PR #125，生产 httpx 归零）；前端测试 vitest 单跑、verify-unit 已删（PR #124）；canon 防漂移 slice1/2（PR #114/#115）+ workflow 能力迁移三刀（prose_check/collapse_check/entity_budget_check）+ canon_delta 确定性提案工具（PR #123-#125）。全量门禁：API pytest 939 passed、前端 vitest 148 passed、e2e 契约绿、OpenAPI 零漂移。
- E2E-1 真机验收首轮门禁 G.1 已于 2026-07-07 全 PASS；0.1.2 第二轮 A6 于 2026-07-12 全 PASS（壳子、SSE/REST、中文 IME、Canon dossier、权限四轨、单实例与运行控制），无未修 blocker。
- 编辑器优先 Phase A：A1-A6 已完成；A7 小缺陷修复、重打包、覆盖安装与锁版门禁完成，轻量 tag `v0.1.2` 指向本锁版提交。证据见 `.codex/e2e-2-runsheet-0.1.2.md` 与 `.codex/verification-report.md`。
- 自主连载 pivot：2026-07-07 拍板方向（网文中位以上自主连载）并完成番茄平台政策与数据面侦察；2026-07-10 收窄（近期作者即 oracle，品味机 deferred）；2026-07-11 拍板 08-31 不当锚、编辑器优先；n=1 创作资产（黄金三章 spec / Ch1 定稿已过 Gate-0 / Ch2 待审 / playbook v0 / 预注册跟读率预测表）已存档 `D:\记事本\StoryForge-n1连载-末世吞噬-创作资产存档-20260707.md`（仓库外，勿入库）。

## 下一步优先级

（2026-07-11 拍板重排：08-31 盛夏寻章不当锚，编辑器优先；原「窗口倒排」序列作废。详版计划——步骤事实依据 / DoD / 归属 / 阶段门——见 `docs/internal/editor-first-plan-2026-07-11.md`。）

1. 在编辑器上写作品（Phase B）：先做 S3 手稿保险（连载目录仓库外 git init + 计划任务自动 commit）→ 接续 n=1 连载（创作资产存档见「当前事实边界」末条；canon.json 首刷吃末世系统数字状态）；写作即 dogfood，摩擦日志驱动每周至多一刀 QoL。
2. Phase A 已封板：A1-A7 与两轮真机验收完成，`v0.1.2` 指向锁版提交；除阻断级回归外不再插入编辑器重构。
3. 质量轨已换锚（D1，后台）：「重跑真实 3-5 万字长程 + 人工盲评」不再排期，待 n=1 连载稳定后重评；BookRun 维持后台工具定位；Q1-Q8 一致性能力逐步做成 agent 工具挂进循环（已落 project.consistency / deep_consistency / canon / prose_check / collapse_check / entity_budget_check / canon_delta）。
4. 小刀池（顺手不专排）：S12 runtime_tools 残桥、S16 F15 pnpm dev 默认 sqlite、M4 非空表时间列。

## 本地验证入口

常用本地门禁：

```powershell
cd D:/StoryForge
pnpm.cmd lint
npm --prefix apps/desktop/frontend run typecheck
npm --prefix apps/desktop/frontend run test
pnpm verify
pnpm e2e
pnpm test
pnpm openapi
```

Desktop IDE Agent 定向验证：

```powershell
cd D:/StoryForge/apps/api
uv run pytest tests/test_ide_agent_orchestrator.py -q

cd D:/StoryForge/apps/desktop/frontend
pnpm.cmd run typecheck
pnpm.cmd run test
pnpm.cmd run verify:smoke
pnpm.cmd run verify:agent-conversation
```

真实 LLM 入口只在私有运行时变量已设置时执行，不读取 `.env`，不把 provider 配置或 token 写入仓库：

```powershell
cd D:/StoryForge/apps/api
uv run python -m app.domains.book_runs.book_generation --chapter-count 1 --token-budget 8000
uv run python -m app.domains.book_runs.book_generation --chapter-count 3 --token-budget 24000
```

## 事实来源

- 当前状态以 `docs/internal/current-phase.md` 为准；TODO 只保留下一步执行入口，不作为完整项目总览或历史计划来源。
- `README.md`
- `docs/internal/current-phase.md`
- `docs/internal/PROJECT_SUMMARY.md`
- `.codex/verification-report.md`
- `.codex/operations-log.md`
