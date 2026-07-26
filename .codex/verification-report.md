# 验证报告 · 小说编辑器观感三刀（排版 / 稿件感 / 少打断）

时间：2026-07-26
分支：`feat/prose-typography-polish`（PR #196）、`feat/manuscript-progress-card`（PR #197）、`feat/save-flow-less-interruption`（PR #198），均已合并 master

> **提名口径说明**：本波不是真实写作摩擦提名，是作者在 2026-07-26「写作优先」拍板**当日明知冲突仍要求开的主动打磨波**。
> 如实记一笔，不冒充宪法 §08 的每周一刀。

## 刀 1 · 正文排版按小说稿收口（PR #196）

修三处「Monaco 默认值直接拿来写小说」：

- **正文无行长限制**（1920 屏一行拉到 1252px）→ 按档位限宽并居中（窄 32 / 适中 42 / 宽 56 中文字 / 不限），
  只作用于 Markdown，`canon.json` 等数据文件仍铺满；新设置项 `editorProseMeasure`，默认「适中」。
- **「散文模式」不是书感**——该轨是无衬线黑体，真衬线栈 `--font-prose` 定义在 index.css 却全仓零引用（死代码）
  → 换成真衬线/楷体栈并更名「书稿」，删掉误导性死 token 与 tailwind `font-prose`。
- **代码编辑器默认行为原样作用在正文**（折叠 / 括号配对 / 词联想 / 缩进参考线 / 当前行方框）→ 正文侧一律关，数据文件保留。
- 补齐从未设置的 `lineHeight`（CJK 1.9×）、`padding`、书稿轨字距、smoothScrolling、平滑光标。
- 排版 options 收敛成纯函数 `editorTypographyOptions()`，create 与 updateOptions 共用一份。
- 顺带重接 `useAppPreferences.toggleFontMode`（状态栏开关移除后零调用方，而设置描述仍写「状态栏可快捷切换」）
  → 改接命令面板两条命令并订正文案。

## 刀 2 · 稿件卡（PR #197）

状态栏字数改按钮，点开三段进度：本章（字/段/选中）、今日（已存净增量 + 日更目标进度条）、全书（章数/总字数）。

三个刻意的口径决定：

- 今日 = **已落盘净增量**（写回成功后累加），不扫全书求差 → 跨重启不把昨天存量算成今天产出；未保存草稿不计入，文案如实写明。
- 删稿负增量**如实相减不夹 0**（夹了就把「今天净删 2000 字」显示成 0）。
- 全书总字数**逐个读盘数字，不用 `FileEntry.size` 估算**（UTF-8 一个汉字 3 字节，按字节推会虚高约 3 倍）；读失败文件单独计数报出。

顺带收口 `author-loop.ts` 私有的 `countCjkChars` / `countParagraphs` 与 `text-metrics.ts` 的重复实现，
三者同住 `text-metrics.ts` 并注明「严格汉字口径」与「网文口径」本就不该相等。

## 刀 3 · 少打断的保存流（PR #198）

- **Ctrl+S 此前只在编辑器聚焦时生效**（只是 Monaco 内部命令，全局 keydown 无 `s` 分支）→ App.tsx 全局挂一条走 `flushActiveEditorToDisk`。
- **关闭脏页签只有「放弃 / 继续编辑」** → 补「保存并关闭」三选一（AppDialog 新增 `choice` 类型）。
  出现条件刻意收窄为「唯一脏文件恰好是当前显示文件」：保存走 `REQUEST_SAVE_ACTIVE_FILE`，
  编辑器对非激活文件回 `skipped` 直接放行，那种情况下给保存按钮 = 静默丢稿。保存失败则取消关闭。

## 验证

```bash
pnpm verify        # PASS（lint + typecheck + 各栈测试 + sidecar-smoke daily 档 + OpenAPI 零漂移）
```

- 前端 vitest：306（刀 1）→ 322（刀 2）→ **330 passed / 58 files**（刀 3）
- 新增可证伪用例：行宽换算与不限档、CJK 行距、正文/数据文件 option 分流、字距只加书稿轨、档位顺序与文案派生；
  日更账本跨天归零 / 负增量 / 项目隔离 / 坏存档兜底 / 本地时区日期键；全书统计非正文不计 + 读失败如实报数；
  稿件卡开卡 / 无目标不画条 / 超额封顶；关闭脏页签五条分支 + Ctrl+S 全局分支指纹；choice 弹窗渲染与 Esc
