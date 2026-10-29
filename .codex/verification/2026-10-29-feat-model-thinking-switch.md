## 2026-10-29 对话输入框底部加「模型」「思考」两个下拉；思考参数按三家官方现行写法发

- 改动：
  - 引擎（`packages/engine/src/llm/`）：
    - Anthropic 原生：开思考改发 `thinking:{type:'adaptive'}` + `output_config:{effort}`，**开思考时不发 temperature**（不再抛 `invalid_thinking_temperature`），adaptive 下不再做 max_tokens > 预算检查。4.6 以前的老模型（`claude-3*`、`claude-{opus,sonnet,haiku}-4` / `-4-0` / `-4-1` / `-4-5` 及其日期快照、`@日期`、`.` 分隔写法）沿用 `{type:'enabled',budget_tokens}`（1024/4096/8192），max_tokens ≤ 预算时抬到「预算 + 原上限」而不是报错，同样不发 temperature。认不出的名字一律走 adaptive。规则是 `anthropic.ts` 里的 `LEGACY_THINKING_MODEL`。
    - Gemini：`gemini-1*` / `gemini-2*` 沿用 `thinkingConfig.thinkingBudget`，其余发 `thinkingConfig.thinkingLevel`（`LOW` / `MEDIUM` / `HIGH`），两者绝不同发。规则是 `gemini.ts` 里的 `BUDGET_THINKING_MODEL`。
    - OpenAI 兼容：`reasoning_effort` 原样（没改）。
    - 「关」= 三家都不带任何思考参数。不认识的等级照旧拒绝。
    - 区分「显式关」和「未指定」：`ChatRequest` 加可选的 `reasoningOff`，`ConfiguredLlmProvider.configured()` 见到它就把等级置 null，否则照旧 `reasoningEffort || 配置源`。压缩（`conversationHistory.ts`）请求带 `reasoningOff: true`；语义评审（`judge/semantic.ts`）不再回落到主模型的 `STORYFORGE_LLM_REASONING_EFFORT`，只认 `STORYFORGE_JUDGE_LLM_REASONING_EFFORT` 覆盖（桌面配置源不带这个键）。没用「空串 / null 当显式关」是因为 p3 预言机经假 provider 记录了压缩与循环请求的 `reasoning_effort: null`，改那两个值会连带改 golden 与请求证据摘要；加一个不进请求证据、不进请求体的字段，p3 golden 零改动。
  - 界面（`apps/desktop/frontend`）：
    - `lib/reasoning-effort.ts`：等级 off/low/medium/high，按项目存 localStorage（`storyforge:reasoning-effort:<projectPath>`），默认 off，不认识的值当 off，不写 `.storyforge/`。
    - 注入：`lib/engine/llm.ts` 的 `nativeLlmSource(slot)` 每次都把 `STORYFORGE_LLM_REASONING_EFFORT` 覆盖成当前项目的等级（off → 空串，压过进程环境变量），main 与 polish 两个 slot 都覆盖。当前项目由持有 `activeProject` 的 `useProjectWorkspace` 在渲染期同步绑定（`bindReasoningEffortProject`），不用 effect，所以不会出现「换项目后那一帧发出的调用用上一个项目的等级」；Ctrl+K / 续写在对话面板没挂载时也能取到。
    - 下拉：`ComposerMenuSelect.tsx`（共用：开合、键盘、无障碍、浮层照 `PermissionProfileSelector`，选中标记改中性色）、`ModelProfileSelector.tsx`、`ReasoningEffortSelector.tsx`（+ `useReasoningEffort.ts`，渲染期同步换值，同 `useAgentPermission`）。`Composer.tsx` 工具栏从左到右：权限 · 模型 · 思考。运行中三者一样禁用（`disabled || busy`）。权限下拉本身没改。
    - 模型下拉：列 `listLlmProfiles` 的各套，当前那套打勾；选了调 `activateLlmProfile(id)`（全局切换，等同设置里点配置卡）；按钮显示配置名（超长省略），title「配置名 · 模型 id」；菜单主文字配置名、次行灰字模型 id；没有配置时按钮「未配置模型」，菜单只有「去设置里添加」，点了打开现有设置（`AppShell` 的 `openSettings` 经 `ChatWindow` → `ChatWindowView` → `Composer` 传下来；不给时只显示提示文字）。切换失败时菜单不收，在菜单底部就地显示「切换失败：原因」（`role="alert"`），不弹居中对话框。
    - `lib/desktop-llm-config.ts` 加 `subscribeLlmProfiles`：设置里或下拉里任一处写成功，另一处跟着换显示（设置界面本身每次打开都是重新挂载、`useModelProfiles` 挂载即重新 list，本来就能看到最新的当前配置，没改）。
