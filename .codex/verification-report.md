# 验证报告 · 借苹果的设计立场，落成六条可证伪的约束

时间：2026-07-30

> **提名口径说明**：作者原话——「苹果的设计审美很不错 有什么我可以借鉴的吗」，随后
> `/goal 做1到6`。属作者显式指定的六项，不是主动打磨波，也覆盖了 2026-07-26「编辑器停
> 主动打磨波、每周至多一刀」那条自定规矩——该规矩已在答复里显式提示过，作者选择全做。

## 先说不该做的：已经很苹果的部分不重做

摸查现有 token 系统后的第一个结论是**克制**：单色语义梯度、只留一个「金子色」（iris 给
agent）、发丝描边而非重投影、滚动条平时收起、`prefers-reduced-motion` 全局降级、
`:focus-visible` 焦点环——这些正是苹果克制感的来源，本波一条没动。

真正缺的是**尺子**：圆角与字号都不是阶梯，而是按需微调出来的连续谱。

## 六刀与对应 PR

| # | 刀 | PR | 性质 |
| --- | --- | --- | --- |
| ② | 圆角收成同心阶梯 | #241 | 机械收敛 + 护栏 |
| ① | 字号收成八档阶梯、字距挂档位、修 UI 字体两条栈打架 | #241 | 含一个真 bug |
| ③ | 壳子在作者写字时退场 | #242 | 新行为 |
| ④ | 接受建议改为落位而非硬切换 | #242 | 新行为 |
| — | 补上接受的重入闸 | #244 | **#242 自带回归，我引入的** |
| ⑤ | 写回后一键撤销 | #243 | 新行为（红线不动） |
| ⑥ | Win11 Mica 窗口材质 | #245 | 观感最抓眼、验证最不足 |

## 顺手逮到的三个真缺陷

1. **`body` 与 `--font-ui` 两条栈打架**（#241）。`body` 硬编码了一条与 `--font-ui` 不同的
   字体栈（多 Roboto/Arial、少 Microsoft YaHei UI/PingFang SC），全站 UI 实际继承的是
   `body` 那条，`--font-ui` 只在两个内联浮层生效——token 形同虚设。
2. **补丁面板的只读 diff 只同步了字号与字体**（#241）。行高吃 Monaco 默认 ≈1.35×、字距为
   0，而主编辑器是 1.9× + 书稿字距：同一段稿子逐字核对时两种呼吸节奏。
3. **接受建议的双写窗口**（#244，自己引入自己逮）。#242 把落位动效插在 `teardown()` 之前，
   `teardown()` 从「同步先跑」变成「`await` 之后才跑」，那 170ms 里接受键与 Alt+Enter 都
   还能再次触发 `applyAccepted`——两次触发各走一遍守卫写回，同一补丁写两次盘。

## 两处不照搬、改打法

- **⑤ 不动「未确认不写盘」红线。** 苹果的做法是避开 modal、先做再给 Undo；但该红线写在
  `CLAUDE.md` / `README.md` / `ide-first-product-direction.md` / `TODO.md` 四处，并由
  `src-tauri/src/main.rs:1104-1111` 的 smoke 断言守着。改成直接写回会一次性打爆四处文档承诺
  和那条 smoke。所以本刀降的是**接受之后**反悔的成本：从「翻版本历史 → 恢复进缓冲 → 再手动
  保存一次」变成一次点击。撤销本身也走 `performGuardedWriteback`，不从后门绕开 F27。
- **⑥ 不走 `tauri.conf.json` 的 `windowEffects`。** 那条路在 tauri 内部把每个 `apply_*` 的
  `Result` 都 `let _ =` 吃掉，成败无从得知；而 `transparent: true` 会把 WebView2 背景强制
  清零，材质没挂上又让出画布就等于给 Win10 用户一个透明的应用。改成 Rust 直调
  `window_vibrancy::apply_mica` 拿真 `Result`，前端据此决定要不要启用透明。

## 命令与输出

