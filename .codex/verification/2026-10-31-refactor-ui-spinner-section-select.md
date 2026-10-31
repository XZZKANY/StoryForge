## 2026-10-31 加载圈、左栏折叠分区、输入框下方下拉：三个各写一套的小组件收成一套

- 改动（作者要求「同一件事只留一种做法」）：
  - 加载圈：新增 `components/ui/Spinner`（经 `ui/index.ts` 导出）。默认画 14px 圈，颜色跟 currentColor，默认 `aria-hidden`，给 `label` 时外包 `role="status"` + `sr-only` 读屏文字；给 `icon` 时改为转这个图标，`spinning` 控制转不转（刷新按钮平时静止、读取中转）。圈的外观收到 `index.css` 的 `.sf-spinner` 一处定义（原 `.sf-button-spinner` 的边框 / 动画挪过去，`.sf-button-spinner` 只剩按钮里的绝对定位，关键帧改名 `sf-spin`），Button 自己的加载态也改用 `<Spinner className="sf-button-spinner" />`。七个视图里手写的 `animate-spin` 和两处借用 `sf-button-spinner` 的地方全部换成 `Spinner`。`sf-thinking-dots` 与 `animate-pulse` 骨架没动。
  - 左栏折叠分区：观测镜 `ObservatoryView` 的私有 `Section` 改成薄包装 `PanelSection`（`prefix="obs"`、默认展开、计数走 `meta`），和手稿 / 作品两个视图同一套分区头。`PanelSection` 现有的 `meta` / `defaultOpen` 已够用，没加新 prop。
  - 输入框下方下拉：`PermissionProfileSelector` 从约 200 行自带的开合 / 键盘 / 失焦 / listbox 实现改成建在 `ComposerMenuSelect` 上（54 行）。`ComposerMenuSelect` 扩了两处：新增 `triggerIcon`（权限的小盾牌，窄输入框时仍按自身 class 隐藏）；选项说明文字从单行截断改成折行（权限三档的说明比 280px 菜单宽，原来就是折行显示）。外部 props 不变，`Composer.tsx` 没动。
  - 守护测试：新增 `apps/desktop/frontend/tests/ui-primitives.test.tsx`，扫 `src/` 下 ts/tsx/css，断言 `animate-spin` 只出现在 `components/ui/`、`sf-button-spinner` 只出现在 `components/ui/Button.tsx` 与 `index.css`（两条都同时断言目标文件里确实有，防改名后空转）；另有两条渲染断言钉住 `Spinner` 的装饰 / 读屏 / 图标静止三种形态。
- 加载圈逐处替换前后对照（大小 / 颜色 / 粗细）：

  | 位置 | 替换前 | 替换后 | 观感 |
  | --- | --- | --- | --- |
  | `ui/Button.tsx` 加载态 | `span.sf-button-spinner`：absolute、14×14、`2px solid currentColor`、右边透明、0.8s 匀速、降低动效时静止 | `<Spinner className="sf-button-spinner" />`：`.sf-spinner` 同样 2px currentColor 右透明 0.8s、降低动效 `animation:none`，宽高 14px 走 inline style，`.sf-button-spinner` 只给 absolute | 一致 |
  | `CommandPalette.tsx` 读取作品文件 | `span.relative.inline-block.h-3.5.w-3.5.flex-shrink-0` 套一个 `sf-button-spinner`（14px、2px currentColor=text-muted、0.8s） | `<Spinner />`（14px、2px currentColor、0.8s、自带 flex-shrink 0） | 一致，少一层包装 |
  | `Editor.tsx` 读取文件 | `span.relative.inline-block.h-3.5.w-3.5` 套 `sf-button-spinner` | `<Spinner />` | 一致 |
  | `Editor.tsx` 正在请求 AI 修订 | `span.inline-block.w-3.h-3.rounded-full.border-2.border-agent.border-t-transparent.animate-spin`（12px、2px、紫色、1s） | `<Spinner size={12} />`：12px、2px、currentColor（外层 div 是 `text-agent`，即同一紫色） | 大小 / 颜色 / 粗细一致；转速 1s → 0.8s、透明边由上边换成右边（转动中只是相位差） |
  | `app/BookOverview.tsx` 重试 | `<RefreshCw size={11} className={refreshing ? 'animate-spin' : ''} aria-hidden="true" />` | `<Spinner icon={RefreshCw} spinning={refreshing} size={11} />` | 一致（同尺寸、默认线宽 2、读取中 `animate-spin`、`aria-hidden`） |
  | `app/BookOverviewHeader.tsx` 重新读取 | `<RefreshCw size={15} className={refreshing ? 'animate-spin' : ''} aria-hidden="true" />` | `<Spinner icon={RefreshCw} spinning={refreshing} size={15} />` | 一致 |
  | `shell/BookProfileView.tsx` 刷新 | `<RefreshCw size={14} strokeWidth={1.6} className={handle.refreshing ? 'animate-spin' : ''} />` | `<Spinner icon={RefreshCw} spinning={handle.refreshing} size={14} strokeWidth={1.6} />` | 一致；`aria-hidden` 由 lucide 默认补变成显式写出，属性值相同 |
  | `shell/KnowledgeInboxView.tsx` 刷新 | `<RefreshCw size={13} className={handle.loading ? 'animate-spin' : ''} />` | `<Spinner icon={RefreshCw} spinning={handle.loading} size={13} />` | 一致 |
  | `shell/ManuscriptView.tsx` 重新读取 | `<RefreshCw size={14} strokeWidth={1.6} className={busy ? 'animate-spin' : ''} />` | `<Spinner icon={RefreshCw} spinning={busy} size={14} strokeWidth={1.6} />` | 一致 |
  | `shell/ObservatoryView.tsx` 重新扫描 | 同上 | 同上 | 一致 |

  用 postcss + tailwind 按生产配置编译 `index.css` 核过：`.sf-spinner`（2px currentColor、右透明、`sf-spin 0.8s linear infinite`）、`.sf-button-spinner { position:absolute }`、降低动效下 `.sf-spinner { animation:none }`、`.animate-spin`（1s）都在产物里。
