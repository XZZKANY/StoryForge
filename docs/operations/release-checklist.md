# StoryForge 发版清单

更新时间：2026-10-30

## 1. 适用范围

给作者出 Windows 装机包（NSIS）前的检查。装机包里只有桌面应用（界面 + TS 引擎 + Rust 宿主），不含任何后端进程。

## 2. 版本号

- 改 `apps/desktop/src-tauri/tauri.conf.json` 的 `version` 与 `apps/desktop/src-tauri/Cargo.toml` 的 `version`（`Cargo.lock` 随 cargo 更新）。
- 已出过包的版本号不能复用：同名重打作者分不清装的是哪个。

## 3. 门禁

```powershell
pnpm verify
npm --prefix apps/desktop/frontend run build   # Rust 编译要嵌入 frontend/dist；干净检出时 verify 不会生成它
npm --prefix apps/desktop run test:rust
```

两者都绿才继续；失败原因与处理记进验证记录（`.codex/verification/`）。

## 4. 构建

正式包要带自动更新签名，用出包脚本（作者本机跑）：

```powershell
$env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = '<生成密钥时设的密码>'
node apps/desktop/scripts/release-build.mjs --notes output/release-<版本>/release-notes.md
```

- 私钥默认读 `~/.storyforge-updater/storyforge-updater.key`（`TAURI_SIGNING_PRIVATE_KEY` 可指别处），公钥写在 `tauri.conf.json` 的 `plugins.updater.pubkey`（密钥 id `D30F0EF64F15504C`）。私钥不进仓库、不进 CI；丢了，已装的版本就再也收不到自动更新，只能手动重装。
- 更新说明会出现在作者的更新提示里，不能空。
- 脚本只打 NSIS，产物放到 `output/release-<版本>/`：`StoryForge-IDE_<版本>_x64-setup.exe`（不带空格）和 `latest.json`；打印大小、SHA256 与发布命令。签名用的私钥与公钥对不上、或 `output/release-<版本>/` 里已经有同名安装包，就停下不写。
- 只想本地验证、不发布时用 `pnpm desktop:build`（不签名，产物在 `apps/desktop/src-tauri/target/release/bundle/nsis/`）。

## 5. 装机前验证

```powershell
node apps/desktop/scripts/verify-tauri-smoke.mjs --release      # 发行版 exe 冒烟：书库 → 总览 → 工作台 → 补丁审阅 → 写回
npm --prefix apps/desktop run verify:nsis-install                # 隔离身份静默安装 → 启动 → 卸载
```

改动涉及引擎与宿主之间的接口、模型出网或引擎库时，再跑真宿主探针（`apps/desktop/frontend` 下 `node scripts/verify-engine-p0-native.mjs --agent-only` 等，见 `local-start.md` 第 7 节）。探针要求本机没有在跑的 StoryForge，先问作者能不能关。

## 6. 交付

- 用出包脚本打印的 `gh release create` 命令发布（作者亲手跑），安装包和 `latest.json` 一起上传：装机版从 `releases/latest/download/latest.json` 发现新版，少传它就收不到更新。
- tag 照常用 `v<版本>`：0.2.3 及更早的装机版靠比对 tag 提示新版，而且它们没有更新器，要手动装一次带更新器的版本。
- 告诉作者：版本号、这一版带了哪些改动、装前是否需要备份（动了引擎库 schema 或旧库导入时，提醒备份 `%LOCALAPPDATA%\com.storyforge.ide\` 下的 `.sqlite3` 文件）。
- 在验证记录（`.codex/verification/`）里记一条：版本、大小、SHA256、跑过的门禁与冒烟、没跑的项。

## 7. 已知 caveat

- 安装包没有 Windows 代码签名（自动更新的签名是另一回事，只证明更新包出自持私钥的人）。
- 自动更新：有新版时右下角提示「下载」，下载完核对签名，作者点「重启安装」后照点 × 关窗（先问未保存、走完退出握手），最后一步交给安装器被动安装并重新打开。整条链还没在真机上从一个装机版升到下一个装机版走过一遍。
- 模型 key 用 Windows 用户级 DPAPI 加密存本机，是用户级保护而非分发硬化。
- NSIS 隔离安装验证只证明安装、启动、卸载，不包含升级验证；升级保留另取证。

## 8. 不得出包的情况

- `pnpm verify` 或 Rust 测试没跑，或失败但没记录原因。
- 发行版冒烟没跑。
- 版本号与已发布的版本重复。
- 验证记录（`.codex/verification/`）里缺少本次出包记录。