- Gemini 官方文档查证（2026-10-29）：
  - https://ai.google.dev/gemini-api/docs/thinking 与 https://ai.google.dev/gemini-api/docs/gemini-3 现在写的是 Interactions API（`generation_config.thinking_level`，小写 `"low"`）；Gemini 3 文档写明 `thinking_level` 与旧的 `thinking_budget` 同发返回 400，`thinking_budget` 仅为向后兼容保留；各模型可用档：gemini-3-pro-preview 只有 low / high，gemini-3-flash-preview 与 3.1 系列有 low / medium / high（Flash 另有 minimal）。
  - generateContent REST 的枚举写法取 v1beta discovery 文档 https://generativelanguage.googleapis.com/$discovery/rest?version=v1beta 的 `ThinkingConfig`：`thinkingLevel` 是字符串枚举 `THINKING_LEVEL_UNSPECIFIED / MINIMAL / LOW / MEDIUM / HIGH`，描述写明推荐 Gemini 3 及以后、用于更早的模型会报错。所以 generateContent 请求体发大写 `LOW` / `MEDIUM` / `HIGH`。
  - https://docs.cloud.google.com/vertex-ai/generative-ai/docs/thinking ：「Don't use the `thinking_level` parameter with Gemini 2.5 and earlier models」，同发两者返回错误；2.5 用 `thinking_budget`。
  - 由此「中」在 gemini-3-pro-preview 上可能被拒；菜单底部提示「中转或模型不认时会报错，调回「关」即可。」。
- Anthropic 依据：随 Claude Code 分发的 claude-api 参考（模型表缓存于 2026-10-06）：4.6 起用 adaptive + `output_config.effort`（low/medium/high 各模型都支持）；`budget_tokens` 在 Opus 4.6 / Sonnet 4.6 已弃用，在 Opus 4.7 / 4.8 / 5 / 5.5、Sonnet 5 / 5.5、Fable 5 / 5.1、Haiku 5.5 上返回 400；4.6 以前（Haiku 4.5、Sonnet 4.5、Opus 4.5 / 4.1 / 4、3.7 等）只认 `budget_tokens`（≥ 1024 且 < max_tokens）。
- 各调用路径是否带作者选的等级：

  | 调用路径 | 走法 | 带等级 |
  | --- | --- | --- |
  | 对话工具循环（chat 自由文本） | `sdkLoop` 请求 `reasoningEffort: null` → `configured()` 取配置源 | 带 |
  | 循环不可用时的单轮回答 `chatReply` | `callLlm(source)` | 带 |
  | 起草 `file.create` / `draftFileContent` | `callLlmStreamed(source)` | 带 |
  | 修订 `file.revise` / `reviseFileContent` | `callLlmStreamed(source)` | 带 |
  | 整章润色 `polishService`（main 或专用润色那套） | `ConfiguredLlmProvider`，请求 `reasoningEffort: null` | 带（两个 slot 都覆盖） |
  | Ctrl+K 行间修订 | `reviseWithEngine` → `nativeLlmSource('main')` | 带 |
  | Ctrl+Shift+K 续写 | `streamContinueProse` → `streamChatCompletions(source, buildChatPayload(source))` | 带 |
  | 对话压缩 `conversation.compact` | 请求 `reasoningOff: true` | **不带** |
  | 语义评审 `judge.semantic`（`project.deep_consistency`） | `requestSource.STORYFORGE_LLM_REASONING_EFFORT = ''`（评审专用覆盖除外） | **不带** |
  | 多视角审稿 `file.review` | `assistant.llm().call` | 带（说明未点名，沿用配置源） |
  | 跨章一致性（按钮 `crossChapterWithEngine` 与循环内 `project.cross_chapter_check`） | `callLlm(source)` | 带（同上） |
  | 事实补录 `facts.ts`、拆书 `ideCommands.ts` | `callLlm(main.source)` | 带（同上） |
  | 模型连通性探测 `probeWithEngine` | 只拉 `/models`，不发对话 | 无关 |

