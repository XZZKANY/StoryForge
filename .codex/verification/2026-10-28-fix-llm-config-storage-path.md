## 2026-10-28 模型配置原子保存错误诊断与可选目录覆盖

- 改动：从最新 master `1f6e55b8` 重放配置保存相关修复，未合入旧 Egg 分支的其他功能。原子替换失败附带系统错误；新增可选 `STORYFORGE_CONFIG_DIR`，未设置时仍调用原默认配置目录，空值/相对路径报错。smoke 隔离目录优先，缺少 smoke 目录时不回落到日常目录。保留 DPAPI 加密、原子写入和原配置保护，不自动搬迁配置或数据库。
- 验证：
  - Windows x64、Node.js 22.23.4、pnpm 9.15.4、Rust 1.99.1。
  - `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml llm_config_store`：13 passed，EXIT=0。覆盖密钥保护、旧配置迁移、目标锁定时保护原文件及暂存清理。
  - `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml runtime_paths`：5 passed，EXIT=0。覆盖默认成功/失败原样返回、绝对路径覆盖、空/相对路径拒绝、smoke 优先与缺失隔离目录拒绝回落。
  - 前端构建、`cargo build --locked --manifest-path apps/desktop/src-tauri/Cargo.toml` EXIT=0。
  - 设置日常覆盖值 `STORYFORGE_CONFIG_DIR=relative-invalid-smoke-probe` 后，运行 `npm --prefix apps/desktop run verify:tauri-smoke -- --executable <本分支 debug 可执行文件>`，EXIT=0；实际 Tauri/WebView2 使用独立临时配置和数据目录，输出 `Desktop Tauri installed smoke passed`。未访问日常模型配置、未用真实 key。
  - `pnpm verify`：EXIT=0，用时 187.6 秒；八道门禁和三个 Chromium 浏览器回归全部通过。根 lint 仅两条基线已有的 any warning，无错误；两组 numstat 一致，没有行尾噪音。
- 根因边界：先前用户现场用合成文件在 Roaming 目录复现同目录重命名错误 17，换普通目录成功；原目录具有 Encrypted 属性，但没有完成控制变量实验，不能断定 EFS 是原因。Windows 返回错误 17 的底层原因仍未确认。本 PR 提供明确诊断和可选规避，不宣称修复操作系统。
- 未覆盖：当前新分支未用用户真实配置重复保存、未调用真实模型、未打发行安装包；真实模型连接和迁移其他 Windows 用户/机器的密钥不作成功承诺。旧版本上的实际设置读写验证只作历史背景，不冒充当前分支的新验收。
