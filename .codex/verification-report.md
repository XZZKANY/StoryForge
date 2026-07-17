# 验证报告 · 世界线观测镜刀3a：结构化台账出口（payload v2）

时间：2026-07-17
分支：`feat/observatory-structured-20260717`
前置：刀1 信号出口（PR #147）+ 刀2 前端接线（PR #148）已合并。

## 问题

观测镜右栏视图（刀3b：实体卡 / 伏笔账 / 提案卡）需要的结构化数据没有出口：
observations.json 只有扁平观测清单 + 检查器计数；dossier 事实投影只渲染成
人可读 markdown 不进 payload；伏笔台账只在 canon.json 作者声明里（promise_check
只出 issue 不出台账）；proposals.json 存的是**合并后 canon 草稿**而非提案清单，
待确认项需要与 canon 差读才能还原。

## 变更

### `promise_scan.py` 新增公开 `build_promise_ledger(canon, promise_output)`

- 作者 promises 声明 → 台账投影（id/title/status/kind/planted/due/resolved/
  last_touch_chapter），并按 promise_id 挂上 check_promises 输出的关联 issue
  （id/category/severity/message）。
- 只做字段校验与归并，不重算规则、不自造状态结论；坏类型字段落 None 如实呈现。
- 放在 promise_scan 内是为复用其私有校验 helper——跨模块私有访问是源码标准红线。

### `canon_delta.py` 新增公开 `read_pending_proposals(project_root)`

- proposals.json 草稿 vs 作者 canon 差读：新实体按 id 差集、新增不变量声明
  （single_holder/lifespan/timeline_order）按结构相等差集。
- 作者已并入或删除的条目自然从差集消失（差读自愈，不会重复出现）；缓存缺失 /
  损坏按可弃缓存语义返回 `available=False`，不伪造空提案。确定性只读，零写盘。

### `observatory.py` payload v1 → v2（纯 additive）

- 复用本次扫描刚重建的 canon + presence 缓存，追加三段：
  - `entities`：`canon_dossier.build_dossiers` 结构化投影 + `related_observation_ids`
    （single_holder 冲突按 holders、lifespan advisory 按 entity 关联到实体卡）；
  - `promises`：`{current_chapter, ledger}`；
  - `proposals`：`read_pending_proposals` 差读结果。
- 既有 observations/counts/checkers 键零变更；observations.json 派生缓存随
  payload 整体升 v2（可弃缓存，无迁移问题）。

## 验证

- `uv run pytest tests/test_agent_observatory.py -q` -> `13 passed`（8 既有零回归 +
  5 新增：实体台账关联冲突 id + missing 如实、伏笔台账 overdue issue 挂账、
  提案缓存缺失 available=False、草稿差读出新实体+新声明计数、已并入差集自愈清零）。
- `uv run pytest tests/test_source_code_standards.py tests/test_agent_canon.py
  tests/test_agent_promise_scan.py tests/test_ide_commands.py -q` -> `70 passed`。
- `uv run pytest tests/test_agent_canon_delta.py tests/test_agent_canon_context.py
  tests/test_agent_canon_hooks.py -q` -> `48 passed`。
- `uv run ruff check`（3 源文件 + 测试）-> 绿。
- `pnpm.cmd run check:drift` -> `OpenAPI 契约无漂移`（payload 走 IDE 命令通道，零路由变更）。
- `pnpm.cmd run e2e` -> 契约 `20 pass / 0 fail`。

## 红线审计

- 三段台账全部确定性、无 LLM、零新增写盘（proposals 差读只读；entities/promises
  复用扫描已写的缓存）；canon.json 与手稿零触碰。
- 台账不下结论：实体只挂关联观测 id（结论在观测本身）、伏笔 issue 全部来自
  check_promises、提案只做差集不判优先级。
- 暂存全部使用显式路径（4 文件 + 本报告）。

## 未验证项

- 前端消费（右栏观测镜视图：提案卡 / 伏笔卡 / 实体卡 / 检查器）是刀3b；
  光标行实体联动是刀4；真机观感照旧归 E2E-1。
- 提案卡「并入 canon」写回 canon.json 的前端确认流不在本刀（后续刀，红线内
  作者所有文件由前端确认写回）。