- sidecar 冒烟绿、OpenAPI 零漂移（本波纯前端，后端零改动）

## 未联通 / 未验

- **真机观感全部未验，归 E2E-1**：衬线字体本机未装时的回退表现、限宽后行间对话 view zone 与补丁面板观感、
  稿件卡在 26px 状态栏上方的定位与遮挡、装机 exe 下 Ctrl+S 在各焦点位置的实际行为、三选一弹窗观感。
- **段首缩进本波不做**：Monaco 无法在不打乱光标水平定位的前提下做 per-paragraph text-indent，属实现不了而非漏做。
- **autosave 默认值仍关**：翻开会让每次自动保存都触发 `snapshotBeforeWrite`，而每文件只留 20 份快照，
  几分钟写作就冲干净版本历史；要先改快照节流策略。
- **全书统计是同步串行读盘**，几百章规模有可感延迟，当前只在打开卡片时跑一次，未做缓存或并发。
- Ctrl+S 那条是源码指纹护栏而非渲染断言（真渲染 App 需整套 Tauri / sidecar 桩）。

---

# 验证报告 · UI/UX 审计 Ctrl+K 行间 diff 句内高亮（E22）

时间：2026-07-24
分支：`feat/uiux-inline-char-diff-20260724`

审计「编辑器与改稿反馈」主题里最后一条（P3-L）：Ctrl+K 行间 diff 只做整行红/绿，改一个词也整行标记。

## 变更（全前端）

- **E22 单行替换的句内高亮**：
  - `lib/inline-chat.ts` 加纯函数 `intraLineChangeRange(oldLine, newLine)`——掐掉公共前缀/后缀，只留真正改动的中段（1-based 列、endCol 独占，纯插入/删除时该侧零宽）；
  - `useInlineChat.renderDiff`：对**单行替换**（一旧行→一新行）的 hunk，在整行淡红底之上叠一层句内红高亮 `sf-inline-diff-old-seg`（Monaco 字符级 decoration）；
  - `buildDiffZoneDom`：绿新行把改动中段包成 `sf-inline-diff-new-seg` span、前后逐字保留；
  - `index.css` 加两个 seg 高亮类；多行 hunk / 纯增删 graceful 回退整行铺色（不做句内高亮）。
  - 有界实现：不改 hunk→行级 diff 管线（`hunksToLineDiff` 的整行塌陷/去重不动），句内区间在 renderDiff 就地按旧/新行文本算，
    避免重构核心 Ctrl+K 流的高风险。

## 验证

```bash
npm --prefix apps/desktop/frontend run typecheck   # PASS
npm --prefix apps/desktop/frontend run test        # 52 files / 275 passed（+1 新：intraLineChangeRange 纯函数，含中文改词 / 纯插入 / 全改）
npm --prefix apps/desktop/frontend run build       # 构建成功
npx eslint <3 touched>                             # 0 problems
npx prettier --check <touched incl. index.css>     # 通过
```

句内高亮渲染是 Monaco decoration + view-zone DOM，SSR 测不到；纯区间函数已单测，真机观感归 E2E-1 未验。

---

至此 2026-07-24 UI/UX 审计 80 条已全部逐桶 branch→PR→merge 收口（PR #159-176）。

---

# 全项目 Code Review 验证记录

时间：2026-07-25
分支：`master`（审查开始时与 `origin/master` 对齐，工作树干净）

## 覆盖范围

- Desktop frontend / Tauri：多标签编辑、自动保存、补丁确认、版本快照、项目路径和 Rust 文件系统边界。
- API：认证/限流/脱敏、Agent runtime 工具与项目文件边界、SQLite/Alembic 启动收口、OpenAPI 契约。
- Workflow：provider adapter/fallback，runtime/checkpoint，BookLoop 降级门禁与测试覆盖。
- Shared / project-core / scripts / delivery：路径契约、生成类型、sidecar/E2E 脚本、Docker 与本地 hook。

## 已确认问题

