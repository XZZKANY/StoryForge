# 验证报告 · PR#155 code review 跟进（ultracode 多智能体评审四修）

时间：2026-07-23
分支：`chore/pr155-review-followup-20260723`
前置：PR #155（v3 欢迎页 + 移除发行车队 + 抽 project-core）已合并 master `e687e9bc`。

本刀 = 对该 PR 做一轮 ultracode 多智能体 code review（6 维评审 → 逐条对抗核验 → 综合），
落地 4 条确认发现的修复；另 4 条被对抗核验驳回，不修。

## 问题与变更

### ① 发行车队残留 `fanqie-api/`（medium · dead-code）

- `git rm -r fanqie-api/`（4 文件：README + 3 篇番茄写侧逆向文档），材料迁至
  `D:\StoryForge-Publish\fanqie-api\`（发行车队所在独立仓）。
- 该目录是 PR #155「移除发行车队」漏网料：含指向本 PR 已删源码的悬挂引用
  （`写侧架构.md:44` → `publish-api.ts / usePublishCockpit`）+ 真实作者标识 / book_id +
  竞品站私有接口逆向；README 自称「本目录未纳入 git」实为误提交。
- 全仓 ripgrep 确认目录外零引用，无构建 / 运行牵连。

### ② `onReopenWelcome` 静默失效（low · shell-wiring）

- `App.tsx` `onReopenWelcome` 除翻 `welcomeDismissed` 外一并 `setSettingsVisible(false)`：
  无项目时设置页占据中栏（`centerHasTabs`），只翻 dismissed 不清设置页会让命令面板
  「显示欢迎页」无任何视觉反馈。

### ③ project-core 围栏测试是孤儿门禁（low · gate-wiring）

- `scripts/verify-local.mjs` + root `package.json`（`test` 聚合 + `test:project-core`）
  加 `pnpm --filter @storyforge/project-core test`，镜像既有「Shared 契约测试」。
- 此前包自带 `path.test.ts`（全产品路径围栏 `isPathInsideProject` 等）无任何门禁执行。

### ④ welcome-page 测试只验静态标记 / 源码子串（low · test-gap）

- 重写 `welcome-page.test.tsx`：happy-dom 挂载真实 `App` 验行为——关页签 → 空起始态且
  不自动重开、空态点「显示欢迎页」→ 重现、拨启动开关 → 写盘 `false`、偏好为关 → 启动直落
  空态、**设置页开着点「显示欢迎页」也稳定露出（回归 ②）**。删源码子串断言。
- 保留 SSR 结构护栏两例（v3 两栏 / 四卡）+ sanitize 默认值一例。

## 验证

- `welcome-page` 8 例全绿（含 ② 回归）；**变异测试**：将 `App.tsx` 还原为 buggy handler
  后仅 ② 例失败（其余 7 例照过）→ 证该用例真守此 bug；还原修复后复绿。
- 无后端网络噪声：桩 `StatusBar` 健康探针（原每次挂载打 `127.0.0.1:8000/health/ready`）
  + `SettingsView` / `Editor`（挂载副作用与欢迎页行为无关）。
- 前端 vitest 全量 `50 files / 256 passed`；typecheck 绿；`pnpm lint` 0 errors + prettier 绿
  （仅 `Editor.tsx` 既有 exhaustive-deps warning）；`@storyforge/project-core` 测试 2 例绿。

## 红线审计

- 后端零改动、OpenAPI 零漂移、schema 零变更；② 仅前端 state 接线，无出网 / 无写盘变更。
- 路径围栏 `path.ts` 算法未改：对抗核验已确认 PR #155 的迁移行为等价、无越界（含真机
  Win32 `CreateFileW` 实测，`.. ` 尾随空格与 JS `=== '..'` 判定一致）。

## 未验证项 / 未修（对抗核验驳回，共 4 条）

- `path.ts` 尾随空格 / 点遍历：真机 Win32 与 JS 判定一致，无洞（medium → 驳回）。
- 规划文档过期引用：非本 PR 触碰、自带日期的归档快照（驳回）。
- `path.test.ts` 孤儿 = 安全假信号：遍历 / 兄弟前缀覆盖已由 `project-context.test.ts`
  承接（跑于 verify / pre-push），仅剩 ③ 的门禁卫生问题（medium → 驳回，③ 已收）。
- 启动开关裸奔：默认开态已由 SSR 用例钉住，真正窄口即 ④（medium → 驳回，④ 已补）。
- 真机：欢迎页关 / 重开 / 启动开关观感、设置页态重开——归 E2E-1 真机波。