- 验证：
  - golden（有意改行为）：只动了 `packages/engine/golden/p2-llm-native.json`。用脚本（`%TEMP%/sf-think/update_native_golden.py`，每处替换断言出现一次、写回后与 `json.dumps(indent=2, ensure_ascii=False)` 逐字节同格式）改；再用 `%TEMP%/sf-think/golden_json_diff.py` 把 HEAD 版与新版逐路径对比（请求体字符串按 JSON 展开）。全部 16 处差异：
    - `anthropic-roundtrip` 请求体：`thinking.type` enabled → adaptive、去掉 `thinking.budget_tokens`、新增 `output_config.effort=low`、去掉 `temperature`（4 处）；
    - `gemini-roundtrip` 请求体：`thinkingConfig.thinkingBudget=8192` → `thinkingConfig.thinkingLevel="HIGH"`（2 处；该场景模型名是 `gemini 2.5:专业~x(预览)!*'`，带空格不是 `gemini-2`，按规则归新写法）；
    - `anthropic-thinking-temperature` / `anthropic-thinking-budget`：原来在本地就抛错、不发请求（「temperature 必须为 1」「max_tokens 必须大于预算」这两条校验已按说明删除）；现在补一条 200 回复，期望改为照常发出，请求体是同一组消息 + `max_tokens`（9000 / 4096，均未被抬）+ `thinking:{type:'adaptive'}` + `output_config.effort`（high / medium），**不带 temperature**；各 5 处（`error` → `result`、`replies`、`requests`、`clock` 100.0 → 100.25）。
    - 场景列表、其余场景、元数据零变化。p3 / p5 的 golden（另有 13 个文件含 `reasoning_effort`）全部未改动、照旧通过；`anthropic-bad-effort`（max）、`gemini-bad-effort`（ultra）照旧拒绝。
  - 新增 / 改动的测试：
    - 引擎 `src/llm/thinking.test.ts`（新）：Anthropic 新模型 7 个名字 adaptive + effort + 不带 temperature；老模型 8 个名字走 budget、不带 output_config 与 temperature；max_tokens 抬升（2048+high → 10240、4096+medium → 8192、4097 不动）；关 = 不带思考参数、temperature 照常；Gemini 3 三个名字只带 thinkingLevel、2.x / 1.5 四个名字只带 thinkingBudget；关 = 无 thinkingConfig；OpenAI low / 关；`ConfiguredLlmProvider` 未指定吃配置源 high、`reasoningOff` 时请求体无 `reasoning_effort`。
    - 引擎 `src/loop/conversation.test.ts` +1（压缩请求 `reasoningOff=true`、`reasoningEffort=null`），`src/judge/semantic.test.ts` +1（主配置 high 时评审收到空串，评审覆盖 low 时收到 low）。
    - 前端 `tests/reasoning-effort.test.tsx`（新）：默认值 / 按项目存取 / 不认识当关；注入 off → 空串（压过 Rust 给的 medium）、low → low、main 与 polish 都覆盖、切项目换值；`useProjectWorkspace` 切项目后下一次取配置即新项目等级；`useReasoningEffort` 换项目时提交的值从不是上一个项目的。
    - 前端 `tests/composer-model-thinking.test.tsx`（新）：工具栏顺序权限 · 模型 · 思考；模型下拉列出、打勾、点另一套调 `activateLlmProfile('p2')` 后换显示；切换失败菜单不收、`role="alert"` 显示原因、无对话框；无配置时「未配置模型」+「去设置里添加」调打开设置；运行中两个下拉禁用；思考四档、「关」说明、底部提示、选中写本项目 localStorage；键盘（方向键打开聚焦已选、移焦不改值、Esc 取消回按钮、Home + Enter 选中回按钮）。
    - 改动的旧测试：`tests/engine-llm.test.ts` 期望配置源多一个 `STORYFORGE_LLM_REASONING_EFFORT: ''`（没打开项目 = 关）；`tests/settings-accessibility.test.tsx` 的 `desktop-llm-config` mock 补上 `subscribeLlmProfiles`（新导出，mock 里缺它时整页挂载会炸）。
  - 单跑：`pnpm --filter @storyforge/engine` 下 `vitest run`：99 个文件 13934 passed + 2 skipped；`tsc --noEmit` 通过。前端新测试 2 个文件 11 passed。
  - 接线变异 9 处（`%TEMP%/sf-think/mutate.py`：每处断言变异串只出现一次、跑对应测试、`finally` 里按原字节写回并核 sha256；另在跑之前对全部改动文件记 sha256、跑完 `sha256sum -c` 全部 OK；没用 git checkout / stash）：
    - M1 去掉 `nativeLlmSource` 里的等级注入 → 3 条红；
    - M2 去掉 `useProjectWorkspace` 的渲染期绑定 → 1 条红；
    - M3 去掉压缩处 `reasoningOff: true` → 1 条红；
    - M4 `configured()` 不认 `reasoningOff` → 1 条红；
    - M5 评审回落到主配置的等级 → 1 条红；
    - M6 Anthropic 开思考仍发 temperature → 18 条红（含 golden）；
    - M7 Gemini 不分代际都发 thinkingBudget → 4 条红（含 golden）；
    - M8 Anthropic 老模型判定失效 → 9 条红；
    - M9 模型下拉点选不调 `activateLlmProfile` → 2 条红。
  - `pnpm verify` EXIT=0（一次过）：lint、前端类型检查通过；project-core 14 passed；引擎类型检查 + 99 个文件 13934 passed / 2 skipped；前端单测 249 个文件 2507 passed；行间续写、浏览器冒烟、Agent 对话三个浏览器回归通过。
  - 行尾：CRLF 文件（`Composer.tsx`、`ChatWindowView.tsx`、`AppShell.tsx`）按字节读写保持 CRLF，其余 LF；无 CRCRLF。`git diff --numstat` 与 `--ignore-all-space --numstat` 只在 `anthropic.ts`（21/23 vs 19/21）与 golden（66/26 vs 64/24）差 2 行，是删掉 / 新增的空行与缩进变化，不是整文件行尾变动。行数上限：`AppShell.tsx` 499 / 500、`Composer.tsx` 439。
- 未覆盖：
  - 没调真模型、没花钱：Anthropic adaptive / effort、老模型 budget、Gemini `thinkingLevel` 大写枚举、中转站是否认这些参数，都只按文档与单测断言，没有真请求验证。
  - 没跑 Rust 测试、Tauri 冒烟、真宿主探针（没改 Rust，宿主命令与载荷形状没变；配置源只多一个键）。没在装机版上点穿「切模型 → 下一条生效」「切项目 → 等级跟着换」。
  - 下拉没有加前置图标（权限下拉有小盾牌）：说明没定图标，没自作主张；焦点环沿用权限下拉的写法（全局焦点色），选中标记用中性前景色。
  - 现存问题（本分支没动）：Anthropic 现行新模型（Opus 4.7+、Sonnet 5 / 5.5、Fable、Haiku 5.5 等）在「关」时仍照旧发默认 temperature 0.7，按参考文档这些模型对非默认采样值可能直接 400；Gemini 3 开思考时仍发 temperature。