1. `useSuggestionWriteback.ts:112-148`：接受建议的异步写回完成后，未校验当前文件/model 仍是发起写回的目标，直接对 `editorRef.current` 调用 `setValue`。写回期间切标签可把 A 文件内容灌入 B 文件缓冲，随后自动保存可进一步落盘。
2. `fs_tools.py:50-67`：`fs.list/fs.search` 枚举后直接 stat/read，未像 `fs.read` 那样对每个结果 `resolve()` 后重做 containment。支持 symlink 的平台上，项目内指向外部文件的链接可被搜索/摘录。
3. `fs_tools.py:50-57`：所谓跳过 `.git/node_modules` 是 `rglob("*")` 完整遍历后才过滤，且先构造全量 list；`max_entries/_SEARCH_MAX_FILES` 无法限制枚举成本。大仓库会在 Agent `fs.list/fs.search` 进入工具限制前就长时间阻塞与占用内存。
4. `provider_fallback.py:45-60`：文档约定只对可重试错误降级，实际捕获所有 `ProviderError`；401/403 `AUTH`、`CONTENT_FILTER` 和上下文超限也会转备用 provider。这会遮蔽配置错误，并可绕过主 provider 的内容策略拒绝。
5. `main.py:153-156,223-234`：生产 Redis 限流键直接嵌入完整 `X-StoryForge-API-Key`。最小复现的 `limits` 存储键为 `LIMITER/rate/super-secret-key/1/1/minute`，使服务密钥进入 Redis keyspace。
6. `Editor.tsx:219-247` + `useMonacoEditor.ts:147-159`：自动保存与 Ctrl+S 都可并发调用无串行化的 `saveCurrentFile`。两次写入若完成乱序，旧内容可在新内容之后落盘；现有 model 身份守卫只保护 UI 结算，不防止写盘乱序。
7. `author_chat.py:205-213`：终端 MVP 在用户确认时未比对盘上内容与 patch `before`，且用非原子 `Path.write_text`覆盖；等待确认时的外部修改会被静默丢失。

## 验证

```text
pnpm.cmd verify                                      PASS
  Desktop frontend                                  52 files / 275 passed
  API pytest                                         1076 passed / 3 skipped
  Workflow pytest                                    323 passed
  lint / typecheck / ruff / shared / project-core   PASS
  daily sidecar / OpenAPI drift                     PASS
pnpm.cmd e2e                                         20/20 PASS
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml
                                                       20/20 PASS
pnpm.cmd audit --prod --audit-level=high             No known vulnerabilities
```

## 未验证项

- 未执行真实 provider 出网、真机 GUI 竞态操作或 packaged sidecar smoke；本次不用模拟/契约结果替代这些证据。
- Windows 当前账户无创建 symlink 特权，本机无法运行 symlink 越界动态复现；结论来自可达代码路径与跨平台 `Path` 语义，需在 Linux/macOS 补回归测试。

---

# 三条安全红线修复 + 事实源刷新

时间：2026-07-26
分支：`fix/redline-secret-key-writeback-save`（自 `master` 4c80a232）

## 背景

对 07-12 至 07-25 两周工作做代码盘点后拍板「写作优先」：编辑器不再开主动打磨波，功能提名权交回真实写作摩擦（宪法 §08）。开写前先清掉上一节 7 条 confirmed 里踩安全红线的 3 条，其余登记不修。

## 修了什么

1. **明文 API Key 进限流 keyspace**（上节第 5 条）。`app/main.py` 抽出纯函数 `_rate_limit_bucket(api_key, client_host)`：有凭据时返回 `key:<sha256>`，否则 `addr:<host>`（缺失回退 `addr:unknown`）。`_rate_limit_key(request)` 改为调它。保持「同 key 同桶 / 不同 key 分桶」的分层限流语义，凭据不再离开请求头。
2. **补丁写回结算错对象**（上节第 1 条）。`lib/writeback.ts` 新增纯函数 `shouldSettleActiveEditor(targetPath, targetModel, activePath, activeModel)`；`useSuggestionWriteback` 落盘后改为：目标文件缓冲**永远**同步（`originalContent` + 必要时 `model.setValue`），活动编辑器 UI 态（`originalContentRef` / clean 版本 id / 预览 / 脏标）只在目标仍是前台 model 时才动。旧代码在 `await` 之后无条件 `editorRef.current?.setValue(nextContent)`，写回期间切页签会把 A 文件内容灌进 B 缓冲，随后 autosave 落盘。顺带修掉「接受补丁后 `cache.originalContent` 未更新 → 切走再切回误报脏」。为此 `Editor.tsx` 向该 hook 传入 `modelCacheRef`。
3. **autosave 与 Ctrl+S 并发写盘乱序**（上节第 6 条）。`lib/writeback.ts` 新增 `createWritebackQueue()`（前一任务无论成败都放行下一个，失败仍向上抛给调用方以保留 Agent 预读握手的阻断能力）；`Editor.tsx` 的 `saveCurrentFile` 整体串进该队列，内容在任务真正执行时才取，落盘的总是最新稿。原先两次写盘并发完成时旧内容可覆盖新内容，既有 model 身份守卫只保护 UI 结算、不防写盘乱序。

