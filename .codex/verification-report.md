# 验证报告 · 世界线观测镜刀1：信号出口（observatory.scan）

时间：2026-07-17
分支：`feat/observatory-scan-20260717`

## 问题

七个一致性工具的富 issue（canon 闸 / 伏笔账 / 文笔气味等）目前只进 `ToolResult.output`
回喂 LLM，前端只收 `tool_trace.output_summary` 的计数标量——`ObsPanel.tsx` 外壳与
`Observation` 类型已在（诚实空态），但没有任何信号出口可接。观测 UI 化（编辑器优先阶段
的 QoL 方向，原型已过用户 eyeball）第一刀是把信号送出来。

## 变更

### 聚合扫描核心（新增 `apps/api/app/domains/agent_runs/observatory.py`）

- `run_observatory_scan(project_root, *, glob, stale_after_chapters)`：聚合三路**有真信号
  的确定性检查**——`run_canon_projection`（canon 闸 + dossier 顺带重建）、`promise_check`、
  逐 Markdown 文件 `prose_static_scan`（上限 100 文件，超出如实记 truncated；空文件按
  FsToolError 跳过并计数）。
- 归一化为前端 ObsPanel 可直接消费的 Observation 形状 `{id, severity, title, detail,
  source, location{path, line?, snippet?}}`：severity 映射 blocking→error、
  medium/中/高/high/严重→warning、低/low/advisory→advisory（error 专属声明结构矛盾，
  确定性文本气味最高到 warning）；canon/promise 沿用后端稳定 sha1 id，prose 无原生 id
  以 `sha1(path|dimension|snippet)` 合成（跨次运行稳定，供前端记忆已处理态）。
- `checkers` 元数据诚实标注：canon/promise/prose 三项 `ran` 带计数；consistency/collapse/
  entity_budget/deep_consistency 四项 `on_demand` 带原因（机械观察不下结论 / 需 Agent 语义
  参数 / LLM 按需）——**不裸跑空转，不伪造信号**。
- 结果经 `canon_store.write_derived` 原子写 `.storyforge/canon/derived/observations.json`
  （白名单加一项），并原样返回。

### IDE 命令入口（`command_registry.py`）

- 注册 `observatory.scan`（`writes=False`，与 `canon.refresh` 同模式：确定性派生缓存写入，
  无 LLM 无 DB 审计），handler 校验 `project_root` 必填、FsToolError 转 IdeCommandExecutionError。
- 复用既有 `POST /api/ide/commands/{command_id}` 通道，**零新增路由、OpenAPI 零漂移**。

## 验证

- `uv run pytest tests/test_agent_observatory.py -q` -> `8 passed`（三路归一化+写盘读回、
  checkers 状态表、id 跨次稳定、空文件跳过、无声明项目空观测、文件数上限 truncated、
  IDE 命令 roundtrip、缺 project_root 报错）。
- `uv run pytest tests/test_source_code_standards.py tests/test_agent_canon.py
  tests/test_agent_prose_scan.py tests/test_agent_promise_scan.py tests/test_ide_commands.py
  tests/test_agent_observatory.py -q` -> `99 passed`（源码标准含新模块 ≤500 行、零跨模块
  私有访问；相邻域零回归）。
- `uv run ruff check`（4 个触及文件）-> 绿（UP017 等 3 处已 --fix）。
- `pnpm.cmd run check:drift` -> `OpenAPI 契约无漂移`。
- `pnpm.cmd run e2e` -> 契约 `20 pass / 0 fail`。

## 红线审计

- 只写派生缓存（observations.json 经白名单+越界双保险），绝不碰手稿或 canon.json；
  canon.json 缺失时仅由既有 `scaffold_canon_if_missing` 建空模板（canon.refresh 同款语义）。
- deep_consistency 不进聚合扫描（LLM 按需红线）；collapse/entity_budget 不裸跑（无语义参数
  时零信号，如实标 on_demand 而非伪造 pass）。
- 输出 note 明示「确定性参考信号（无 LLM）：advisory 需结合原文核实，不是质量判定」。
- 暂存全部使用显式路径（4 文件 + 本报告）。

## 未验证项

- 前端消费（保存即重扫、ObsPanel 接线、观测镜视图）是后续两刀（PR-B/PR-C），本刀只交付
  信号出口；真机观感照旧归 E2E-1。
- prose 阈值仍未经真实语料校准（R4 遗留口径不变）；套话类 snippet 是命中词拼接而非原文
  子串，前端文本锚定位需拆词降级（已记入 PR-B 设计）。
