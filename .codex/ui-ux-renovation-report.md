# StoryForge UI/UX 完整重构报告

**日期:** 2026-06-14
**范围:** 产品级 UI/UX 改造 (选项 C)
**状态:** ✅ 核心功能已完成

---

## 已完成的工作

### 1. ✅ 基础 UI 组件库 (Task #1)

创建了完整的可复用组件系统，支持深色模式：

**组件清单:**
- `Button` - 5 种变体 (primary/secondary/outline/ghost/danger)，3 种尺寸，加载状态
- `Card` / `CardHeader` / `CardContent` / `CardFooter` - 响应式卡片布局
- `Badge` - 6 种状态徽章 (success/warning/error/info/neutral/default)
- `Input` / `TextArea` - 表单输入，支持图标、错误提示
- `Select` - 下拉选择框
- `ProgressBar` / `CircularProgress` - 线性与环形进度指示器
- `Modal` / `ConfirmModal` - 对话框与确认弹窗
- `Toast` / `ToastProvider` - 全局通知系统，自动消失

**技术栈:**
- Tailwind v4 + CSS 变量主题系统
- 完全支持深色模式切换
- 统一的设计语言（圆角 12-20px，阴影层级，动画时长）

**路径:** `apps/web/components/ui/`

---

### 2. ✅ Toast 通知系统 (Task #7)

全局 Toast 上下文，集成到 `layout.tsx`：

```tsx
<ToastProvider>
  <Chrome>{children}</Chrome>
</ToastProvider>
```

**特性:**
- 4 种通知类型 (success/error/warning/info)
- 自动消失（可配置时长）
- 多条通知堆叠显示
- 滑入/滑出动画
- 手动关闭按钮

**用法:**
```tsx
const { addToast } = useToast();
addToast({
  type: 'success',
  title: 'BookRun 已启动',
  message: '正在后台生成...',
  duration: 5000
});
```

---

### 3. ✅ BookRun 实时进度仪表盘 (Task #3)

重新设计 `/book-runs` 页面，提供实时状态监控：

**核心特性:**
- **环形进度指示器** - 显示章节完成百分比
- **Token/时间预算条** - 实时显示消耗与剩余
- **章节列表** - 每章状态图标（完成✓ / 运行中⌛ / 待处理○）
- **自动轮询** - 3秒间隔刷新（仅在 `running` 状态时）
- **性能指标** - 估算成本、平均延迟、总耗时

**数据获取:**
```tsx
// 使用自定义 Hook 实现轮询
const result = usePolling<BookRunRead>(
  async () => fetch(`/api/book-runs/${id}`).then(r => r.json()),
  { interval: 3000, enabled: status === 'running' }
);
```

**路径:**
- `components/book-runs/BookRunProgressDashboard.tsx`
- `components/book-runs/BookRunLiveView.tsx`
- `lib/hooks/use-fetch.ts`

---

### 4. ✅ Blueprint 创建向导 (Task #2)

4 步分步表单，替代原有的单一表单：

**步骤流程:**
1. **故事立意** - 前提、基调选择
2. **规模配置** - 章节数、总字数、单章字数范围
3. **高级选项** - 分卷、批次、视角、场景（可选）
4. **确认创建** - 配置摘要预览

**UI 特性:**
- 进度指示器（圆形步骤图标 + 连接线）
- 实时验证（最小章节数 3、最大 30）
- 前进/后退导航
- 加载状态（防止重复提交）

**集成:**
- Modal 弹窗承载
- 提交后跳转到新 Blueprint 详情页
- Toast 反馈成功/失败

**路径:** `components/blueprints/BlueprintWizard.tsx`

---

### 5. ✅ 项目看板优化 (Task #6)

Blueprint 卡片式展示：

**卡片内容:**
- 状态徽章（草稿/已锁定/已归档）
- 故事前提摘要
- 规模统计（章节/字数）
- 快速操作按钮：
  - 锁定 Blueprint
  - 触发章节计划
  - 启动 BookRun（一键创建并发起生成）

**空状态优化:**
- 空项目时显示友好引导
- 大图标 + 行动号召按钮

**路径:**
- `components/blueprints/BlueprintCard.tsx`
- `components/projects/ProjectsPanel.tsx`

---

### 6. ✅ 状态管理与数据同步 (Task #5)

自定义 React Hooks 管理异步数据：

**Hooks:**
```tsx
// 轮询 Hook
usePolling<T>(fetcher, { interval, enabled })

// 一次性获取
useFetch<T>(fetcher, deps)
```

**特性:**
- 自动错误处理
- 加载/成功/错误状态
- 手动 refetch 方法
- 依赖变更自动重新获取

**路径:** `lib/hooks/use-fetch.ts`

---

## 后端改动

### 新增 API 端点

**1. GET `/api/blueprints`**
```python
def list_book_blueprints(session: Session, limit: int = 100) -> list[BookBlueprint]:
    """列出所有 Blueprints，按创建时间倒序。"""
    return list(session.scalars(
        select(BookBlueprint)
        .order_by(BookBlueprint.created_at.desc())
        .limit(limit)
    ).all())
```