## 可证伪回归测试

- `apps/api/tests/test_api_middleware.py::test_rate_limit_bucket_never_contains_plaintext_api_key`：断言桶标识不含明文、同 key 同桶、不同 key 分桶、无凭据回退 `addr:` 命名空间。旧实现直接返回明文，此测试必红。
- 同文件 `test_rate_limit_returns_429_when_exceeded` 改为经 `_rate_limit_bucket` 预热桶，不再复写哈希公式。
- `tests/behavior/writeback-guard.vitest.ts` 新增红线③（4 例）与红线④（3 例）：切页签 / model 重建 / 目标缓冲被回收时拒绝结算；写盘不重叠（`maxInFlight === 1`）且落盘顺序 = 调用顺序；一次失败不堵死队列；失败向上抛。

## 事实源刷新

`docs/internal/current-phase.md` 与 `docs/internal/TODO.md` 原停在 2026-07-11、不覆盖其后两周。本次按代码盘点新增/重写：07-12 至 07-25 已合并内容；live 面实际尺度（22 router 挂载 / 桌面只调 4 组、11 IDE 命令只调 2 条、23 工具 spec 中 16 条对 LLM 可见、固定 intent 5 条只 1 条有入口、managed BookRun 三重不可达、左栏实际 2 视图）；canon 链全确定性零 token；canon 写回闭环两端断开；宪法 §06 八个写作时刻服务现状（06/07/08 为零，06 唯一实现已于 07-23 迁出独立仓）；三条红线修复结论；未修债务登记；写作优先拍板与 §08 提名口径。

## 验证

```text
pnpm.cmd verify                                      PASS（全绿，含 daily sidecar 与 OpenAPI 零漂移）
  API pytest                                         1089 passed / 3 skipped
  Desktop frontend vitest                            55 files / 299 passed
  lint（eslint + prettier）/ typecheck / ruff        PASS
pnpm.cmd e2e                                         20/20 PASS
uv run pytest tests/test_api_middleware.py -q         19 passed
```

`pnpm verify` 首跑红在 `test_book_generation_parallel.py::test_book_generation_parallel_runner_prefetches_then_revises_before_commit`（`sqlalchemy.exc.InvalidRequestError: Could not refresh instance '<Scene>'`）。该用例已于 2026-07-25 标注 `@pytest.mark.timing_sensitive`（线程屏障 timeout + utilization 阈值，记录协议为「CI 偶发红先重跑再判定」）；单跑该文件 12/12 绿、API 全量重跑 1089 绿、`pnpm verify` 重跑全绿，据协议判定为已知计时敏感 flaky，非本次回归。本次改动未触及 `book_generation_parallel`（该模块 `app/` 内零 import，仅测试调用）。

## 未验证项

- 三条修复的真机 GUI 复验未做：写回期间切页签不串写、autosave 与 Ctrl+S 并发不回退，归 E2E-1。
- 限流键改动只在本地 MemoryStorage 下验证，未在真 Redis 部署上复验 keyspace 实际形状。
- 未执行真实 provider 出网与 packaged sidecar smoke。
- 上一节 7 条 confirmed 中 4 条按拍板登记不修：`fs_tools.py` 枚举结果未重做 containment + `rglob` 无成本上限；`provider_fallback.py` 对全部 `ProviderError` 降级（非 live 路径）；`app/author_chat.py` 终端 MVP 非原子写且不比对 before（零 importer 独立脚本）。已写入 `docs/internal/TODO.md` 与 `current-phase.md`。

---

# apps/workflow 整包退役

时间：2026-07-26
分支：`chore/retire-apps-workflow`（自 `master` 96a3d928）

## 为什么现在能删（旧「删不动」结论已作废）

迁移 ledger 与多份内部文档记录的阻塞是「`book_generation_parallel.py` 用 importlib 加载 workflow 跑 managed 整书，受质量轨红线保护」。逐引用实证否决了这条：

