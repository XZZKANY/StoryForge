## 2026-10-30 自动更新：下载新版、作者点「重启安装」后走完退出握手再装（自动更新刀 3）

- 背景：作者 10-30 拍板「点重启安装才装、右下角弹窗提示有新版、先只用 GitHub」。刀 1 #536（引擎库升级前自动备份）、刀 2 #538（接插件、检查新版、出包签名）已合。查过插件 2.12.0 源码：Windows 上 `Update::install` 先跑 `on_before_exit`、`ShellExecuteW` 起安装器（被动模式 `/P /UPDATE /R`，装完重新打开），然后直接 `std::process::exit(0)`，不经过 `RunEvent::ExitRequested`——所以安装必须排在现有退出握手之后。
- 改动（帧契约、`contracts.ts`、引擎不动）：
  - `app_update.rs`：`app_update_download` 重新检查后下载（进度经 `Channel` 报给界面，插件下载完用公钥核对签名，下载另设 30 分钟总超时——插件不把检查时的超时带到下载上），安装包留在内存 `StagedUpdate`；`app_update_restart_install` 记下「退出时安装」后 `window.close()`，与作者点 × 同一条路：关窗守卫先问未保存、放行后进退出握手；`install_if_armed` 在 `host_close::start` 握手收尾、`app.exit` 之前调用，装不起来就照常退出（下次打开检查更新还会提示）；`close_guard::resolve_close_request` 在作者选了不关时 `disarm`，这次不装、下次关窗也不顺手装。新下载的一份不继承旧的「重启安装」。
  - 界面新模块 `lib/app-update.ts`：启动提示与设置页共用一份状态（检查 / 有新版 / 下载中带进度 / 已下载好 / 各自的失败原因）。启动 8 秒后的检查从 `App.tsx` 挪进 `useStartupUpdateCheck`（`App.tsx` 有 400 行硬上限，原地加会到 401），右下角提示「有新版本 vX（当前 vY）」带「下载」按钮；下载好再弹「新版本 vX 已下载好」带「重启安装」。下载中、已下载好时再检查不冲掉进度。
  - 设置页「关于」：状态行与按钮随阶段变（检查更新 → 下载新版 → 下载中… → 重启安装），有更新说明就显示在下面（跟着设置搜索过滤）；说明文字改成新流程。
  - 发版清单 §7 caveat 改写。
- 验证：
  - 前端 `vitest run tests/app-update.test.ts tests/settings-about-update.test.tsx`：6 passed（检查 → 下载进度经 Channel → 已下载好弹「重启安装」并调宿主命令；下载失败抛出原因、状态退回可重下；重启安装失败留在已下载好并带原因；下载中 / 已下载好再检查不冲掉；没有版本号报检查失败；打包版 8 秒后静默检查、提示带「下载」；设置页整条流程：状态行、更新说明、进度百分比、按钮文字与禁用、最后调 `app_update_restart_install`）。连同 `update-check` / 设置页其余 4 个文件 / `source-standards`：8 files / 62 passed。前端 `typecheck`、改动文件 eslint、prettier 通过。
  - `node --test apps/desktop/scripts/release-build.test.mjs`：7 passed（接线守卫扩成：`main.rs` 注册插件、`StagedUpdate` 与三个命令且界面调的是同名命令；握手收尾先 `install_if_armed` 再 `app.exit`；关窗守卫不关时 `disarm`）。
  - Rust：`app_update::tests::installs_only_what_the_author_asked_to_restart_for`（没下载不能装、下载好没点不装、选了不关撤销、新下载不继承、只装一次）通过。
  - 变异（`output/auto-update/mutate_cut3.py` 与一段内联脚本，断言替换点唯一、无条件还原并逐字节核对）：F1 下载好不弹「重启安装」→ 1 红；F2 重启安装不调宿主 → 3 红；F3 检查冲掉下载进度 → 1 红；F4 设置页「重启安装」按钮接成下载 → 1 红；F5 进度不更新 → 2 红；F6 启动提示不带「下载」→ 1 红；R1 握手收尾不装 → 1 红；R2 不关时不撤销 → 1 红；R3 新下载继承旧的「重启安装」→ Rust 1 红。
  - 全量 `cargo test`（`CARGO_TARGET_DIR` 复用主仓库 target）184 passed + 1 ignored；`pnpm verify`（corepack 缓存的 pnpm 9.15.4 临时 shim）一遍 EXIT=0：project-core 34、引擎 14074 passed + 2 skipped、前端 2580 passed、三个浏览器回归通过。日志在 `output/auto-update/`（不入库）。
  - 行尾：`main.rs` CRLF 按字节改；其余全 LF，无 CRCR；`--numstat` 与 `--ignore-all-space --numstat` 一致。
- 未覆盖：
  - **整条链没在真机上走过**：从一个带更新器的装机版，经 GitHub latest.json 下载、点重启安装、被动安装、重新打开、数据仍在——要等发出 0.2.4（第一个带更新器的版本，0.2.3 要手动装一次）之后再发 0.2.5 才能真走一遍；或者另做本地升级冒烟（隔离身份、两个带签名的测试安装包、本地清单），见 PR 描述。
  - `host_close` / `close_guard` 的接线只有源码级守卫：这两处要真 `AppHandle`，单测起不来。
  - 被动安装在作者机上会不会弹 SmartScreen 没验：安装包没有 Windows 代码签名；插件用 `reqwest` 下载、文件不带「来自网络」标记，按理不触发，未实测。
