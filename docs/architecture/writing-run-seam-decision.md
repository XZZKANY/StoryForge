# Writing Run seam decision

生成时间：2026-06-24 +08:00

## 决策

StoryForge 的主产品语义统一为 Cursor for Fiction 的 `Writing Run / 写作任务`。

`Writing Run` 是作者发起写作工作的统一 run 概念：短篇、长篇、章节、场景、段落和修订都应该进入同一套语义。不同规模的任务由 `scope` 和 `mode` 区分：

- 小任务优先是 `mode=inline`，跟随当前 Agent 对话、diff 和写回确认流。
- 长任务优先是 `mode=managed`，进入可暂停、恢复、重试和追踪 checkpoint 的后台运行流。
- 当前 v1 只实现 `scope=full_book, mode=managed`。

`BookRun` 不再作为主产品概念扩张。它保留为 `scope=full_book, mode=managed` 的内部 legacy adapter，继续承载现有数据库模型、长程生成状态机、checkpoint、预算暂停、审计和导出能力。

## 背景

早期系统里 `BookRun` 同时承担了三个含义：

- 整书生成的数据库记录。
- 长程后台生成能力。
- 用户心智里的独立产品入口。

这会和 Cursor for Fiction 的 IDE 心智冲突。IDE 本来就应该能输出短篇、长篇、章节和修订，不应该因为“长篇”额外暴露一个和 Agent/IDE 并列的后台产品。更接近 Claude Code、Codex、OpenCode 的形态是：用户面对统一的 Agent / Run 控制面，具体长短任务只是不同 scope 和 mode。

因此当前重构不继续按 `BookRun` 自身拆 lifecycle/progress/dispatch，而是先建立统一 `Writing Run` seam，让外部控制面逐步只认识 `Writing Run`。

## 代码约定

新 seam 位于：

```text
apps/api/app/domains/writing_runs/
```

当前接口约定：

- `WritingRunScope` 预留 `paragraph / scene / chapter / short_story / volume / full_book / revision`。
- `WritingRunMode` 预留 `inline / managed`。
- `WritingRunStart` 是 canonical start request。
- `WritingRunHandle` 是 canonical handle。
- v1 只支持 `scope="full_book"` 且 `mode="managed"`。
- `writing_run_id` 在 v1 等于底层 `book_run_id`。

兼容约定：

- `bookrun.*` intent 继续存在，但只作为 legacy command id。
- `/api/book-runs/*` 继续存在。
- `BookRun` ORM、schemas、exports、workflow dispatch 继续存在。
- API payload 同时返回 canonical 字段 `writing_run / writing_run_id` 和兼容字段 `book_run / book_run_id`。
- 前端和 Agent Runtime 应优先读 `writing_run_id`，再 fallback 到 `book_run_id`。

## 后续迁移顺序

1. Agent / IDE 控制面优先通过 `writing_runs.service` 调用长程写作任务。
2. 前端 UI 只展示“Writing Run / 写作任务”，不暴露 BookRun 作为产品入口。
3. 为 `writing_runs` seam 建直接测试，避免只能通过 IDE 命令间接覆盖。
4. seam 稳定后，再考虑瘦身 `book_runs/service.py` 的内部实现。

## 暂不做

- 不新增 `/api/writing-runs` 公共 REST 路由。
- 不做数据库迁移。
- 不重命名 `BookRun` ORM、表名、导出路径或历史事件。
- 不删除 `/api/book-runs/*`。
- 不机械拆分 `book_runs/service.py`，直到 `Writing Run` seam 稳定。

## 迁移护栏

- 不新增 BookRun 页面，也不把 BookRun 控制台重新定义成主产品入口。
- 不在前端产品层新增 `BookRun*` 命名；用户可见和 Desktop 私有投影都使用 Writing Run / 写作任务。
- 不让新 Agent / IDE 调用点直接调用 `book_runs.service` 的 lifecycle 函数；应通过 `writing_runs.service`。
- 不新增 `/api/writing-runs`，直到至少出现第二个真实 adapter，或 inline run 引擎真正落地。
- 不迁表，直到外部 API、Agent payload 和前端状态不再需要 `book_run_id` 兼容字段。
- 不把预留的 `mode="inline"` 当作已实现能力；v1 只声明 full-book managed adapter。

## 后果

好处：

- 产品语言回到 Cursor for Fiction：作者看到的是统一写作任务，而不是另一个后台系统。
- 代码调用面更窄：Agent / IDE 可以只依赖 `Writing Run` seam。
- 兼容成本低：现有 BookRun 数据、路由、测试和导出链路不需要迁移。

代价：

- v1 会同时存在 `writing_run_id` 与 `book_run_id`。
- `BookRun` 名称仍会留在内部实现、历史 API 和数据库中。
- inline run 暂时只是类型预留，不能宣称已完成短任务 run 引擎。
