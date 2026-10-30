# StoryForge 故障手册

更新时间：2026-10-16

## 1. 使用原则

只记录当前仓库里出现过或由脚本显式处理的故障。排查时先保留原始命令和输出，再缩小范围，避免把环境限制误判为功能缺陷；属于环境限制的失败写进 `.codex/verification-report.md`，不能声称完整通过。

## 2. `pnpm verify` 某道门红

- 按日志里的 `[verify:local] <门名>` 找到失败的那道，单独复跑它的命令（日志里 `$` 开头那行）。
- 前端单测满载红、单跑绿时**不要直接判 flaky**：把改动临时挪开（`git stash`），在 master 上用同样的并发复跑；master 也红才是既有问题。内存紧时用 `npx vitest run --maxWorkers=3`。
- 改了引擎后前端类型检查红：前端经 `lib/engine` 直接编译引擎源码，引擎的导出或类型变了要同步改前端。

## 3. 浏览器回归红（`verify:inline-continuation` / `verify:smoke` / `verify:agent-conversation`）

- 三个回归在普通 Chromium 里跑真界面，走引擎的 `lib/api` 模块由 `apps/desktop/frontend/scripts/http-doubles-plugin.mjs` 换成 `tests/support/http-*-double.ts` 的 fetch 替身，页面里再由各脚本的假后端应答。
- 报 `Cannot read properties of undefined (reading 'invoke')`：有一个走引擎的 `lib/api` 模块没被替换，在浏览器里碰了 Tauri 原生端口。把它加进插件的 `DOUBLES` 并写对应替身。
- 报 `Unexpected browser smoke request: <路径>`：界面发出了假后端没预期的请求。先确认是产品行为变了（例如新功能多发了一次命令）还是回归脚本过期，再改假后端的放行条件。
- Vite 提示 `The above dynamic import cannot be analyzed by Vite`（Monaco 依赖块里）是已知的无害警告。

## 4. 真宿主探针（`verify-engine-p0-native.mjs`）起不来

- `Existing Native app: refuse to reuse or kill it`：本机有 StoryForge 在跑。探针按设计拒绝与已有原生应用并行、也不替你关它；关掉应用再跑。
- 提示锁被占用：`output/ts-engine-p0/native/active.lock` 是上一次探针留下的。确认没有探针在跑后删掉它。
- 探针要 `cargo build --locked --offline`：依赖没下载过时先在联网状态下 `cargo fetch`。

## 5. Tauri 冒烟失败

- 开发档要桌面 Vite 在 `3007` 上：脚本会自己起，若端口被别的进程占用会复用它；看日志里有没有 `Reusing existing desktop frontend`。
- debug exe 直接跑报「前端服务未运行」：debug 宿主要 `http://localhost:3007`，先 `npm --prefix apps/desktop/frontend run dev -- --host 127.0.0.1`，再用 `--executable` 指向 debug exe。
- 发行版冒烟报 `does not support isolated Tauri smoke`：exe 不是当前源码打的，先重新 `pnpm desktop:build`。

## 6. 模型调用失败

- 先在「设置 → 模型服务」点测试连接，看返回的状态码与原文。
- `llm-provider.json` 里的 key 用 Windows 用户级 DPAPI 加密：换了 Windows 用户或拷到别的机器后解不开，需要重新填 key。
- 走本机回环地址的 provider（如合成服务）要绕过系统代理：冒烟脚本会把 `127.0.0.1` / `localhost` / `::1` 加进 `NO_PROXY`。

## 7. 旧库导入

- 新引擎第一次打开时把 `%LOCALAPPDATA%\com.storyforge.ide\storyforge.sqlite3`（Python 时期的库）只读导入引擎库，要求引擎库为空；之后不再读它。
- 别删旧库，也别在导入前手动往引擎库里写东西。要重来时先备份两个库再处理。

## 8. 打包

- 正式包用 `node apps/desktop/scripts/release-build.mjs --notes <更新说明.md>`（带自动更新签名，见发版清单 §4）；只想本地验证用 `pnpm desktop:build`（直接 `tauri build`，约 4 分钟，NSIS 约 33 MB）。
- 出包脚本报「先在当前终端设私钥密码」：在同一个终端里设 `$env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD` 再跑；报「签名用的私钥与公钥对不上」：用的不是 `~/.storyforge-updater/` 里那把私钥，装机版会拒收这个包，别发布。
- 本地验证构建与已发布版本同名时会覆盖 `apps/desktop/src-tauri/target/release/bundle/nsis/` 里的发布安装包：出包后先把安装包另存到 `output/release-<版本>/`，验证构建产物挪走并标明不可安装。

## 9. Git 工作区

```powershell
git status --short --branch
git diff --numstat
git diff --ignore-all-space --numstat
```

- 仓库常驻本机脚手架与 `output/` 产物，提交只用显式路径。
- 两种 numstat 不一致说明改出了行尾噪音：按文件原有行尾（CRLF / LF 混用）重写；旧验证报告 `.codex/verification-report.md` 是混合行尾，已冻结；万一要改只做字节级操作。
