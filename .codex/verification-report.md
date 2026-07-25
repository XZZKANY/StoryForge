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
