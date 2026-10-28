## 2026-10-28 移除产品未使用的 Tauri HTTP / SQL 插件

- 改动：从最新 master `1f6e55b8` 开分支，仅删除 `tauri-plugin-http` / `tauri-plugin-sql` 的两条 Cargo 依赖和两处注册；Cargo 更新锁文件，Tauri 重建已跟踪的 ACL/schema；删去 TODO 10-16 入口第 4 项中已完成的插件清理事项。
- 验证：
  - Windows x64、Node.js 22.23.4、pnpm 9.15.4、Rust 1.99.1。
  - `npm --prefix apps/desktop/frontend run build` EXIT=0；首次直接跑 Rust 测试因新检出目录缺少 `frontend/dist` 失败，先构建前端后重新执行通过。
  - `npm --prefix apps/desktop run test:rust`：139 passed / 1 ignored，EXIT=0。
  - `cargo build --locked --manifest-path apps/desktop/src-tauri/Cargo.toml` EXIT=0。
  - `npm --prefix apps/desktop run verify:tauri-smoke -- --executable <本分支 debug 可执行文件>` EXIT=0。实际 Tauri/WebView2 窗口使用内嵌本分支前端和独立临时数据，输出 `Desktop Tauri installed smoke passed`；覆盖原生写回、缓冲漂移保护、回执恢复与缓存补记，没有借用用户正在运行的 Vite 前端。
  - TOML 解析比较锁文件：544 个包保留，78 个移除，新增/升级 0；`cargo tree -p sqlx --depth 0` 确认为 `sqlx v0.8.6`。锁文件大幅缩小来自删除传递依赖，没有升级其他包。
  - 全仓检索四种插件名称，除允许保留的迁移计划、归档和验证记录外无引用。自动生成的 ACL、desktop/windows schema 一并移除对应插件描述。
  - `pnpm verify`：EXIT=0，用时 187.2 秒；八道门禁和三个 Chromium 浏览器回归均通过。根 lint 只有两条基线已有的 any warning，无错误。两组 numstat 一致，没有行尾噪音。
- 未覆盖：未制作发行安装包、未测量安装包体积，不调用真实模型。测试中的稿件和失败注入均为隔离合成数据。
