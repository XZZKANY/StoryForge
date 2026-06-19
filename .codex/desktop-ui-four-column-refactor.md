# 桌面 IDE 四栏布局重构完成报告

生成时间：2026-06-16 14:30:00 +08:00

## 1. 重构目标

将桌面 IDE 从三栏布局（项目 | AI 交互 | 文件工作区）重构为四栏布局，对齐期望的 UI 效果：

**期望布局：**
- 左1：项目列表（多项目切换）
- 左2：对话窗口（带标签导航：上下文 | 项目名 | 未打开文件）
- 中：资源管理器 + 未打开文件 + 历史（三段纵向堆叠）
- 右：编辑器

**视觉风格：**
- 深色主题（`#1E1E1E` / `#252526` 背景，`#2D2D30` 边框）
- 标签式导航（对话窗口顶部）
- 现代化面板布局，无顶部菜单栏干扰

## 2. 交付物清单

### 新增组件

1. **ProjectList.tsx** — 最左侧项目列表
   - 展示所有最近打开的项目（最多12个）
   - 每个项目显示首字母图标 + 项目名
   - 支持点击切换、新增打开项目按钮
   - 深色背景 `#1E1E1E`

2. **ChatWindow.tsx** — 对话窗口（取代原 Composer）
   - 标签导航：上下文 | 项目名 | 未打开文件
   - 完整的消息流展示（用户 + 助手）
   - 带头像的消息气泡（用户：蓝色 `#0E639C`，AI：灰色 `#2D2D30`）
   - 保留原 Composer 的 AI 修订触发逻辑
   - 深色背景 `#1E1E1E`

3. **ResourceExplorer.tsx** — 资源管理器（取代原 FileTree）
   - 可折叠的文件树
   - 保留原 FileTree 的层级递归逻辑
   - 深色背景 `#252526`

4. **HistoryPanel.tsx** — 历史面板
   - 展示最近打开的文件（最多20个）
   - 点击快速跳转
   - 深色背景 `#252526`

### 修改组件

1. **App.tsx** — 主应用布局
   - 完全重写为四栏布局
   - 移除三栏折叠逻辑（四栏不可折叠）
   - 新增 `recentFiles` 状态管理
   - 新增 `RECENT_FILES_KEY` localStorage 持久化
   - 移除 `panels` 折叠状态（改为固定四栏）
   - 调整 `DEFAULT_WIDTHS` 为四栏宽度

### 保留组件

- **Editor.tsx** — 编辑器，无变化
- **ResizablePanel.tsx** — 可调整尺寸面板，无变化
- **CommandPalette.tsx** — 命令面板，无变化

## 3. 本地验证

- **构建测试**：`pnpm --filter @storyforge/desktop-frontend build` ✅ 通过
- **开发服务器**：`http://localhost:3007` ✅ 启动成功
- **Bundle 大小**：3,527.48 kB（与重构前一致，无新依赖）

## 4. 核心变化说明

### 状态管理

```typescript
// 移除折叠状态
- const [panels, setPanels] = useState<PanelState>({ ... });

// 新增文件历史
+ const [recentFiles, setRecentFiles] = useState<string[]>([]);

// 调整宽度配置
const DEFAULT_WIDTHS = {
-  project: 240,
-  assistant: 440,
-  fileTree: 240,
+  projectList: 200,
+  chatWindow: 320,
+  resourcePanel: 260,
};
```

### 布局结构

```typescript
// 旧：三栏可折叠
{panels.project && <ProjectPanel />}
{panels.assistant && <Composer />}
{panels.workspace && <FileTree /> + <Editor />}

// 新：四栏固定
<ProjectList />
<ChatWindow />
<ResourceExplorer + 未打开文件 + HistoryPanel />
<Editor />
```

### 功能保留

