# 参与 StoryForge 开发

StoryForge 是写长篇小说用的桌面 IDE（Tauri 2 + React + Monaco，业务逻辑在 TS 引擎 `packages/engine` 里）。这份文档讲怎么把改动交进来。产品方向和取舍由作者 [@XZZKANY](https://github.com/XZZKANY) 拍板。

## 1. 跑起来

需要 Node.js 22、pnpm 9.15.4、Rust 工具链，以及 Tauri 2 的 Windows 构建依赖。

```powershell
git clone https://github.com/XZZKANY/StoryForge.git
cd StoryForge
pnpm install
npm --prefix apps/desktop/frontend install
pnpm hooks:install     # 启用 pre-push 门禁
pnpm dev               # 启动桌面应用
```

- `apps/desktop/frontend` 是独立的 npm 工程，要单独装依赖。
- Windows PowerShell 若拦截 `pnpm.ps1`，改用 `pnpm.cmd`。
- 开发和跑测试不需要模型 key：单测和浏览器回归用的都是替身。只有真宿主探针的 `--agent-real` / `--assistant-real` 会用你自己的模型配置，会花钱。
- 环境问题先看 [本地开发](docs/operations/local-start.md) 和 [故障排查](docs/operations/troubleshooting.md)。

## 2. 找活

- 从 [Issues](https://github.com/XZZKANY/StoryForge/issues) 里挑，标了 `help wanted` 或 `good first issue` 的最适合上手。动手前在 issue 下说一声，免得两个人做同一件事。
- 想做 issue 里没有的事，先开 issue 说清楚改什么、为什么，等作者回复再动手。新功能、改交互、改数据形状这类方向性改动尤其要先聊。
- 当前优先级见 [`docs/internal/TODO.md`](docs/internal/TODO.md)。

## 3. 分支与 PR

- `master` 受保护：不能直接推，所有改动开分支、走 PR，合并前要一位有写权限的人批准。
- 从最新的 `master` 开分支，名字用英文短横线：`fix/…`、`feat/…`、`docs/…`、`refactor/…`。
- 一个 PR 只解决一件事，不顺手重构无关代码。
- 提交信息用简体中文，前缀沿用现有历史，比如 `fix: 修订 / 起草吐到一半断开时自动重发`；代码标识符保留英文。
- 提交只用显式路径（`git add <路径>`），不要 `git add -A` 或 `git add .`：仓库里常驻本机脚手架和 `output/` 产物，一把加进去会误提交。
- PR 描述按模板填（开 PR 时会自动带出来）。

## 4. 验证与验证记录

**门禁。** 提交前跑 `pnpm verify`（8 道门，说明见 [运维文档索引](docs/operations/README.md) §3），要 EXIT=0。改了 Rust 宿主、或引擎与宿主之间的接口，再跑 Rust 测试和 Tauri 冒烟（命令见 [`CLAUDE.md`](CLAUDE.md) §4）。目标为 `master` 的 PR 和推送到 `master` 会触发 GitHub Actions `Windows Verify`，在 Windows / Node.js 22 / pnpm 9.15.4 上执行 `pnpm verify`。远端检查不含 Rust 测试和 Tauri 冒烟，PR 里仍需如实写明本地跑了什么、没跑什么；必过检查由维护者在分支保护中配置。

**验证记录。** 每个分支一份，和代码一起提交：

- 位置：`.codex/verification/<开分支日期>-<分支名>.md`，分支名里的 `/` 换成 `-`。例：10 月 28 日开的分支 `fix/revise-stream-break-retry` 对应 `.codex/verification/2026-10-28-fix-revise-stream-break-retry.md`。
- 同一分支后面补了验证，接着写在同一份里；不改别的分支的记录。
- PR 描述里写上这份记录的路径。
- 内容写三块：

```markdown
## 2026-10-28 一句话说明改了什么

- 改动：解决什么问题、怎么解决，一两句。
- 验证：
  - 跑了什么命令、结果（通过多少条、EXIT=0）。
  - 做了变异验证就写打在哪、红了几条、怎么还原的。
- 未覆盖：没跑的门、没在真宿主或真模型上验的部分。
```

为什么每个分支单独一份：多人同时开 PR，都往同一个文件末尾追加，合并时必然冲突。`.codex/verification-report.md` 是 2026-10-28 之前的记录，已冻结，不再追加。

证据里不能出现真实 API key、作者的正文和未脱敏的运行日志，只用占位符。

## 5. 容易踩的坑

- **行尾。** 仓库里 CRLF 和 LF 混用（比如 `CLAUDE.md` 是 CRLF，多数源码是 LF，个别文件两种都有）。按文件原有行尾改；有的编辑器保存时会把整个文件的行尾换掉。提交前对照下面两组数字，不一致就是改出了行尾噪音：

  ```bash
  git diff --numstat
  git diff --ignore-all-space --numstat
  ```

- **界面不直接引引擎。** 界面只经 `apps/desktop/frontend/src/lib/api` 进引擎，`tests/source-standards.test.ts` 会拦。
- **改引擎要连前端类型检查一起跑**：前端直接编译引擎源码。
- **契约是冻结的。** 流帧 schema（`packages/engine/golden/agent-ws.schema.json`）和 `apps/desktop/frontend/src/lib/api/contracts.ts` 里的数据形状，改了就是改契约，引擎和界面一起改，PR 里写明。
- **引擎库 schema 只追加迁移**（`packages/engine/src/store/schema.ts`），不改已发布的条目。
- **浏览器回归不经过真宿主**，用的是 fetch 替身；改了引擎与宿主之间的接口，要跑真宿主探针或 Tauri 冒烟。
- **模型 key 只在 Rust 宿主里。** WebView、引擎库、日志、证据里只能出现占位符。

## 6. 审查、合并与发版

- 作者审 PR，方向性的取舍以作者意见为准。
- 出安装包只由作者做（见 [发版清单](docs/operations/release-checklist.md)），PR 里不要改版本号。

## 7. 用 AI 写代码

[`CLAUDE.md`](CLAUDE.md) 是给 AI 编码助手的上下文，用 Claude Code 这类工具时会被自动读到。人也可以读，但 `CLAUDE.md` §1.1 是历史流水，不代表现状；现状看 §8 和 [`docs/internal/current-phase.md`](docs/internal/current-phase.md)。AI 写的代码同样要过上面的门禁、写验证记录。

## 8. 许可

本项目以 [MIT 协议](LICENSE) 发布。提交 PR 即表示你同意以同一协议授权你的贡献。
