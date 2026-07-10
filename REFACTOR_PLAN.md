# StoryForge 受控重构计划(第二轮 · 2026-07-10 过夜)

分工:**计划 = Claude(本文件,已拍板全部设计决策)/ 执行 = Codex(GPT-5.6 Ultra,今晚)/ 验收 = 用户(明早)**。
分支:`codex/refactor-overnight-20260710`,自 `master`(起点 129dd3b4)新建。
第一轮(2026-07-08,PR #116)见本文件 git 历史 dd35c0e0;本轮不重复第一轮已完成的 B1-B4。

执行纪律:**按本文件执行,不自由发挥**。设计决策已全部拍板;执行中遇到本文件没覆盖的分叉,选保守路径(回弃当批并记录),不要现场发明新方案。

---

## 0. 启动步骤(按序)

1. `git status --short --branch` 记录启动状态。未跟踪的 `.agents/`、`.trellis/`、`.codex/config.toml`、`.codex/hooks*`、`.codex/agents/`、`AGENTS.md` 等本机脚手架视为既有内容,**永不 stage**。
2. 自 `master` 新建分支 `codex/refactor-overnight-20260710`。
3. 通读上下文(执行前置,不可跳):
   - `AGENTS.md`、`CLAUDE.md`(尤其 §6 协作约定)
   - `docs/internal/workflow-capability-migration-ledger.md`(B1 的立项依据)
   - `apps/api/app/domains/DOMAINS.md`(红线清单)
   - `git show bfb5c75c`(**B1 的逐文件模板**:prose_check 首刀全 diff)
   - `apps/desktop/frontend/scripts/verify-unit.mjs` 与 `apps/desktop/frontend/vitest.config.ts` 全文(B2 前提)
4. 记录基线数字,写入 `.codex/verification-report.md` 本轮新段开头:
   - `cd apps/api && uv run pytest -q` 总通过数;
   - `cd apps/desktop/frontend && node scripts/verify-unit.mjs` 用例数;
   - `cd apps/desktop/frontend && npx vitest run` 用例数。

## 1. 全局红线(违反任一 = 本轮失败)

1. **不删、不改 `apps/workflow` 下任何文件。** B1 的 salvage 一律「复制进 `apps/api`」,不是移动;新代码禁止出现 `storyforge_workflow` import(`book_generation_parallel.py` 的既有 importlib 桥是唯一例外,本轮不碰它)。
2. **零 ORM / schema / alembic 变更。** 不碰任何 `models.py`,不新增迁移。
3. **不动 UI 组件与观感。** `apps/desktop/frontend/src/components` 零改动;B2 只允许动 `tests/`、`scripts/`、`vitest.config.ts`、`package.json`。
4. **禁 `git add -A` / `git add .` / `git add -u`。** 只显式路径 stage(仓库常驻未跟踪本机脚手架,踩过误提交事故)。
5. **改 loop 工具 spec 必须连 `apps/api/tests/fixtures/loop_tool_schemas_golden.json` 一起提交**(历史教训:golden 漏提交直接导致 master 红)。golden 重生注意换行符与既有文件一致(CRLF 坑)。
6. **不 push、不开 PR。** 本地小步提交,留分支待明早验收。
7. **不读不写真实 LLM key / `.env` / `llm-provider.json`。** 全部验证走确定性测试与 mock。
8. **OpenAPI 预期零漂移。** agent loop 工具不是 HTTP 面;若 drift 检查变红,停下查因或回弃当批,不得刷新快照了事。
9. **每批独立提交;批内门禁不绿不提交;修不绿就 `git restore` 整批回弃并在报告记录。** 宁可少而绿,不要多而花。提交信息简体中文,前缀 feat/refactor/test/docs。

## 2. B1(必做)·`project.collapse_check`——「本场是否承重」advisory 工具

workflow → IDE-agent 能力迁移**第二刀**(首刀 = `project.prose_check`,PR #123 / commit bfb5c75c)。ledger §2(b) 已钦定 tier-1 下一件就是 `collapse_judge`。

### 源与目标

- 只读参考(复制素材,**勿改动源文件**):
  - `apps/workflow/storyforge_workflow/narrative/collapse_judge.py`(规则本体,124 行)
  - `apps/workflow/storyforge_workflow/narrative/verdict.py`(issue/verdict 形状,内联进新文件)
  - `gate_harness.py` 是批量接线,**不搬**。
- 新文件:`apps/api/app/domains/agent_runs/collapse_scan.py`,**自包含**(与 `prose_scan.py` 同模式:单文件、无 workflow import;verdict 的 issue dict 形状直接内联,暂容忍与 prose_scan 的形状重复,共享地基留第三刀再抽)。

### 设计拍板(不留执行期发挥)

- 工具名 `project.collapse_check`;**advisory only,绝不 blocking**;输出 = verdict(`pass` | `warn`)+ issues 明细(rule / severity / detail / snippet)+ 给 LLM 的短 summary(照 prose_check 的 summary-only 模式,省 token)。
- 参数(JSON schema):
  - `path`:必填,项目内正文文件相对路径,沿用既有 path-scope 守卫(照抄 prose_check 的文件读取与越界拒绝路径);
  - `beats`:可选 `string[]`;`emotion_before` / `emotion_after`:可选 `string`;`irreversible_consequence`:可选 `string`;`deletable`:可选 `boolean`。
  - **语义:字段未传 = 对应规则跳过(诚实缺席,不猜);显式传空串/空数组 = 作为「无」参与判定。** 这些观察值由循环内 LLM 读完正文后自填——LLM 当抽取器、确定性规则当判定器。
- 判定规则(salvage 自 `collapse_judge.judge()` + `_investigation_template_score()`;`judge_fact` / `NarrativeSceneFact` / `phase_policy` 路径**不搬**——依赖 extract/plan,归后续 canon 抽取刀):
  1. **process-only**:`beats` 传入且逐项 strip 后 == `["到场","取证","保存","转场"]` → issue(中);
  2. **情绪零变化**:`emotion_before` 与 `emotion_after` 均传入非空且相等 → issue(低);
  3. **无不可逆后果**:`irreversible_consequence` 显式传入且为空串 → issue(低;未传则跳过);
  4. **deletable**:传入 `true` → issue(低);
  5. **正文调查模板**:工具自己读 `path` 正文,原样复制五桶关键词表(`_investigation_template_score` 的 buckets),以全文为匹配对象计分;得分 ≥ 3 **且** `irreversible_consequence` 为空或未传 → issue(中,snippet 给命中的桶词;detail 注明这是以「无不可逆后果」近似原版 has_advancement 三信号的降级判定);得分 ≥ 3 但 `irreversible_consequence` 非空 → 不出 issue(视为有推进,与原版 `template_score >= 3 and not has_advancement` 对齐)。

### 接线(逐条照 bfb5c75c 的 diff 位置做)

- `tooling.py`:注册 ToolSpec(参数 schema、描述;描述里写清「advisory 参考信号,不是质量判定」);
- `loop_runtime.py`:接工具分发;
- `runtime.py`:output 段接入(summary-only 回 LLM);
- `role_catalog.py`:与 prose_check 同档挂进角色可用集;
- `apps/api/tests/fixtures/loop_tool_schemas_golden.json`:重生,diff 只应新增 collapse_check 条目。

### 测试(新 `apps/api/tests/test_agent_collapse_scan.py`,参照 `test_agent_prose_scan.py`)

- 五条规则各有正例 + 反例;「未传」vs「传空」的语义区分要有显式用例;
- 调查模板:构造命中 ≥ 3 桶的中文正文正例 + `irreversible_consequence` 非空的反例;
- path 越界拒绝、文件不存在报错(不伪造空结果);
- `test_agent_loop_runtime.py` 加集成断言(工具进 schema、golden 对账),照首刀的加法。

### 验证

```powershell
cd apps/api
uv run pytest tests/test_agent_collapse_scan.py tests/test_agent_loop_runtime.py -q
uv run pytest -q          # 全量,不得低于基线
uv run ruff check .
node ../../scripts/check-openapi-drift.mjs   # 期望零漂移
```

提交:`feat(agent): project.collapse_check 场景承重 advisory 工具(workflow 能力迁移第二刀)`

## 3. B2(必做)·前端测试 runner 收口:verify-unit → vitest 单跑

蓝图 W7(`docs/internal/arch-review-blueprint-2026-07-03.md` W7 段)拍板:「既有测试文件双跑一个 PR 周期后删 `verify-unit.mjs`」。双跑始于 2026-07-04,周期已满。现状:`test` 脚本 = `node scripts/verify-unit.mjs && vitest run`;`vitest.config.ts` 只 include `*.vitest.ts`。

### 约束

- **零新增依赖**(vitest + happy-dom 已在 devDependencies;禁止碰 lockfile);
- 不改任何被测源码(`src/` 零改动);
- 不改测试断言语义——只换 runner;`node:assert/strict` 导入**保留**(vitest 跑在 node 上,assert 原样可用,保留它可最小化 diff),只把 `import { test } from 'node:test'` 换成 vitest 导入。

### 步骤拍板

1. 盘点:`rg "from 'node:test'" apps/desktop/frontend/tests` 列出用到的 node:test 符号全集(test / describe / beforeEach / mock / 测试回调的 `t` 上下文参数等),逐符号定 vitest 等价映射;个别无直接等价的用法允许最小改写,但须在报告列清单。
2. 读 `verify-unit.mjs` 全文,列出它给测试注入的环境(window global、模块解析特例、css/json 处理),在 `vitest.config.ts` 等价补齐(happy-dom 天然提供 window/dispatchEvent;css 交给 vite 管线)。
3. 改造 `tests/**/*.test.ts(x)` 的 runner 导入;`.tsx` 组件测试确认在 happy-dom 环境下通过。
4. `vitest.config.ts` include 扩为同时覆盖 `tests/**/*.test.ts(x)` 与既有 `*.vitest.ts` glob(既有 `.vitest.ts` 文件**不改名**,避免无谓 churn);environment 统一 happy-dom。
5. `package.json`:`test` → `vitest run`;`test:behavior` 变冗余——先 `rg "test:behavior|verify-unit"` 盘点活链路引用(根 package.json、`scripts/`、`.github/`、pre-push hook),同步收敛;**历史文档(`docs/`、`.codex/verification-report.md` 旧段)里的提及不追改**。
6. 删除 `apps/desktop/frontend/scripts/verify-unit.mjs`。
7. 对账:迁移后 `npx vitest run` 总用例数 **≥ 基线之和(verify-unit 用例数 + 既有 vitest 用例数)**,0 fail,不得新增 skip;`npm --prefix apps/desktop/frontend run typecheck` 绿;`pnpm.cmd lint` 绿。

### 回弃条件

个别 `.tsx` 测试在 happy-dom 与 verify-unit 自制环境下行为不一致且短时间(约 30 分钟)定位不了 → **整批回弃 B2**,报告记录卡点文件与差异现象。不允许留双 runner 的中间态。

提交:`refactor(desktop): 前端测试收口 vitest 单跑,删除自制 verify-unit runner(W7 收尾)`

## 4. B3(选做,B1、B2 全绿且时间富余才做)·judge/story_state chat 出网统一到 llm_client

F16 后续:W3 已把 live 循环收敛到 `app/common/llm_client.py`(重试 + 记账 + 脱敏),但 `judge/semantic.py`、`story_state/semantic.py` 的 chat/completions 仍各自 httpx 直连(W3 当时只统一了配置源 `resolved_llm_env` 与失败日志脱敏)。

### 范围

仅 judge、story_state 两域的 chat/completions POST(先 `rg httpx` 盘点两域全部出网点,`judge/service.py` 若含出网一并列入);`retrieval` 的 embedding/reranker **不动**(非 chat 端点,W3 已明确排除)。

### 硬性行为保持(逐条核对,任何一条保不住就回弃)

1. `STORYFORGE_JUDGE_LLM_TIMEOUT_SECONDS` 覆盖链继续生效——llm_client 若不支持 per-call timeout,加可选入参(默认值保持现状,既有调用方零改动);
2. **重试语义不变**:judge 现状一次失败即回落 deterministic;llm_client 内置重试的话,必须支持 `max_attempts` 类入参,judge 侧显式传 1 保持既有时延语义;story_state 同理逐点核对;
3. 异常类型保持:上游 `except` / `isinstance` 依赖的异常类必须保持或别名(照 W3「errors 别名同一对象、零改动」手法);
4. 请求 payload 字段与响应解析逐一对齐(model、messages、temperature、鉴权头、非 200 与解析失败路径)。

### 验证

既有 judge / story_state 测试全绿(mock 点从 httpx 迁到 llm_client 层时,断言请求形状不变);`rg "import httpx" apps/api/app/domains/judge apps/api/app/domains/story_state` 归零;全量 pytest ≥ 基线;ruff 绿。

### 退出条件

等价性任何一点拿不准、或改动扩散出两域 → 立即 `git restore` 整批,报告记录卡点,**这不算失败**,是计划内的保守出口。

提交:`refactor(api): judge/story_state chat 出网统一走 common llm_client(F16 收尾)`

## 5. 收尾与报告

1. 全部批次完成后统一跑:`pnpm verify`、`pnpm e2e`(Windows 用 `pnpm.cmd`);
2. `.codex/verification-report.md` 追加本轮段:标题(第二轮过夜重构)、基线数字、各批「命令 + 输出摘要」、回弃/未做项及原因;
3. 回填本文件 §7 执行结果表;
4. 把 `REFACTOR_PLAN.md`、`.codex/verification-report.md` 与各批改动文件按批次显式路径提交(计划文件随第一个提交进分支)。

## 6. 明早验收清单(用户 / Claude 执行)

1. `git log --oneline master..codex/refactor-overnight-20260710` —— 预期 2~3 个业务提交(+计划/报告),信息与批次一一对应;
2. `git diff master --stat` —— 改动面只落在本文件各批清单内;**`apps/workflow` 零改动;`src/components` 零改动;无 models.py / alembic 变更**;
3. `cd apps/api && uv run pytest -q` 全绿且 ≥ 基线;`uv run ruff check .` 绿;
4. `npm --prefix apps/desktop/frontend run test` 全绿、用例数 ≥ 基线之和;`scripts/verify-unit.mjs` 已删(若 B2 未回弃);
5. `pnpm verify` + `pnpm e2e` 绿;OpenAPI 零漂移;
6. 抽查 `test_agent_collapse_scan.py`:「未传 vs 传空」用例存在、调查模板正反例存在;
7. 读 `.codex/verification-report.md` 新段 + 本文件 §7 结果表;
8. (可选,真 LLM)`pnpm dev` 起桌面,对话问「读一下某章,这一章是不是过场戏/有没有承重」,观察循环调用 `project.collapse_check` 并回 advisory 信号。

## 7. 执行结果(Codex 回填)

| 批次 | 状态(done / reverted / skipped) | 提交 hash | 备注 |
| ---- | ---- | ---- | ---- |
| B1 collapse_check | | | |
| B2 vitest 收口 | | | |
| B3 llm_client 统一 | | | |