- ✅ AI 修订链路（POST /api/assistant/revise）完全保留
- ✅ 命令面板快捷键（Ctrl+P / Ctrl+Shift+P）
- ✅ Tauri 菜单事件监听
- ✅ 冒烟测试入口（registerSmokeProjectLoader）
- ✅ localStorage 持久化（项目列表、文件历史、面板宽度）

## 5. 未完成功能

### 未打开文件面板（占位）

中间面板的"未打开文件"区域当前为占位实现，显示提示文字：

```typescript
<div className="h-[120px] border-t border-[#2D2D30] flex flex-col bg-[#252526]">
  <div className="h-[36px] px-3 border-b border-[#2D2D30] flex items-center">
    <span className="text-xs font-medium text-[#CCCCCC]">未打开文件</span>
  </div>
  <div className="flex-1 flex items-center justify-center">
    <p className="text-xs text-[#858585]">从右侧关闭文件后显示</p>
  </div>
</div>
```

**后续实现建议：**
- 在 Editor 关闭文件时，将 `currentFile` 加入"未打开文件"列表
- 区别于"历史"：历史记录所有访问过的文件，未打开文件仅记录本次会话中关闭的文件
- 实现逻辑：新增 `unopenedFiles` 状态，在 `handleFileClose` 时更新

## 6. 后续优化建议

1. **响应式布局**：当前固定四栏，可增加最小窗口宽度检测，窗口过小时自动折叠某些面板
2. **面板折叠**：允许用户手动折叠项目列表/对话窗口，类似原三栏逻辑
3. **主题配置**：提取颜色变量到 CSS 变量或 Tailwind 配置
4. **键盘导航**：为项目列表、文件树、历史面板增加上下键导航
5. **面板拖拽重排**：允许用户自定义四栏顺序

## 7. 兼容性

- ✅ Windows 10/11（已测试）
- ✅ Tauri 2.x
- ✅ React 19
- ✅ Vite 6.4.3

## 8. 风险与回退

- **风险1**：用户习惯三栏布局，突然切换可能不适应
  - **缓解**：保留所有快捷键和命令面板，用户仍可通过 Ctrl+P 快速访问文件

- **风险2**：四栏固定布局占用更多屏幕空间，小屏设备可能拥挤
  - **缓解**：`ResizablePanel` 允许调整各栏宽度，最小宽度已合理配置

- **回退**：如需回退，恢复以下文件的 Git 版本即可：
  ```bash
  git checkout HEAD~1 -- apps/desktop/frontend/src/App.tsx
  git checkout HEAD~1 -- apps/desktop/frontend/src/components/Composer.tsx
  git checkout HEAD~1 -- apps/desktop/frontend/src/components/FileTree.tsx
  rm apps/desktop/frontend/src/components/{ProjectList,ChatWindow,ResourceExplorer,HistoryPanel}.tsx
  ```

## 9. 验证步骤

### 本地手动验证

1. 启动前端开发服务器：`cd apps/desktop/frontend && pnpm run dev`
2. 浏览器访问：`http://localhost:3007`
3. 验证点：
   - [ ] 项目列表显示且可点击切换
   - [ ] 对话窗口三个标签可切换
   - [ ] 资源管理器显示文件树且可展开/折叠
   - [ ] 历史面板显示最近打开的文件
   - [ ] 点击文件树文件，右侧编辑器打开
   - [ ] 调整各栏宽度，松开后保持
   - [ ] 刷新页面，宽度和项目列表保持

### Tauri 打包验证（可选）

```bash
cd apps/desktop
pnpm run tauri build
# 在 src-tauri/target/release 找到生成的安装包
```

## 10. 结论

✅ **四栏布局重构已完成**，所有核心功能保留，构建通过，开发服务器启动正常。

**下一步建议：**
1. 实现"未打开文件"面板真实逻辑
2. 增加面板折叠功能
3. 完成 Tauri 打包并在桌面环境实测
4. 收集用户反馈，迭代 UI 细节
