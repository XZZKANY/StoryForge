# Issue tracker: GitHub

Issues and PRDs for this repo live as GitHub issues.

工具优先级：当前线程暴露了 GitHub MCP 时一律先用它（读 issue、列 issue、评论、改标签、关闭）；只有 MCP 未暴露或不可用时才退回 `gh` CLI。未经用户明确要求，不擅自对外发布新 issue 或 PR。

以下示例按 `gh` CLI 给出，MCP 不可用时直接采用：

## Conventions

- **Create an issue**: `gh issue create --title "..." --body "..."`. Use a heredoc for multi-line bodies.
- **Read an issue**: `gh issue view <number> --comments`, filtering comments by `jq` and also fetching labels.
- **List issues**: `gh issue list --state open --json number,title,body,labels,comments --jq '[.[] | {number, title, body, labels: [.labels[].name], comments: [.comments[].body]}]'` with appropriate `--label` and `--state` filters.
- **Comment on an issue**: `gh issue comment <number> --body "..."`
- **Apply / remove labels**: `gh issue edit <number> --add-label "..."` / `--remove-label "..."`
- **Close**: `gh issue close <number> --comment "..."`

Infer the repo from `git remote -v` -- `gh` does this automatically when run inside a clone.

## When a skill says "publish to the issue tracker"

Create a GitHub issue（先确认用户已授权对外发布）。

## When a skill says "fetch the relevant ticket"

Run `gh issue view <number> --comments`（或等价的 GitHub MCP 读取调用）。
