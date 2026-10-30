## 2026-10-30 自动更新本机升级冒烟：旧版点「重启安装」升到新版（自动更新刀 3 的升级验证）

- 背景：作者 10-30 选了「先本地验」——0.2.4 是第一个带更新器的版本，它的更新器要是坏了没法靠自动更新修自己，只能再手装一次。刀 1 #536、刀 2 #538、刀 3 #541 已合（#541 在本冒烟通过后才合）。
- 改动（只加验证设施，产品行为不变）：
  - 宿主 `update_smoke.rs`：命令行带 `--storyforge-update-smoke-log=<文件>` 且应用标识**不是**正式的 `com.storyforge.ide` 时，打开后照作者的点法走「Ctrl+, 打开设置 → 关于 → 检查更新 → 下载新版 → 重启安装」，每步追加一行 JSON；遇到「检查失败 / 下载失败 / 没能开始安装」或 5 分钟超时记 failed。点「重启安装」前先记 `ready-to-restart`，按钮被右下角提示挡住时下一轮再点。用命令行不用环境变量：安装器用 `nsis_tauri_utils::RunAsUser` 重新打开新版（查过生成的 `installer.nsi`），不继承环境，但插件会把旧进程命令行经 `/ARGS` 原样转过去。`main.rs` 在非冒烟模式的 `setup` 里调它。
  - `apps/desktop/scripts/verify-update-smoke.mjs`（`npm --prefix apps/desktop run verify:update-smoke`）：沿用 `verify-nsis-install` 的隔离测试身份与守卫（开跑前确认身份干净、没有别的 StoryForge 进程，结束后卸载清理、核对作者装机版快照不变；为此把那边 10 个内部函数改成导出，行为不变）。一次性 `tauri signer generate --ci` 密钥；在测试身份配置上叠版本号（0.0.1 / 0.0.2）、`createUpdaterArtifacts` 与本机 `http://127.0.0.1:47391/latest.json`（`dangerousInsecureTransportProtocol` 只在测试身份里开）；清单用出包脚本同一个 `buildLatestJson`，只换下载地址；构建产物拷走后从包目录删掉，免得 `verify-nsis-install` 找到多个安装包。`STORYFORGE_UPDATE_SMOKE_TARGET_DIR` 可指到主仓库的编译缓存。
  - `verify-update-smoke.test.mjs`：测试身份配置的形状、装机版更新配置不许带 `dangerous*` 开关、本机清单与出包脚本同形、探针记录逐行解析（写到一半的行跳过）。接进 `test:release`。
  - 发版清单 §5 加「改了更新链要跑升级冒烟」，§7 caveat 按结果改写，并记下插件把下载的安装包留在 `%TEMP%`。
- 验证：
  - **升级冒烟真跑一遍通过**（`STORYFORGE_UPDATE_SMOKE_TARGET_DIR` 指主仓库 `.tauri-target-install-smoke`，两次发行版增量构建各约 1 分钟编译 + 前端构建与打包）：事件 `0.0.1 started → 0.0.1 ready-to-restart → 0.0.1 restart-clicked → 0.0.2 started → 0.0.2 up-to-date`；本机服务收到 `/latest.json`（旧版检查）、`/latest.json`（下载前复查）、`/candidate-setup.exe`（一次）、`/latest.json`（新版检查）；装上的程序与新版安装包里的载荷一致；注册表 DisplayVersion 从 0.0.1 变成 0.0.2；测试原稿逐字节不变；作者装机版快照不变。日志 `output/auto-update/update-smoke-run.log`，证据 `output/update-smoke/2026-10-30T13-22-09-968Z/evidence.json`（不入库）。
  - 清理核对：测试身份的安装目录、两个数据目录、卸载注册表项都已删除；包目录只剩原来的 0.2.3 测试安装包。插件留在 `%TEMP%` 的 `StoryForge Shadow Git Install Smoke-0.0.2-updater-*`（31 MB）手动删了。
  - `node --test` 三个脚本测试文件：21 passed。变异：装机版配置加 `dangerousInsecureTransportProtocol` → 1 红（逐字节还原）。
  - 合并 master 后全量 `cargo test`（`CARGO_TARGET_DIR` 复用主仓库 target）184 passed + 1 ignored；`pnpm verify`（corepack 缓存的 pnpm 9.15.4 临时 shim）一遍 EXIT=0：project-core 34、引擎 14110 passed + 2 skipped、前端 2581 passed、三个浏览器回归通过。
  - `cargo check` 无警告；`rustfmt --check update_smoke.rs` 通过（`main.rs` 里既有的格式差异不在本次改动的行上，没动）。
- 未覆盖：
  - 旧版停在作品库页时没建引擎库，所以「引擎库在更新后还在」这次没验到（证据里记的是 `baseline-did-not-create-it`）；原稿与引擎库同在应用本地数据目录，原稿逐字节不变说明这个目录没被安装器动过。
  - 「有未保存的修改时点重启安装 → 选不关 → 不装」没在真机上点（单测 + 源码级守卫覆盖）。
  - 经 GitHub 真实发布与系统代理的下载没走（本机 http）；首次真走最早 0.2.4 → 0.2.5。
  - 被动安装时 SmartScreen：本机这次无人点击也装完并重新打开了，说明没被拦（安装包没有 Windows 代码签名，插件下载的文件不带「来自网络」标记）；作者机上经 GitHub 下载的情形未验。
