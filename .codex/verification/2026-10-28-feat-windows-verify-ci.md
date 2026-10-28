## 2026-10-28 增加 Windows 远端验证

- 改动：新增 `Windows Verify` 工作流，目标为 `master` 的 PR 和推送到 `master` 均执行八道 `pnpm verify` 门禁。checkout 前关闭 `core.autocrlf`，Node.js 22 / pnpm 9.15.4，缓存 npm 与 pnpm store，安装根依赖对应的 Chromium。权限仅 `contents: read`，不使用用户 secrets 或真实模型。
- 验证：进行中；本分支后续补充本地命令结果、远端成功耗时与故意 lint 失败的红→绿运行链接。
- 未覆盖：Rust 测试、Tauri 冒烟、真实模型和安装包验证不在此工作流范围；分支保护必过检查须由维护者配置。
