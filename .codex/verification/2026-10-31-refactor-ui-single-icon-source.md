## 2026-10-31 图标只从一处来：删手画的 StoryIcons，lucide-react 只经 shell-icons 引

- 改动（作者要求「同一件事只留一种做法」）：
  - 删 `components/StoryIcons.tsx`（手画的文件夹 / Markdown 文件两枚 svg，描边 1.2）。用到它的 `ResourceExplorer.tsx`（文件树）、`StoryNavigator.tsx`（故事视角文件行）改用 shell-icons 的 `Folder` / `FileText`。
  - 手写 `<svg>` 两处，都是普通图标，换成 shell-icons：`ResourceExplorer.tsx` 文件夹行的展开三角 → `ChevronRight`（保留原来的 `rotate-90` 过渡）；`Editor.tsx` 未开文件空态的文件夹 → `Folder`。换完 `src/` 里不再有 `<svg`，没有需要保留的图表 / 画布类图形。
  - 绕过 shell-icons 直接引 `lucide-react` 的改成从 shell-icons 引：`app/NewProjectDialog.tsx`（FolderOpen）、`chat-window/ComposerMenuSelect.tsx`（Check / ChevronDown）、`chat-window/MessageActions.tsx`（Copy / RefreshCw）、`chat-window/PermissionProfileSelector.tsx`（Shield，CRLF 文件，行尾保持）。类型走同一个口子：`ui/Spinner.tsx` 的 `LucideIcon` 改从 shell-icons 拿（shell-icons 本来就再导出 `LucideIcon` / `LucideProps`），所以规矩是「连 `import type` 也不直接引 lucide-react」。`tests/ui-primitives.test.tsx` 里的 `RefreshCw` 也改从 shell-icons 引。
  - `icons/shell-icons.tsx` 补导出 `Copy`、`Folder`、`Shield`；开头注释补一行「别处不直接引 lucide-react」，树一栏的命名改成实际用的 `Folder·FileText（文件树 13px、描边 1.7）`。
  - 守护测试并进 `tests/ui-primitives.test.tsx`：①`src/` 里出现 `'lucide-react'`（含子路径、含 `import type`）的文件只能是 `src/components/icons/shell-icons.tsx`（正则先用两条样例自检）；②`StoryIcons.tsx` 不存在、`src/` 里没有文件再提 `StoryIcons`、`src/` 里没有手写 `<svg`。
  - 禁碰清单里的文件（`WriteBatchPanel.tsx`、`panels.tsx`、`Composer.tsx`、`display-utils.ts`、`ContextPanel.tsx`、`ChatWindowView.tsx`、`write-batch-run.ts`）都没有直接引 lucide-react，也没有手写 svg，不用豁免，一个字节没动。