- 有意的观感变化（统一本身带来的）：
  - 观测镜五个分区头变成和手稿 / 作品一样：`font-semibold tracking-[0.06em] text-subtle px-3 gap-1.5` → `font-medium text-muted px-2 gap-1`，箭头 `text-subtle`，标题过长截断；计数从紧跟标题的圆角小药丸（`rounded-full bg-elevated px-1.5 font-mono text-3xs`）改成靠右的 `font-mono text-3xs text-subtle`；分区间距 `mb-2` → `mt-2 first:mt-0`（间距仍 8px），内容底部留白 `pb-3` → `pb-2`；折叠按钮补上了 `aria-expanded`。
  - 权限下拉菜单内：已选项的文字与对勾从紫色 `text-agent` 改成和模型 / 思考等级一样的中性 `text-foreground`，未选项文字从 `font-medium` 改成常规（已选项仍 `font-medium`）。触发按钮（盾牌、文字、32px 高、箭头）不变。
- testid：
  - 观测镜分区外层 `obs-section-*` 保持不变（测试引用的 `obs-section-facts` / `obs-section-proposals` 照旧）；折叠按钮按 `PanelSection` 统一命名从 `obs-section-toggle-*` 变成 `obs-toggle-*`（全仓库 grep 无引用）。
  - 权限选项按 `ComposerMenuSelect` 统一命名从 `permission-option-*` 变成 `permission-profile-selector-option-*`，两处测试选择器跟着改（`tests/permission-profile-selector.test.tsx` 的 `permissionOption` 取元素函数、`tests/composer-client-surface.test.tsx` 一行），断言一个没动。浏览器回归 `verify-agent-conversation.mjs` 只读触发按钮文字，不受影响。
- 故意没统一：`ObservatoryFacts.tsx` 事实台账里按章折叠的那一行（`obs-fact-chapter-toggle`）没改成 `PanelSection`。它在「事实台账」分区体内，是逐章的行级展开，和同视图检查器行（`checker-toggle`）、实体出处（`entity-provenance-toggle`）是同一类；套 `PanelSection` 会让每章变成 32px 高、外加 8px 间距的分区头，和「事实台账」本身同级，章多时台账长度约翻倍。
- 验证（corepack 的 pnpm 9.15.4 临时 shim）：
  - `pnpm lint` EXIT=0（0 error；2 条 warning 在 `tests/independent-claim-history.test.ts`，原有）；新改的三个测试文件另跑 `prettier --check` 通过。
  - `npm --prefix apps/desktop/frontend run typecheck` EXIT=0。
  - `pnpm --filter @storyforge/engine test` EXIT=0：111 文件，14251 passed / 2 skipped；`packages/` 零改动，golden 零变化。
  - `npm --prefix apps/desktop/frontend run test` EXIT=0：270 文件，2736 passed。改动直接相关的 6 个文件（ui-primitives / permission-profile-selector / composer-client-surface / observatory-view / observatory-facts / button-primitives）单跑 68 passed。
  - 变异验证：① 把 `ManuscriptView` 的刷新图标改回手写 `className={busy ? 'animate-spin' : ''}`，`animate-spin 只出现在 components/ui 里` 红（1 failed / 3 passed，报出 `src/components/shell/ManuscriptView.tsx`）；② 把 `CommandPalette` 的 `<Spinner />` 改回借用 `sf-button-spinner`，`sf-button-spinner 只出现在 Button 与它的样式里` 红（1 failed / 3 passed，报出 `src/components/CommandPalette.tsx`）。两次都用脚本按原字节写回，确认与改前一致后复跑 4 passed。
- 未覆盖：
  - 真宿主观感未看：没在装机版或 Tauri 窗口里看过观测镜分区头、权限菜单、各处加载圈，浅色 / 深色都没截图。
  - 本地未跑三个浏览器回归（行间续写 / 浏览器冒烟 / Agent 对话；本机有别的会话在跑 headless Chrome），以 CI `Windows Verify` 为准。
  - 没改 Rust，未跑 Rust 测试与 Tauri 冒烟。