- `run_book_generation_parallel` / `run_book_loop_with_thread_sessions` 在 `app/` 内**零 import**，调用方只有 `tests/test_book_generation_parallel.py`、`tests/test_book_generation_parallel_wrapper.py` 和 `.codex/run-real-llm-parallel.py` → 不在 live 路径上。
- 另一座桥 `runtime_tools/service.py` 虽在 live 挂载（`GET /api/runtime-tools`），但它加载的 `tools/registry.py` 是**零 workflow 依赖的纯 stdlib 文件，内容全是 apps/api 自身端点的静态描述**（retrieval / scene_packets / judge / repair / artifacts / evaluations / provider_gateway）→ 该搬不该删。
- managed BookRun 启动此前已三重不可达（无 `loop_schema`、前端不发 `book_id`+`blueprint_id`、IDE 命令零前端调用）。

## 做了什么

1. `git mv apps/workflow/storyforge_workflow/tools/registry.py` → `apps/api/app/domains/runtime_tools/creative_registry.py`；`runtime_tools/service.py` 改直接 import，删掉 importlib 机器（`spec_from_file_location` / `sys.modules` 注入 / `lru_cache`）与「文件缺失降级空列表 + 告警」兜底（进程内模块随 `collect_submodules('app')` 进冻结 exe，兜底不再有意义）。**`/api/runtime-tools` 响应与 OpenAPI 零变更。**
2. `git rm -r apps/workflow`（18.7k 行）。磁盘上仅余 gitignored 的 `.pytest-tmp` 空目录——它的 ACL 拒绝当前账户访问（`takeown`/`icacls` 均 Access denied，疑为某 workflow 测试造的权限错误用例残留），需管理员权限清理，与仓库/门禁无关。
3. 同批删除已成死码的：`book_runs/book_generation_parallel.py`、`tests/test_book_generation_parallel.py`（12 例）、`tests/test_book_generation_parallel_wrapper.py`（2 例）、`.codex/run-real-llm-parallel.py`（唯一 import 是已删 runner）。
4. 断言重指而非删除：`tests/e2e/phase4-contract.spec.ts` 的 registry 交叉校验从「按路径 importlib 相邻 workflow 文件」改为直接 import 进程内模块，交叉校验语义不变；`tests/test_runtime_tools.py` 的 `+9` magic number 改为从 `list_creative_tools()` + MCP 常量派生（registry 增删工具时断言随之移动而非误红）；`tests/test_source_pruning.py` 删掉对 workflow 侧 `model_run_sink.py` / `checkpoints.py` 两个文件内容的断言（被断言文件已不存在），API 侧读写链路断言原样保留。
5. 基线同步：`tests/fixtures/source_code_standards_baseline.json` 的 `line_limits` 与 `test_source_code_standards.py` 的硬上限表各摘除 `book_generation_parallel.py` 条目（否则 `Frozen source baseline path disappeared` 必红）。
6. 构建/部署面清理：`package.json` 删 `test:workflow` 及 `test` 链引用；`scripts/verify-local.mjs` 删「Workflow 单元测试 / Workflow Ruff 检查」两步；`docker-compose.yml` 删 `workflow` service + `storyforge-workflow-runtime` volume，`docker-compose.prod.yml` 删同名 service；`.env.example` 删 3 个 `WORKFLOW_*` 变量；`.gitignore` / `.prettierignore` / `.dockerignore` / `eslint.config.mjs` 各删 1 条 workflow 路径。
7. 文档：`CLAUDE.md`（§3 布局、§4 命令 ×3、§5 新增退役条目）、`CONTEXT.md`、`docs/architecture/ide-first-product-direction.md`、`DOMAINS.md`、`current-phase.md`、`TODO.md`；迁移 ledger 顶部改为**打捞索引**（列出只剩 git 历史的能力 + `git show <删除提交>^:<路径>` 打捞命令，并标注原文里「删不动 / 三重阻塞」判断已作废）。

## 代价（登记）

`extract/{prompt,parser,facts}`（canon 抽取 slice，补 canon「只校验声明不从正文抽取」的缺口）、`beat_sheet`、`name_registry`、`repetition_ledger`、`timeline_ledger`、`arc_consistency`，及地基 `narrative/verdict.py` / `plan.py` —— **只剩 git 历史一份**。已搬进 agent 的 4 个（`project.prose_check` / `collapse_check` / `entity_budget_check` / `promise_check`）不受影响。managed BookRun 的并发整书路径退场，只余串行 `book_generation`。

