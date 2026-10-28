# StoryForge 发版清单

更新时间：2026-10-28

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

```powershell
pnpm desktop:build
```

产物：`apps/desktop/src-tauri/target/release/bundle/nsis/StoryForge IDE_<版本>_x64-setup.exe`（另有 msi，装机走 NSIS）。记录大小与 SHA256。

## 5. 装机前验证

```powershell
node apps/desktop/scripts/verify-tauri-smoke.mjs --release      # 发行版 exe 冒烟：书库 → 总览 → 工作台 → 补丁审阅 → 写回
npm --prefix apps/desktop run verify:nsis-install                # 隔离身份静默安装 → 启动 → 卸载
```

改动涉及引擎与宿主之间的接口、模型出网或引擎库时，再跑真宿主探针（`apps/desktop/frontend` 下 `node scripts/verify-engine-p0-native.mjs --agent-only` 等，见 `local-start.md` 第 7 节）。探针要求本机没有在跑的 StoryForge，先问作者能不能关。

## 6. 交付

- 把安装包另存到 `output/release-<版本>/`（本地验证构建会覆盖 `bundle/nsis/` 里的同名文件）。
- 告诉作者：版本号、这一版带了哪些改动、装前是否需要备份（动了引擎库 schema 或旧库导入时，提醒备份 `%LOCALAPPDATA%\com.storyforge.ide\` 下的 `.sqlite3` 文件）。
- 在验证记录（`.codex/verification/`）里记一条：版本、大小、SHA256、跑过的门禁与冒烟、没跑的项。

## 7. 已知 caveat

- 安装包未签名、没有自动更新；熟人私测可接受，公开分发前要补签名与更新策略。
- 模型 key 用 Windows 用户级 DPAPI 加密存本机，是用户级保护而非分发硬化。
- NSIS 隔离安装验证只证明安装、启动、卸载，不包含升级验证；升级保留另取证。

## 8. 不得出包的情况

- `pnpm verify` 或 Rust 测试没跑，或失败但没记录原因。
- 发行版冒烟没跑。
- 版本号与已发布的版本重复。
- 验证记录（`.codex/verification/`）里缺少本次出包记录。
