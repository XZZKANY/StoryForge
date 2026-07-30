# 验证报告 · 左栏贴合写作顺序，并给「作品」一张脸

时间：2026-07-30

> **提名口径说明**：作者原话——「我想优化流程 就是 让左边的贴合写作顺序? 创建作品 封面 介绍
> 然后开始创作 创作途中 左边也要有一些功能能用」。属真实写作流程提名，不是主动打磨波。
> 方向性取舍（档案形态 / 视图顺序 / 封面深度 / 创作途中要哪些）已逐条问过作者并按其选择实施。

## 诊断：这不是「重排一下顺序」

摸查后左栏的落差比「顺序不对」更深一层：

| 作者说的环节 | 仓库现状 |
| --- | --- |
| 创建作品 | 无向导。欢迎页「一句话开新书」取首句前 16 字当**目录名**（`initialize.ts:113`），建 7 个中文目录 |
| 封面 | **不存在**。全仓搜 `封面\|cover\|synopsis\|genre` 在桌面端零命中，唯一图片是产品 logo |
| 介绍 | **不存在**。`.storyforge/` 下只有 canon/versions/notes，没有任何作品级元信息文件 |
| 创作途中 | search / manuscript / observatory 都在，但活动栏按**工具类型**排（`ActivityBar.tsx:20`），读不出写作顺序 |

也就是说：**一本书在 IDE 里的全部身份就是它的目录名**。后端 `Book.title/premise` 属另一条
SaaS 血脉，桌面端 `book_id`/`premise` 搜索零命中，两条血脉不通。

## 改了什么

### 一、作品档案数据层（新）

`.storyforge/book.json`，与 canon.json 同级同权，作者可直接打开手改：

- 容错解析到底：坏 JSON / 缺字段 / 类型写错一律逐字段降级，不整份丢弃——档案是作者随手能编辑的
  文件，为一个多余的逗号把左栏打空等于惩罚手改；
- `title` 允许空串，空即回落目录名。这样「没起过名」（跟着目录改名走）与「名字恰好等于目录名」
  （作者的显式选择）可区分；
- 派生数据（章数、总字数）**一概不落盘**，每次现算，不多出一份会过期的假事实。

「一句话开新书」时把那句话落进 `synopsis`，作者点开左栏不是一张空表。

### 二、封面（Rust 两条命令）

- `copy_into_project`：把项目**外**的图复制进来。8MB 上限（base64 膨胀 4/3，超了走 IPC 肉眼卡）、
  走与 `write_file` 同一套 containment + 原子替换，中途失败不留半张图；
- `read_project_file_base64`：走 `read_project_file` 同一套真实路径校验，项目内 symlink 指向
  外部大文件也拿不出来。

走 base64 data URI 而非 asset 协议：后者要改 CSP 与 assetProtocol scope，为一张封面打开一条
通用的本地文件读取通道不划算。导入是**复制**不是引用外部路径——作者挪目录、换机器，封面得跟着走。

### 三、左栏「作品」视图 + 按写作顺序重排

视图顺序改为 **作品 → 手稿 → 资源管理器 → 搜索 → 观测镜**（立项 → 写哪一章 → 翻文件 → 回头查
→ 校事实）。顺序在 `SIDE_PANEL_VIEWS` 与 `VIEW_ENTRIES` 两处，用护栏逐项钉死。

视图内含作者点名的三样「创作途中」：全书 / 今日双进度条、大纲一键跳转（按文件分组 + 缩进层级）、
灵感速记（落项目根 `灵感.md`，三种 markdown 列表写法都认，作者手写的普通列表天然被识别）。

**默认落点仍是资源管理器**——顺序是排列顺序不是默认视图，日常写作的肌肉记忆不动。

### 四、复查中发现并修掉的两个自身缺陷

1. **空档案覆盖磁盘**（较严重）：档案读盘期间 `profile` 仍是空档案，此时点封面会 `save` 这份空
   档案，把磁盘上已有的书名简介**清空写回**。已让读盘期间整个档案区停用。
2. **半个书名丢失**：书名敲到一半去点封面 / 加题材，未提交的编辑会丢。现在任何一处写盘都带上
   「此刻的档案」= 已落盘档案 + draft 里未提交的内容；`pickCover(current)` 由视图交出这份档案，
   而不是 hook 自己去读最新 profile。

## 验证命令与输出

```
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml fs::
  -> 21 passed（含 3 个新增：封面导入 / 目标越界被拒 / base64 编码与外部路径被拒）

npm --prefix apps/desktop/frontend run typecheck   -> 通过
npm --prefix apps/desktop/frontend run test        -> 71 files, 454 passed（新增 34）
pnpm.cmd lint                                      -> eslint + prettier 全绿

pnpm.cmd verify
  API pytest        -> 1257 passed, 3 skipped (273.72s)
  API Ruff          -> All checks passed
  sidecar-smoke     -> daily 档全绿（/health/ready 4836ms、SSE 2 帧、alembic managed=true）
  OpenAPI 漂移      -> 无漂移（后端零改动）
```

## 变异验证（测试是否打在接线上）

七个变异逐个植入并重跑前端测试，**全部被逮红**，无一逃逸：

| 变异 | 打掉的行为 | 结果 |
| --- | --- | --- |
| A1 | 删掉点封面前的 `commit()` | RED (1) |
| A2 | 把旧 `profile` 而非 `merged()` 交给封面流程 | RED (1) |
| B | `SIDE_PANEL_VIEWS` 顺序与活动栏漂移 | RED (1) |
| C | `bookGoalProgress` 返 0 而非 null（会画一条永远 0% 的条） | RED (3) |
| D | 大纲标题行号偏一（每次跳转晚一行） | RED (2) |
| E | 速记回写不再守非列表行（正文会被改写成待办） | RED (1) |
| F | 读盘期间封面槽仍可点 | RED (1) |

## 顺带修掉的自身失误

`useShellState.ts` 一度被写成 CRLF，造成 183 行假 diff（真实改动 12/3）。真凶是变异脚本用
`Path.write_text` 在 Windows 下默认把 LF 转 CRLF；脚本已改为 `write_bytes`，并对全部改动文件
做了行尾核对（`git diff --numstat` 与 `--ignore-all-space --numstat` 逐文件一致）。

## 未联通能力（不得宣称）

- **真机 GUI 未验**：封面选图对话框、导入后的显示、左栏新顺序的桌面观感、`.storyforge/book.json`
  在装机版的读写，全部只有 headless 与单测证据，归 E2E-1 真机清单。
- **未重建 NSIS**：本刀合并后作者机器上的装机版仍是 0.1.9，看不到这些改动。要送达须 bump + 重建
  （`pnpm desktop:build`，不能用 `tauri build`）。
- 封面无「移除」入口（只能更换）；最近项目列表仍是纯路径字符串，未富化为封面 + 进度卡片——
  两项均为本刀刻意不做，非缺陷。
- 作品档案与后端 `Book.title/premise` 仍不通，本刀未碰那条血脉。