## 验证

```text
pnpm.cmd verify                          PASS（全绿；门禁不再跑 workflow 的 323 测试与 ruff）
  API pytest                             1075 passed / 3 skipped
    （= 前基线 1089 − 14，恰为删除的 12 + 2 个用例，无附带损失）
  Desktop frontend vitest                55 files / 299 passed
  lint（eslint + prettier）/ typecheck / ruff   PASS
  daily sidecar / OpenAPI 漂移           PASS（零漂移，契约未变）
pnpm.cmd e2e                             20/20 PASS（含改写后的 phase4 registry 交叉校验）
```

## 未验证项

- packaged 冻结 exe smoke 未跑：`creative_registry.py` 在 `app.domains.*` 下，理应随 `collect_submodules('app')` 进 exe，但本次未实测；`/api/runtime-tools` 在装机形态下的返回未复验。
- docker 栈未起：`docker-compose` 两档删掉 workflow service 后未做 `up` 复验（本机开发走 sidecar，不经 compose）。
- 真机 GUI 无关（本刀不碰桌面代码）。

# 正文排版回退居中：行长改走 Monaco bounded 换行

## 背景

上一刀（PR #196）给正文加行长控制时，实现是「把 Monaco 容器 `max-width` 限住 + flex 居中」。
真机写作反馈：**很别扭**。原因是限宽居中动的是编辑器本身而不是文字——
文字缩成屏幕中间一栏，两侧是点不动的死区（点了不进编辑器）、竖滚动条浮在屏幕中间，
且与 2026-07-05 壳子定稿的「正文 VS Code 式左对齐铺满」直接冲突。

## 做了什么

行长控制的手段换成 Monaco 自己的 `wordWrap: 'bounded'` + `wordWrapColumn`：编辑区照旧铺满整块
（背景连续、哪儿都能点、滚动条贴窗口右缘），只把折行点提前到目标字数，文字靠左。

1. `editor/options.ts`：删 `resolveProseMeasurePx`（容器像素宽 + 64px chrome 估算），
   换 `resolveProseWordWrap(measure, prose)`；中文字按 2 个半角列换算（Monaco 的
   `wordWrapColumn` 以半角列计），42 字档 = 84 列。非正文文件与「不限」档一律 `wordWrap: 'on'`。
   `wordWrap` 从 `useMonacoEditor` 的硬编码常量并入 `editorTypographyOptions`，
   create 与 updateOptions 仍共用同一份（改行宽档立即生效，不用重开文件）。
2. `Editor.tsx`：删掉 `justify-center` 外层与 `max-width` 内联样式，Monaco 宿主回到
   单层 `min-h-0 flex-1 overflow-hidden`（= PR #196 之前的形状）；`data-prose-measure`
   保留但改为档位名，供真机查 DOM。
3. 档位文案与设置说明订正（「约 42 字」→「约 42 字换行」；描述里的「并居中」删除）。
   档位本身（窄 32 / 适中 42 / 宽 56 / 不限）与默认值 medium 不变。

## 可证伪回归测试

- `tests/editor-options.test.ts`：bounded 列数换算（84/64/112）；**不限档与数据文件必须是
  `wordWrap: 'on'` 而不是回落成不换行**（否则正文会出横向滚动条）。
- `tests/editor.test.tsx`：Monaco 宿主渲染出的类名必须是单层 `min-h-0 flex-1 overflow-hidden`，
  且 markup 里不许再出现 `max-width` / 「居中容器直接包着 editor-container」——居中形状回来即红。

## 验证

```text
npm --prefix apps/desktop/frontend run typecheck    PASS
npx vitest run（frontend 全量）                      58 files / 331 passed
pnpm.cmd lint                                       PASS
```

## 未验证项

- 真机观感未验（归 E2E-1）：bounded 换行在**比例字体**（书稿轨衬线栈）下由 Monaco 按
  `typicalHalfwidthCharacterWidth` 估算折行宽度，实际每行字数与标称档位会有出入，
  「约 42 字」是软目标不是精确值；宽屏下文字靠左、右侧留白是否顺眼也待真机确认。
- 未动后端，无契约变更，未跑 pytest / e2e。
