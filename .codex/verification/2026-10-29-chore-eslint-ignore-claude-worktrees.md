## 2026-10-29 ESLint 忽略 `.claude/`（桌面版建在仓库里的 worktree）

- 原因：Claude 桌面版从任务卡片开的会话把 worktree 建在仓库里的 `.claude/worktrees/<名字>/`（已在 `.git/info/exclude` 里，不进 git），但 `eslint .` 会扫进去，每个 worktree 各有一份 tsconfig，typescript-eslint 报「multiple candidate TSConfigRootDirs」，一次 2564 个解析错，pre-push 的 `pnpm run lint` 全挡。忽略清单里已有 `**/.worktrees/`、`.trellis/`、`.agents/`，补上 `.claude/`。
- 改动：`eslint.config.mjs` 的 `ignores` 加一行 `'.claude/'`（文件原为全 CRLF，保持）。
- 验证：
  - 改前：`.claude/worktrees/` 下有两个 worktree 时，`git push` 触发的 `pnpm run lint` 报 2564 errors（`Parsing error: No tsconfigRootDir was set, and multiple candidate TSConfigRootDirs are present`）。
  - 改后：同样两个 worktree 在场，`pnpm lint` EXIT=0，Prettier 检查通过。
- 未覆盖：只动 lint 范围，不影响任何产品代码与测试。