- 每处替换前后（尺寸按 16 / 24 格的形状占比换算到屏幕像素；描边屏幕粗细 = strokeWidth × 尺寸 ÷ viewBox）：

  | 位置 | 改前 | 改后 | 形状外框（宽×高） | 屏幕描边 |
  | --- | --- | --- | --- | --- |
  | 文件树文件夹行 · 文件夹 | `FolderIcon`，14px（`h-3.5 w-3.5`），viewBox 16，stroke 1.2 | `Folder size={13} strokeWidth={1.7}` | 10.9×8.8 → 10.8×9.2 px | 1.05 → 0.92 px |
  | 文件树文件夹行 · 展开箭头 | 手写实心三角 `M6 4l4 4-4 4V4z`，14px，fill | `ChevronRight size={14} strokeWidth={1.7}`，同样 `rotate-90` | 3.5×7 → 3.5×7 px | 实心 → 0.99 px 线 |
  | 文件树文件行 · 文件 | `MarkdownFileIcon`（折角页 + 里面一个 M↓），14px，stroke 1.2 / 1.05 | `FileText size={13} strokeWidth={1.7}`（折角页 + 两道横线） | 8.3×10.9 → 8.7×10.8 px | 1.05 → 0.92 px |
  | 故事视角文件行 · 文件 | `MarkdownFileIcon` 默认 14px | `FileText size={13} strokeWidth={1.7}` | 同上 | 同上 |
  | 编辑器未开文件空态 | 手写实心轮廓文件夹，40px（`w-10 h-10`），viewBox 16，轮廓厚 1 格 | `Folder size={40} strokeWidth={1.4}` | 30×30 → 33.3×28.3 px | 2.5 → 2.33 px |

  - 取舍：文件树最常看，目标是「不变大、不变粗」。文件夹 / 文件用 13 而不用 14：Lucide 形状占格比旧图标大，13px 时外框和旧的 14px 基本重合（差 ≤0.4px）；用 14 会各大约 1px。描边取 1.7（在 shell-icons 注释定的 1.5–1.75 范围内，与搜索、观测镜的树形箭头一致），屏幕上 0.92px，比旧的 1.05px 略细，不会更粗。箭头保留 14：Lucide 箭头在 14px 时外框和旧三角完全一样；由实心三角变成一笔线，观感更轻。
  - 颜色全部不变：图标都是 `currentColor`，外层与原有颜色 class 原样保留（文件夹 `text-foreground` / `text-muted group-hover:text-foreground`；文件 `text-accent` / `text-muted opacity-70 group-hover:opacity-100`；故事视角 `text-accent-foreground` / `text-muted`；空态 `text-muted/60`）。
  - 没顺手改：文件夹展开时仍是同一枚 `Folder`（没改成 `FolderOpen`），原来也是只变色不换图。
  - 附带：Lucide 图标默认带 `aria-hidden="true"`；原来的展开三角没有，现在读屏会跳过它（按钮本身有 `aria-expanded`），其余几处原来就是 `aria-hidden`。

- 验证：
  - `pnpm lint`：EXIT=0（eslint 0 error，2 条既有 warning 在 `tests/independent-claim-history.test.ts`；prettier 全部通过；另单独 `prettier --check tests/ui-primitives.test.tsx` 通过）。
  - `npm --prefix apps/desktop/frontend run typecheck`：EXIT=0。
  - `pnpm --filter @storyforge/engine test`（含 golden）：EXIT=0，111 个文件，14251 passed / 2 skipped；`packages/` 无改动，golden 零变化。
  - `npm --prefix apps/desktop/frontend run test`（前端 vitest 全套）：EXIT=0，270 个文件，2745 passed。
  - 变异验证（每次单跑 `tests/ui-primitives.test.tsx`，打完用带计数断言的定点替换改回，最后 `git status` 与改前一致，复跑 9 passed）：
    1. `MessageActions.tsx` 改回 `from 'lucide-react'` → 「lucide-react 只在 shell-icons 里引入」红（1 failed / 8 passed）。
    2. `Spinner.tsx` 的 `import type { LucideIcon }` 改回 `from 'lucide-react'` → 同一条红（类型导入也拦得住）。
    3. 文件树文件夹图标换回一段手写 `<svg>` → 「StoryIcons 已删，界面里也不再手写 <svg>」红。
    4. 从 HEAD 取回 `StoryIcons.tsx` 放回原处 → 同一条红；删掉后恢复。
  - 行尾：改过的 10 个文件改前改后行尾一致（9 个纯 LF，`PermissionProfileSelector.tsx` 纯 CRLF）；本记录随同目录用 LF。

- 未覆盖：
  - 真宿主观感未看：没在 Tauri 窗口里看文件树、故事视角、编辑器空态的实际观感（尤其文件行由 M↓ 变成横线、箭头由实心三角变成线）。上表是按 viewBox 几何换算的，不是截图对照。
  - 本地未跑三个浏览器回归（行间续写 / 浏览器冒烟 / Agent 对话），以 CI `Windows Verify` 的 `pnpm verify` 为准。
  - 未跑 Rust 测试与 Tauri 冒烟（本刀不动宿主）。
