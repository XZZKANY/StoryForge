## 2026-10-28 验证记录改成每个分支一份，补 CONTRIBUTING.md 与 PR 模板，master 开分支保护

- 改动：
  - 验证记录从往 `.codex/verification-report.md` 末尾追加，改成每个分支一份 `.codex/verification/<开分支日期>-<分支名>.md`，多人并行开 PR 不再在同一个文件末尾冲突。旧文件开头前插两行冻结说明，其余字节不动；`.gitignore` 放行新目录。
  - 新增 `CONTRIBUTING.md`（跑起来、找活、分支与 PR、验证记录、常见坑、审查与发版、用 AI 写代码、许可）和 `.github/pull_request_template.md`。
  - 引用旧规则的现行文档改指新规则：`CLAUDE.md` §3 / §6，§9 加一条 master 受保护；`docs/internal/AGENTS.md`、`docs/internal/AI_ITERATION_GUIDE.md`、`docs/operations/README.md`、`docs/operations/release-checklist.md`、`docs/operations/troubleshooting.md`、`docs/internal/current-phase.md`、`docs/internal/PROJECT_SUMMARY.md`；`README.md` / `README.en.md` 的参与开发一节链到 CONTRIBUTING。`docs/archive/`、迁移计划和测试注释里指向旧报告的历史引用不动，那些记录仍在旧文件里。
  - master 分支保护（GitHub API `PUT branches/master/protection`）：合并要 1 位有写权限的人批准；`enforce_admins=false`，作者自己的 PR 用 `gh pr merge --admin` 合；禁 force push、禁删分支；没有 CI，暂不要求状态检查。
- 验证：
  - 已有文件全部用字节级替换改（每处断言命中恰好 1 次、CRLF 计数只按替换内容变化）。`git diff --numstat` 与 `git diff --ignore-all-space --numstat` 两组完全一致（12 个文件，无行尾噪音）。
  - 旧验证报告：新文件以 HEAD 原字节结尾（`endswith` 为真），只在开头多 154 字节。
  - 新文件 `CONTRIBUTING.md`、PR 模板、本记录均为纯 LF。
  - `git check-ignore` 对 `.codex/verification/` 下的文件、`.github/pull_request_template.md`、`CONTRIBUTING.md` 均不命中（退出码 1），能正常入库。
  - CONTRIBUTING 里链接和提到的路径逐个 `test -e`：都存在。第一次核对发现根 `AGENTS.md` 被 `.gitignore` 忽略、不在仓库里，已从 CONTRIBUTING 去掉这个链接。
  - 分支保护 API 回读：`reviews=1`、`enforce_admins=false`、`force_push=false`、`deletions=false`。
- 未覆盖：
  - 没跑 `pnpm verify`：本次只改 Markdown 与 `.gitignore`，不在 lint（只查 ts / tsx / mjs，且 `.prettierignore` 排除 `docs`、`.codex`）和任何测试的范围内。当时本机空闲内存约 0.6 GB，另一个会话在主工作区跑引擎改动。
  - PR 模板在 GitHub 上的实际带出效果，等下一个 PR 打开时才看得到。
  - 根 `CLAUDE.md` 开头写「根级协作约定见 `AGENTS.md`」，但根 `AGENTS.md` 不入库，协作者看不到；本次没改。
