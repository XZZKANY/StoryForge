# StoryForge Desktop 私测 Alpha 实施计划

生成时间：2026-07-01

## 目标（A 档）

作者在自己机器**双击安装一个 Tauri 桌面 app**，**自带 LLM key**，**不装 Docker/Postgres/Redis/MinIO**，用对话 agent 审稿/改稿/写回。首批用户：你自己 → 熟人作者 →（往后）公开。

## 现状结论（M0 摸底，带证据）

| 维度 | 评级 | 事实 |
| --- | --- | --- |
| Redis | ✅ 可缺省 | 缓存 no-op、限流走 `MemoryStorage`、启动不依赖；仅 `/health/ready` 报 degraded（不挡桌面就绪门） |
| MinIO/S3 | ✅ 可缺省 | `s3_client` 缺配置回退 `memory://` |
| Sentry/Prometheus | ✅ 可缺省 | Sentry opt-in；Prometheus 仅进程内 `/metrics` |
| pgvector/检索 | ✅ 不挡路 | 不在桌面 review/revise/chat 主链路（`agent_runs/runtime.py` 不查 DB/不做 embedding）；非 PG 自动回退关键词 |
| **BYO-key 接线** | ❌ 阻塞 | SettingsView 是显示偏好；真实 key 只认后端 env `STORYFORGE_LLM_*`（`book_generation_preflight.py:37 resolved_llm_env`）。Tauri `get_api_config` 注入的是 StoryForge 网关 key，与 LLM provider key 是两套 |
| 桌面起后端 | ❌ 阻塞 | `src-tauri/main.rs` 是 dev 编排器：起 docker → `alembic upgrade head` → spawn `apps/api/.venv` python，且硬要求 vite:3007；无生产/打包启动路径 |
| 打包分发 | ❌ 阻塞 | `tauri.conf.json` 无 `externalBin`/sidecar、无 updater、无签名；装出来也跑不起来 |
| DB 单机化 | ⚠️ 需开发 | sqlite 引擎+ORM 兼容（测试即用 sqlite），但运行态建表只有 PG 专用 alembic（pgvector 裸 SQL 在 sqlite 必崩）→ 需 sqlite 引导，或保留 Postgres |

**核心判断**：基础设施（Redis/MinIO/pgvector/Sentry）都不挡路；真正挡 alpha 的是 **① BYO-key 没接（Q4）② 后端只有 dev 编排没有生产启动（Q5）③ 没把后端打进包（Q6）**；DB 是中间的一个决策点。

## 本地 DB 决策：单机 sqlite（已确认 2026-07-01）

选定 **甲·单机 sqlite**：作者不用装任何 DB，分发最轻。实现代价已纳入 A0：建表用 `create_all`（运行态当前唯一建表是 PG 专用 alembic，必须补 sqlite 引导）+ 给 3 个 pgvector 迁移加方言判空跳过 + `/health/ready` 的 PG 专用 SQL（`pg_tables`）改方言无关。ORM 本身已兼容（测试即用 sqlite 内存库）。

未选 **乙·内嵌便携 Postgres**（免改 DB 代码，但安装包要塞便携 Postgres 并管理生命周期，分发更重、跨平台更麻烦）；仅作为 sqlite 出现不可逾越问题时的回退选项。

## 里程碑（按依赖与风险排序）

### A0 — 单机后端可启动（keystone 前置，~3–5d，风险中）
让 API 以**单用户本地进程**启动：无 Docker、无 Redis/MinIO、sqlite、`memory://`。
- sqlite 引导：检测 `sqlite://` 时用 `create_all` 建表（运行态当前唯一建表是 PG 专用 alembic，必须补这条）。
- 3 个 pgvector 迁移加 `dialect.name != 'postgresql'` 判空跳过（保留 PG 路径不变）；`health/router.py` 的 `pg_tables` 查询改方言无关探活。
- 固化「本地模式」env profile：`STORYFORGE_DESKTOP_SKIP_SERVICES=1`（已存在）+ sqlite + 跳过 Redis/S3。
- **产出**：一条命令在无外部服务下起可用 API，`/health/ready` 绿到够用。带单测（sqlite 引导 + 迁移方言判空）。