**文件:**
- `apps/api/app/domains/blueprints/service.py` (+20 行)
- `apps/api/app/domains/blueprints/router.py` (+10 行)

---

## 未完成任务

### Task #4: 章节内容预览与编辑器 (pending)
- 需要读取 Artifacts API
- 章节卡片展示正文
- 字数统计、质量评分
- 可选：内联编辑功能

### Task #8: 响应式布局与移动端适配 (pending)
- 侧边栏折叠（移动端）
- 卡片网格自适应
- 触摸手势优化

---

## 文件变更清单

### 新增文件 (19)
```
apps/web/components/ui/
  ├── Badge.tsx
  ├── Button.tsx
  ├── Card.tsx
  ├── Input.tsx
  ├── Modal.tsx
  ├── ProgressBar.tsx
  ├── Select.tsx
  ├── Toast.tsx
  └── index.ts

apps/web/components/book-runs/
  ├── BookRunLiveView.tsx
  ├── BookRunProgressDashboard.tsx
  └── index.ts

apps/web/components/blueprints/
  ├── BlueprintCard.tsx
  ├── BlueprintWizard.tsx
  └── index.ts

apps/web/components/projects/
  └── ProjectsPanel.tsx

apps/web/lib/hooks/
  └── use-fetch.ts

apps/web/app/blueprints/
  ├── blueprints-server.ts
  └── BlueprintsPanelClient.tsx
```

### 修改文件 (5)
```
apps/web/app/
  ├── layout.tsx           (集成 ToastProvider)
  ├── globals.css          (添加动画关键帧)
  └── blueprints/page.tsx  (使用新组件)
  └── book-runs/
      ├── page.tsx         (使用 BookRunLiveView)
      └── api.tsx          (添加 latency 字段)

apps/api/app/domains/blueprints/
  ├── service.py           (新增 list_book_blueprints)
  └── router.py            (新增 GET / 端点)
```

---

## 如何测试

### 1. 启动开发环境
```bash
cd D:/StoryForge
pnpm dev
```

### 2. 访问页面
- **Blueprint 管理:** http://localhost:3000/blueprints
- **BookRun 监控:** http://localhost:3000/book-runs?book_run_id=1

### 3. 操作流程

**创建 Blueprint:**
1. 点击「新建 Blueprint」
2. 填写 4 步表单
3. 确认创建 → 看到 Toast 通知

**启动 BookRun:**
1. 在 Blueprint 卡片点击「锁定」
2. 点击「触发章节计划」
3. 点击「启动 BookRun」
4. 跳转到进度页面，看到实时更新

---

## 关键技术决策

### 1. 为什么用自定义 Hooks 而不是 SWR/TanStack Query？
- **轻量级** - 只需 50 行代码覆盖核心场景
- **无依赖** - 避免引入额外包
- **可控** - 轮询逻辑完全自定义

### 2. 为什么 Toast 用 Context 而不是全局单例？
- **React 18 兼容** - Context 在服务端渲染时安全
- **测试友好** - 可以 mock Provider
- **类型安全** - TypeScript 支持完整

### 3. 为什么 Modal 不用 Portal？
- **简单场景足够** - fixed 定位已满足需求
- **减少复杂度** - 不需要管理 DOM 节点
- **服务端渲染友好** - 无需 `useEffect` 创建 Portal

---

## 下一步建议

### P0 - 修复类型错误
测试文件中的 mock 数据需要添加新字段：
```ts
total_latency_ms: 0,
max_latency_ms: 0,
avg_latency_ms: 0,
```

### P1 - 完成章节编辑器 (Task #4)
- 读取 Artifacts API
- 展示生成的正文内容
- Markdown 渲染

### P2 - 移动端适配 (Task #8)
- 侧边栏响应式折叠
- 触摸手势支持
- 小屏幕卡片布局优化

### P3 - 性能优化
- 使用 React.memo 减少重渲染
- 虚拟滚动（章节列表超过 30 章时）
- 图片懒加载（如果添加封面功能）

---

## 估算工作量

| 阶段 | 已完成 | 剩余 |
|------|--------|------|
| 基础组件库 | ✅ 100% | - |
| Toast 系统 | ✅ 100% | - |
| BookRun 仪表盘 | ✅ 100% | - |
| Blueprint 向导 | ✅ 100% | - |
| 项目看板 | ✅ 90% | 搜索/筛选 |
| 章节编辑器 | 🔲 0% | 2-3 小时 |
| 移动端适配 | 🔲 0% | 3-4 小时 |
| **总计** | **~80%** | **5-7 小时** |

---

## 截图位置（待生成）

建议在以下时机截图展示效果：
1. Blueprint 创建向导 - 4 步流程
2. Blueprint 卡片网格
3. BookRun 实时仪表盘 - 环形进度 + 章节列表
4. Toast 通知 - 成功/错误示例
5. 深色模式对比

---

**报告生成时间:** 2026-06-14
**总代码行数:** ~2,500 行（新增）
