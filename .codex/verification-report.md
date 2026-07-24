# 验证报告 · UI/UX 审计其余 P3（文案 / 术语 / 小 UX 打磨批）

时间：2026-07-24
依据：UI/UX 审计 P3「文案 · 术语」「导航 · 观测」「编辑器」等主题
分支：`feat/uiux-p3-polish-20260724`

本刀 = 其余 P3 里**清晰正确、可快速落地**的一批（文案术语统一 + 若干小 UX 修）。纯前端
展示 / 交互层，无后端 / OpenAPI / schema 改动。L 级功能项与 token 整合另计（见下「延后」）。

## 变更（对应审计条目）

- **审稿 issue 悬浮严重度中文化**（decorations.ts）：hover 里 `high/medium/low` → 高 / 中 / 低。
- **检查器行计数加标签**（ObservatoryView）：无标签的 `0 / 2` → 「冲突 0 · advisory 2 · 问题 N」，
  分得清冲突与 advisory。
- **「批准」权限主 CTA hover 反馈**（panels RunActionBar）：`hover:bg-accent`（同色无反馈）→
  `hover:bg-accent/90 active:bg-accent`。
- **顶栏搜索框文案诚实**（Titlebar）：`搜索文件或命令` → `搜索文件…`（点它 / Ctrl+P 只进 files 模式）。
- **命令面板右栏命名统一**（CommandPalette）：`AI 交互区` → 「对话栏」、`文件工作区` → 「资源管理器」，
  与界面其余处一致。
- **固定上下文术语收敛**（Composer / panels）：`挂载 / 常驻 / 钉住 / pin / pinned` 全部统一为
  「固定（参考）/ 已固定 / 取消固定」。
- **空行 Ctrl+K 防空锚定**（useInlineChat）：无选区且光标行为空时提示「先选中要改的文字」并不发起，
  不再拼空 ANCHOR 块白等模型一趟 no-op。

## 验证

```bash
npm --prefix apps/desktop/frontend run typecheck   # PASS
npm --prefix apps/desktop/frontend run test        # 52 files / 269 passed
npx eslint <changed>                                # 0 errors
npx prettier --check <changed>                      # 全过
```

随文案改动更新 `chat-ux-polish.test.tsx`（compact 摘要 `pin`→`固定`）。

## 延后（其余 P3，非本刀，未做）

诚实标注剩余 P3 项，按类型分组：

- **token 整合（hygiene，中等）**：`--agent-foreground`、审稿 issue 严重度硬编码 hex →
  `--issue-*`、抬升投影 shadow token、两套 toast 皮肤统一、`--sf-control-height` 落地、
  Composer @提及浮层对齐下拉配方。
- **L 级功能**：页签拖拽重排、Ctrl+K 行间字符级 diff、版本记录列表「预览 / 对比当前」。
- **中等行为**：审稿 issue 标记改掉问题文字后自动移除、运行流式期间允许预写下一轮、
  Composer pin「✕」常显 / focus 可达。
- **需产品决策**：左栏空态「新的开始」按钮含义、`回到编辑` 图标（PanelRight）语义、
  快捷键速查补 Ctrl+Shift+E / 改两列 grid。

真机观感（hover / 中文严重度 / 计数标签 / Ctrl+K 空行提示）归 E2E-1 真机波。
