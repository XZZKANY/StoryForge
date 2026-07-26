# 验证报告 · 桌面端 UIUX 五刀（破承诺 / 死码 / 恢复现场 / 全文搜索 / 错误态）

时间：2026-07-26
分支（均已合并 master，最终 `76292413`）：

| PR | 分支 | 主题 |
| --- | --- | --- |
| #200 | `fix/desktop-broken-promises` | 界面印出来的承诺必须兑现 |
| #201 | `chore/desktop-dead-code` | 清死码 |
| #202 | `feat/restore-workspace-session` | 写作时刻 01「恢复现场」 |
| #203 | `feat/project-fulltext-search` | 正文全文搜索 Ctrl+Shift+F |
| #204 | `fix/panel-error-states` | 错误态说人话 |

> **提名口径说明**：本波同样不是真实写作摩擦提名，是作者在「写作优先」拍板后要求的主动
> UIUX 优化波（作者原话：优化整个桌面端的 uiux）。如实记一笔，不冒充宪法 §08 的每周一刀。
> 与前一波（#196-#199）的区别：本波的选题不是观感偏好，而是先做了一次全量 UI 面盘点，
> 只取「UI 声明了但做不到」「宪法 §06 写作时刻结构性为零」两类。

## 盘点结论（决定为什么是这五刀）

前三波（UIUX 审计 80 条 #159-#177、dogfood 九问六批 #186-#193、观感三刀 #196-#199）
已把观感层挖得很薄；`index.css` 的语义 token、明暗双主题、`:focus-visible`、
`prefers-reduced-motion`、统一滚动条也早已到位。再做一次「找粗糙边」性价比很低。

改按宪法 §06 八个写作时刻对齐，剩下的洞不是装饰性的：**01 恢复现场结构性为零**、
**全局搜索（B 轴能力 + §07 离线底线明列）未绑定**、以及一批「界面说了但做不到」。

## 刀 1 · 破的承诺（PR #200）

六处 UI 主动声明了能力、但那条路根本走不通：

- **Ctrl+O 死键**。速查表与欢迎页两处都印着「Ctrl O 打开项目」，`App.tsx` 的 keydown 里没有
  `o` 分支。挖出根因：`main.rs` 的 `mod menu;` 是 **`#[cfg(test)]` 门控**的 —— `menu.rs`
  只进测试构建，装机 exe 里根本不存在；且 `create_menu` / `set_menu` 从未被调用，
  `decorations:false` 下 Windows 没有窗口框可挂菜单栏。三重不可达。
- **状态栏「观测清单」在对话聚焦布局（Ctrl+3）下点了没反应** —— ObsPanel 挂在中栏内，
  而该布局给中栏加了 `hidden`。改为开面板前先落回可见布局。
- **「…」菜单「剧情分支画布」通向一堵「仍在开发中」占位墙**，占位文案自己都在让用户改去
  「版本历史」。删菜单项与占位墙，连带 `rightView` 状态机、`toggle-branch-view` 一起收掉。
  真正的分支图仍在 版本历史 → 分支图，未受影响。
- **原生菜单死链**：删 `src-tauri/src/menu.rs`（178 行），`useTauriMenuBridge` 五个 `menu:*`
  监听永不触发，其中两个还去点 Q3a 已删除的 `#editor-save-btn` / `#editor-close-btn`。
  保留 `smoke:reset-panels` 一条 `listen` 往返，装机冒烟断言的 `data-tauri-menu-ready`
  语义由此维持（`main.rs:728/782/934` 固化了该属性名，故不改名）。
- **版本历史抽屉 36px 残留偏移**：`top` 取 `--sf-bar-height`，但其定位祖先已在页签行之下，
  该偏移原是为让开 Q3a 已删的编辑区工具行。
- **设置左栏 ◈ ◐ ▤ ⓘ 四个 Unicode 字形换 Lucide**（与全站唯一图标源割裂，而那个模块的存在
  理由正是「取代旧的 Unicode/字形图标」）。

**防复发**：速查表提取为单一事实源 `components/app/shortcuts.ts`，每行必须标注在哪儿被接管
（不填 `needs`/`scope` = 全局无条件），护栏 `tests/shortcuts.test.tsx` 对每条全局键**真按一遍**
断言 `preventDefault`。补齐此前漏印的 Ctrl+Shift+O / Ctrl+S / Ctrl+K / Ctrl+W。

> **自伤记录**：删 `mod menu;` 时留下的 `#[cfg(test)]` 属性下移去门控了 `mod watcher;`，
> 把实时文件监听变成测试专属。`cargo check` 逮到，已修。

## 刀 2 · 清死码（PR #201）

净 **−629 行**，零用户可见变化。逐项验证零引用后删：

- 三个孤儿组件 `HistoryPanel.tsx` / `ProjectPanel.tsx` / `app/icons.tsx`。
- `recentFiles` **纯写不读**：`HistoryPanel` 是唯一消费者，面板下线后仍在维护状态、
  写 `RECENT_FILES_KEY`、启动时校验磁盘存在性 —— 全部喂给没有人。
- 不可达分支：EditorTabs 设置页签（`settingsOpen` 被 AppShell 写死 `false`）、
  ResourceExplorer `showHeader`/`collapsed`（唯一调用方传 `false`）。
