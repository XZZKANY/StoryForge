## 2026-10-28 增加 Windows 远端验证

- 改动：新增 `Windows Verify` 工作流，目标为 `master` 的 PR 和推送到 `master` 均执行八道 `pnpm verify` 门禁。checkout 前关闭 `core.autocrlf`，Node.js 22 / pnpm 9.15.4，缓存 npm 与 pnpm store，安装根依赖对应的 Chromium。权限仅 `contents: read`，不使用用户 secrets 或真实模型。
- 验证：本地 Node.js 22.23.4 / pnpm 9.15.4 的 lint EXIT=0（两条既有测试 any warning）。首次远端运行发现准入清单测试误依赖默认语言排序，改为双方排序后比较完整数组，不改变产品排序或过滤逻辑；单测 16 passed。
- 变异：提交 `0aad3d42` 故意添加 `scripts/ci-failure-probe.mjs` 语法错误，本机 ESLint EXIT=1；远端在 lint 步骤失败：https://github.com/XZZKANY/StoryForge/actions/runs/40698566388 。提交 `7b6b234d` 删除故障文件后变绿：https://github.com/XZZKANY/StoryForge/actions/runs/40699562829 。Windows job 耗时 6 分 38 秒，其中 `pnpm verify` 5 分 21 秒；整个运行约 6 分 42 秒。
- 完整本地门禁：`pnpm verify` EXIT=0，用时 151.5 秒。project-core 14 passed；引擎 13818 passed / 2 skipped；前端 2422 passed；行间续写、桌面浏览器、Agent 对话三项浏览器回归通过。使用与依赖锁一致的 Chromium headless shell，未用真实服务替代测试。
- 工作流权限为 `contents: read`，checkout 不保留写凭据；依赖 action 固定到经官方仓库核对的完整提交 SHA。分支没有残留故障注入文件，两组 numstat 一致。
- 未覆盖：Rust 测试、Tauri 冒烟、真实模型和安装包验证不在此工作流范围；分支保护必过检查须由维护者配置。