### A1 — BYO-key 真接通（~3–5d，风险低-中）
作者在 app 内填 provider/baseUrl/model/key → 真实 LLM 调用用上。
- 接线缝 = `resolved_llm_env`（只读 `os.environ`）。最省改动方案:**桌面在拉起后端进程时,把本机安全存储的 key 注入子进程 env(`STORYFORGE_LLM_*`)**;`resolved_llm_env` 无需改。
- 安全存储:key 存 OS keychain(Tauri 安全存储)或本机受限文件,**不写仓库/日志**。
- SettingsView 从「装饰/只接受 env 变量名」改为接受真实 key + 校验(复用 provider-health 探针),provider/baseUrl/model 一并生效。
- **产出**:作者填 key 后,agent 改稿/审稿走真实 provider。带端到端验证(本机起服 + TestClient)。

### A2 — 后端打成 sidecar + 生产启动（keystone，~5–8d，风险高）
Tauri app 自带并拉起 Python 后端,去掉 docker/uv/.venv/vite:3007 假设。
- PyInstaller(或等价)把 FastAPI(`run_windows.py` 入口)打成独立 exe,在 `tauri.conf.json` 声明为 `externalBin` sidecar。
- `main.rs`:把 `start_docker_services` + `.venv` python spawn 换成 sidecar spawn;去掉 `:3007` vite 硬检查,改用打包好的 `frontendDist`;启动时设本地模式 env(sqlite/skip services)+ 注入 A1 的 key。
- **产出**:`tauri build` 出来的 app 启动即自带后端(sqlite、无 docker),服务打包前端。

### A3 — 首启引导（~2–3d，风险低）
- 首次运行:填 LLM key(A1)→ 打开/新建项目;给一个示例项目或引导。
- **产出**:新作者从安装到能用只需几分钟。

### A4 — 硬化 + dogfood（~1–2w，叠加进行）
- 写回文件安全(已有冲突保护)、错误处理(坏 key/provider 挂/网络抖)、长会话稳定、打包态崩溃/数据安全。
- 你先用真稿 dogfood → 修 top 问题 → 放 2–3 个熟人作者。
- **产出**:稳到作者愿意持续用。

### A5 — 安装器 +（可选）签名/自动更新（~3–5d，风险中）
- Windows 安装包(Tauri bundle 已 `targets:"all"`)。签名 + 自动更新对熟人 alpha 可后置,公开前再补。
- **产出**:可分发安装包。

## 工期与底线

- **关键路径 A0 → A1 → A2 → A3**:约 **3–4 周** focused 到「你+熟人能装能用」;A4 硬化 1–2 周叠加;A5 视分发需求。
- **总计 ~4–6 周 focused 到私测 alpha**,最大风险是 **A2(Python 打进 Tauri sidecar + 去 dev-tree 假设)**。
- 这是修正后的估算:BYO-key 经核实**未接通**(非「基本现成」),A1 是真实工作量。

## 不在 alpha 范围（登记备查）
多人协作、多租户认证、托管后端、生产级对象存储签名下载、Studio 编排器、持久异步队列、BookRun 批量整书控制台。

## 证据源
- M0 摸底结论散见本文表格;关键文件:`apps/api/app/db/session.py`、`apps/api/app/main.py`、`apps/api/app/common/redis_cache.py`、`apps/api/app/domains/book_runs/book_generation_preflight.py`、`apps/api/app/domains/agent_runs/runtime.py`、`apps/desktop/src-tauri/src/main.rs`、`apps/desktop/src-tauri/tauri.conf.json`、`apps/desktop/frontend/src/components/SettingsView.tsx`。