- 13 条死 CSS（`index.css` −1974 字节）。
- **一个空转的断言**：`WelcomeWorkspace` 用了 `class="icon-button"`，该类在 `index.css` 和
  `tailwind.config.js` 里都没有定义；而 `tests/app-icons.test.tsx` 一直在断言这个字符串。
  断言一个无定义类名等于什么都没测，且会阻止任何人删掉它。改断言真实存在的 `welcome-close`。
- 两处 `@deprecated`、`helpers.ts` 三个零引用导出、图标桶六个零引用再导出 + 过期命名对照表。

## 刀 3 · 恢复现场（PR #202，宪法 §06.01）

此前只持久化「最近项目 / 最近文件」两个列表 —— 那是入口不是现场。现恢复：
活动项目、页签集合、活动页签、每文件光标位置（滚到视野中央）；观测「已处理」勾选按项目落盘。

三个不显然处：

1. **恢复落地之前不许回写**。启动瞬间 `openFiles` 还是空的，此刻落盘等于抹平现场，
   且原始存档已被自己覆盖、无从找回。用 `idle → restoring → done` 三段 phase 挡住。
2. **页签恢复 effect 必须声明在「项目切换清预览态」之后** —— 同依赖下 effect 按声明序执行。
3. **磁盘校验在恢复之前**；校验本身出错时保守保留（瞬时 IO 失败不该吃掉现场）。

新增设置「启动时恢复上次现场」（默认开）。

## 刀 4 · 正文全文搜索（PR #203，宪法 B 轴 + §07 离线底线）

`Ctrl+Shift+F` 此前未绑定。与命令面板分工：命令面板搜**文件名**，此处搜**正文内容**。
PR #171 删掉的那个左栏搜索是未接线死占位且与命令面板重复，本刀不是把它加回来；
`app.test.tsx` 断言相应改为「搜索图标必须对应一个真实渲染的搜索面板」。

走前端 + `readProjectFile`（Rust 侧带 containment 校验，PR #118），不加 Rust 命令、不需重打包。
限并发 8、边搜边出、seq 取消、单文件封顶 40 / 全局封顶 400 且**明说**已达上限（不静默截断）。

**本领域特有的坑**：小说 `.md` 的一行往往是一整个自然段（几百上千字），故结果是
命中处附近的**窗口片段**，高亮 `start`/`end` 相对片段而非原行 —— 该偏移算错时在短文本
用例里根本测不出来，专门用 600 字长段落用例钉死。

> **自伤记录**：`SearchView` 最初用 `autoFocus`，但左栏三视图是 CSS 互斥、**常驻挂载**的，
> `autoFocus` 只在初次挂载触发 → 实际效果是「应用一启动就把焦点从编辑器抢走」。改为按
> `active` 变化落焦。

## 刀 5 · 错误态说人话（PR #204）

文件树 / 故事索引 / 版本历史三处把原始 error 整条铺出来当标题，且都没有重试路径；
编辑器构建失败更是只写 `data-editor-init-error` 属性、界面全空白。

新增 `shell/PanelError`：**人话标题 + 明确下一步（有重试就给按钮）+ 原始报错降级为细节**。
原始报错不隐藏（排障唯一线索），但不占标题位。读版本失败 / 编辑器起不来两处措辞刻意先回答
「稿子还在不在」。护栏 `tests/panel-error.test.tsx` 按 `indexOf` 比较标题与细节的先后位置。

## 可证伪性实测

新增的三个护栏都做了「摘掉修复 → 断言必须变红」的实测，不是只看绿：

| 护栏 | 摘掉什么 | 实测结果 |
| --- | --- | --- |
| `tests/shortcuts.test.tsx` | `App.tsx` 的 Ctrl+O 分支 | 变红：`速查表印着「Ctrl O 打开项目」，但按下去 App 没有接管（未 preventDefault）` |
| `tests/workspace-session.test.tsx` | `useSessionRestore` 的 `if (phase !== 'done') return;` | 变红：`恢复尚未落地时回写必须被挡住，存档不能被空现场覆盖` |
| `tests/project-search.test.ts` | —（用 600 字长段落用例覆盖短文本测不出的偏移错误） | 见上文说明 |

## 门禁（最终 master `76292413`）

```
npm --prefix apps/desktop/frontend run typecheck   绿
npm --prefix apps/desktop/frontend run test        62 文件 / 354 通过（基线 58 / 331，+4 文件 +23 用例）
pnpm.cmd lint                                      绿
pnpm e2e                                           20/20 通过（含 OpenAPI 快照一致）
cd apps/api && uv run pytest tests/test_source_code_standards.py tests/test_api_surface.py   19 通过
cd apps/desktop/src-tauri && cargo check           绿
cd apps/desktop/src-tauri && cargo test            18 通过
```

## 未联通 / 归 E2E-1 真机

- 本波全部真机观感未验：恢复现场（重启后页签与光标是否真回到位）、全文搜索在几百章项目上的
  手感与耗时、`PanelError` 各态在真实失败下的措辞是否够用、Ctrl+O / Ctrl+Shift+F 在装机 exe 上
  的实际键位、版本历史抽屉贴顶后的观感。
- `menu.rs` 删除后装机 exe 的冒烟需重跑 `pnpm smoke:sidecar:packaged` 确认
  `data-tauri-menu-ready` 仍为 true（本机未重打包，仅 `cargo check` / `cargo test` 绿）。
- 全文搜索未做索引缓存：每次查询重读全部 `.md`。当前项目规模下可接受，长篇累积后需重评。
- 恢复现场不恢复预览页签（预览态按设计是临时的），也不恢复滚动像素位置（只恢复光标行并居中）。