```
npm --prefix apps/desktop/frontend run test        -> 76 files / 479 passed
npm --prefix apps/desktop/frontend run typecheck   -> 绿
pnpm.cmd lint                                      -> 绿（eslint + prettier）
node scripts/run-e2e.mjs                           -> 契约门禁 20 pass / 0 fail
cd apps/api && uv run pytest -q                    -> 1257 passed, 3 skipped (261s)
cd apps/api && uv run pytest tests/test_source_code_standards.py -q -> 16 passed
cd apps/desktop/src-tauri && cargo check           -> 绿
OpenAPI 漂移                                        -> 无漂移（后端零改动）
```

新增护栏 23 条，分布：`radius-scale`(4) `type-scale`(5) `shell-deference`(5)
`window-material`(4) `undo-writeback`(4) + `inline-chat` 落位时长/重入闸(2)。

## 变异验证（测试是否打在接线上）

七个变异逐个植入并重跑，**全部被逮红**：

| 变异 | 打掉的行为 | 结果 |
| --- | --- | --- |
| 圆角 | 一处 `text-3xs` 改回 `text-[10.5px]` | RED |
| 圆角（**非人为**） | 护栏首次运行即红，逮出此前 grep 漏掉的 40 处裸 `rounded` | RED |
| 字号 | 同上（越界任意值） | RED |
| 退场 | 往退场规则塞 `display: none` | RED |
| 落位 | CSS 过渡改 300ms、与 `INLINE_SETTLE_MS` 脱钩 | RED |
| 撤销 | 陈旧闸换成 `false`（撤销会吃掉作者新输入） | RED |
| 材质 | 一条规则的闸从 `[data-window-effect='mica']` 降成 `[data-window-effect]` | RED |
| 重入 | 把重入闸挪到 `playAcceptSettle` 之后（真实的重入窗口位置） | RED |

其中圆角那条特别值一提：**它是在写出来的那一刻先红的**，抓出我自己前一次 grep（模式要求
`rounded-` 后必须跟字符）漏掉的 40 处裸 `rounded`——是真找到东西，不是事后补的绿灯。

## 自身失误留痕

两次 `;` 串联的 `git checkout <file>` 把同一批未提交改动一起回退：第一次冲掉 `index.css`
的字号 token（重做），第二次冲掉重入闸（重做）。变异验证的还原一律改用带
`assert count == 1` 的 python 定点替换，不再用 `git checkout` 还原工作区。

## 未联通能力（不得宣称）

- **⑥ Mica 真机观感完全没看过。** 透明度档（活动栏 0.4 / 面板 0.62）是纸面选值。
- **⑥ 的 `visualTone` 断言在本机根本没跑到。** `node apps/desktop/scripts/verify-tauri-smoke.mjs`
  挂在「初始欢迎工作区不可见」——本机持久化会话打开着 `D:\连载\末世吞噬`，欢迎页不渲染，
  `visualTone` 返回 `null`。**已在 master 上复跑确认是既有环境问题、与本波无关**，但也意味着
  我对该断言的规避只有 CSS 护栏作证、没有 smoke 作证。
- **⑥ tauri 官方警告未验**：`decorations: false` + `shadow`（默认 true）+ 窗口效果这个组合
  官方标注可能出 1px 白边 / 阴影异常，本仓库正落在里面。
- **③ 退场节奏未调手感**：1.6s 空闲、0.42 不透明度、420ms 淡出全是纸面值。
- **④ 落位路径无单测覆盖**：Monaco stub 没实现 `changeViewZones` / `createDecorationsCollection`，
  整个 diff 渲染路径在测试里不执行；落位与重入闸都只有结构不变量作证，要真机点穿。
- **① 48 处站点的行高变化需眼看**：从任意值迁到 `text-xs`/`text-sm` 的站点会拿到档位自带的
  行高（此前继承父级），13/15px 并入 14px。
- **未重建 NSIS**：作者机器上的装机版仍是 0.1.9，本波六刀一条都看不到。要送达须 bump 到
  0.1.10 + `pnpm desktop:build`（不能用 `tauri build`，后者静默打旧 sidecar）。
