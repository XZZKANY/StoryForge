# 验证报告 · UI/UX 审计速赢包（第一刀 · S 级零/低风险）

时间：2026-07-24
依据：`D:\记事本\StoryForge-UIUX审计报告-2026-07-24.html`「建议第一刀 · 速赢包」
分支：`feat/uiux-speed-wins-20260724`

本刀 = 审计速赢包 10 项里的 9 项（remark-gfm 因当前 npm 镜像不可达延后，折进 chat-ux-polish
的 AssistantMarkdown 一并落地），纯前端展示层，无后端 / OpenAPI / schema 改动。

## 变更（对应审计条目）

1. **真 BUG · 失败提示渲染成成功绿**（`Editor.tsx:666`）：`suggestionStatus` 从字符串前缀匹配
   （只认 `AI 修订失败`）改为带语义 `tone`（success/error/info）的对象；`useSuggestionWriteback`
   各出口按语义传 tone（接受/分块/存旁注/导出/定位/旧补丁拒写回 = error，写入/导出成功 = success）。
2. **真 BUG · 观测「上次扫描」显示 UTC**（`ObservatoryView.tsx`）：`generatedAt.slice(11,16)`（切 ISO 串取
   UTC，差 8 小时）改 `formatScanTime` 按本地时区 `toLocaleTimeString`，非法值兜底原串。
3. **真 BUG · 浅色主题图标按钮 hover 纯白叠白不可见**（`index.css`）：`.sf-toolbar-button:hover` /
   `.sf-icon-button:hover` 的 `rgb(255 255 255 / .0x)` 改 `--elevated` / `--border` token（两主题都翻）；
   删 `VersionHistory` / `ResourceExplorer` 两处绕过基类的 inline hover override。
4. **全局 `:focus-visible` 描边**（`index.css`）：加一条 `outline: 2px solid rgb(var(--agent))`，位于
   `@tailwind utilities` 与裸 `outline:none` 输入之后 → 覆盖二者，补上键盘焦点可见性。
5. **删死代码 `.step-*` 状态色**（`index.css`）：5 条硬编码 hex，全仓零消费者，与 live 的
   AgentStepsPanel token 相互矛盾，整段删除。
6. **「右侧」→「编辑器里」**（`useAgentRunControls` / `useRunAuthorAgent` / `resumed-result` /
   `useInlineChat`）：三栏改版后编辑器在中栏，方向指反的提示改为布局无关话术。
7. **文案清理小包**：`sidecar`→「本地服务」（StatusBar）、「接线」→「开发中 / 尚未启用」（SidePanel 搜索占位、
   ObsPanel / ObservatoryView / StatusBar 观测态）、`Desktop env`→「桌面注入」（SettingsView）、
   `Issue Scope`→「问题范围」（assistant-suggestions）、ASCII `...`→全角 `…`（欢迎页 / Composer /
   StoryNavigator）、删 Composer 常驻死标签「编辑模式」（`ml-auto` 移到 pause/send 保持右对齐）、
   顺带「暂停 AgentRun」tooltip→「暂停本轮」。
8. **欢迎页签 `h-9`→`h-shell-row`**（`WelcomeWorkspace`）：补 4px 断层 + `data-testid="welcome-tabbar"`
   追加进 `shell-row-height` 指纹护栏防回归。
9. **未保存圆点 / 选中高亮**：EditorTabs dirty dot `bg-current`（灰）→ `bg-foreground`（高对比）；
   StoryNavigator 故事页选中 `bg-accent text-accent-foreground` → 对齐资源管理器 `bg-elevated
   text-foreground`（预览态一并对齐 `bg-elevated/60`）。

## 验证

```bash
npm --prefix apps/desktop/frontend run typecheck   # PASS
npm --prefix apps/desktop/frontend run test        # 51 files / 260 passed
npx eslint <changed>                                # 0 errors（仅 Editor.tsx 既有 handleExport warning）
npx prettier --check <changed>                      # 全过
```

- 随文案改动更新测试断言：`status-observation.test.tsx`（观测未接线→尚未启用）、
  `chat-window.test.ts`（右侧 diff 面板→编辑器里确认 diff）。
- `shell-row-height.test.ts` 新增 welcome-tabbar 一例，欢迎页签行高回归可证伪。

## 未验证 / 边界

- **remark-gfm（真 BUG · 表格/删除线渲染成裸符号）本刀未做**：当前网络下 npm 镜像
  （npmjs / npmmirror）经代理不可达，装不了依赖；已规划折进 `chat-ux-polish` 的 AssistantMarkdown
  一并落地（网络恢复后 npmjs 一致装）。
- 真机 Tauri 观感（浅色 hover / 键盘焦点环 / UTC 时间 / 未保存圆点 / 选中高亮）归 E2E-1 真机波。
- tone 判色仅覆盖 `useSuggestionWriteback` / `Editor` 出口；行间对话 flashStatus 走独立 toast，未纳入。
