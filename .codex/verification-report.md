# 验证报告 · dogfood 波2：预览页签可关 / 最大化可拖 / Monaco 滚条统一

时间：2026-07-18
分支：`fix/dogfood-wave2-20260718`
前置：波1 止血包已合并（PR #151）。本刀是 15 条清单四波推进的第二波。

## 问题与变更

### #5/#11 「只能单开一个文件」「双击了才能删」——preview 页签语义可发现性

- 根因不是缺多页签：单击 = 预览页签（覆盖式）、双击 = 固定页签本就是 VS Code 语义，
  但**预览页签没有关闭按钮**（必须先双击固定才关得掉），且 × 只在 hover 时可见。
- 修：`useEditorWorkspaceTabs` 增 `closePreview`（预览一旦变脏即自动固定，
  走到关闭时必是干净预览，直接丢弃无需确认）；预览 Tab 接 `onClosePreview`；
  激活页签的 × 常显（对齐 VS Code），非激活仍 hover 显。

### #2 「无法整体移动窗口」——最大化态拖拽静默无效

- Titlebar 拖拽实现本就存在（`startDragging()`），但 Windows 不允许拖动最大化
  窗口，`startDragging` 静默无效——真机常开最大化，感知就是「拖不动」。
- 修：drag 动作先 `isMaximized()` → `unmaximize()` 再 `startDragging()`，对齐
  原生/VS Code 手感；`tauri.conf.json` main-capability 补
  `core:window:allow-unmaximize` / `core:window:allow-is-maximized`。

### #7 「滚动条和左边不一样」「这小块是啥」——Monaco 滚条与 overview ruler

- Monaco 滚条是自绘（CSS 管不到），宽度默认 14px 与壳子 11px 细滚条不一致；
  thumb 颜色已由波1 storyforge 主题接管。修：verticalScrollbarSize /
  horizontalScrollbarSize = 11。
- 「这啥」小灰块定性：minimap 已关的正文场景，overview ruler 只剩一条竖线 +
  光标灰块，被误认成多余滚动条。修：`overviewRulerLanes: 0` +
  `overviewRulerBorder: false` + `hideCursorInOverviewRuler: true`；审稿 issue
  定位不受影响（靠 gutter 圆点与词级下划线）。

## 验证

- 前端 vitest 全量 `55 files / 288 passed`（新增：预览页签关闭按钮点击行为 1 例、
  标题栏最大化先还原再拖 + 非最大化直拖 1 例）。
- typecheck 绿；`pnpm lint` 0 errors + prettier 绿（仅 Editor.tsx 既有
  exhaustive-deps warning）。
- `cargo test fs::` 重编译通过（tauri.conf.json 新增两条 core:window 权限经
  tauri-build ACL 校验）。
- `pnpm verify` 全量门禁见 PR。

## 红线审计

- 后端零改动、OpenAPI 零漂移；无新写路径。
- closePreview 不弹放弃确认的前提有代码注释钉死（脏预览即时固定，预览必干净）。
- 暂存全部使用显式路径。

## 未验证项

- 真机观感归下次真机波：最大化拖拽还原跟手感、预览页签 × 观感、Monaco 滚条
  与壳子滚条并排一致性、overview ruler 移除后小灰块确认消失（若真机仍见灰块，
  则来源另查——候选是面板分隔条 hover 手柄）。
