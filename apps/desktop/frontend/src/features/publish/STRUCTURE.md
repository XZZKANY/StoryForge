# publish feature 结构（维护入口）

发行能力**只住在本目录**。壳层（ActivityBar / SidePanel / CommandPalette / App）只做挂载与转发。

```
features/publish/
  index.ts              # 对外唯一导出
  commands.ts           # 命令总线 + 命令面板条目生成
  STRUCTURE.md          # 本文件
  hooks/
    usePublishCockpit.ts  # 全部状态与业务动作
  views/
    PublishCockpit.tsx    # 壳布局（薄）
    tabs.tsx              # 各 Tab UI
    ui.tsx                # Stat / BookRow 等零件
    types.ts              # TabId
  model/                  # 纯函数领域（可单测）
  storage/                # 本地读写
  packs/                  # 平台规则包
  assist/                 # L2 向导 / 外链打开
```

## 壳层约定

| 位置 | 职责 |
| --- | --- |
| `SidePanelView = 'publish'` | 左栏入口 |
| `SidePanel` | 渲染 `<PublishCockpit variant="sidebar" />` |
| `CommandPalette` | 调用 `buildPublishPaletteCommands`，不手写命令表 |
| `App` | `openPublishSide` + `emitPublishCommand` |

## 不要

- 在 `App.tsx` / 其它 feature 再写发行业务逻辑
- 再做一个中栏整页发行（已废弃 `publishVisible`）
- 逆向平台后台 / Cookie 抓数
