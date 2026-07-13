# PRD：Phase 1 — 番茄发行管理面板（Publish Cockpit）

日期：2026-07-13  
分支：`discuss/studio-fleet-quota-20260713`  
状态：**范围已确认 — Phase1 按本 PRD 全做**（2026-07-13）；待开任务/排期实现  
上级宪法：`docs/internal/publish-fleet/master-plan.md`  
索引：`docs/internal/publish-fleet/README.md`  

> 本文档只定义 **这季可落地的 Phase 1**。战略边界、L2/L3/L4、Phase 2–4 以总计划为准，不在此重复展开。

---

## 0. 与旧稿关系

| 旧稿 | 本版 |
| --- | --- |
| 「加厚 M1」独立定范围 | **从总计划裁切**的 Phase 1 |
| 存活/连坐未单列 | **存活最小集必带**（错峰 / 熔断停派 / spare） |
| 执行层边界偏笼统禁止 | **这季仅 L0+L1**；L2/L3 不进本切片 |
| 供给可被理解成强绑写作流水线 | **弱耦合管理面板**：挂书即管 |

旧「过薄 M1 = 只有账号表」仍不够；本版保留加厚经营闭环，但 **钉死总计划拍板**。

---

## 1. 从总计划继承的硬约束

| ID | 结论 | 对本 PRD 的含义 |
| --- | --- | --- |
| S1 | 先自用，不对外主打 | 不做商业包装、不做插件市场卖点 |
| S2 | 只做番茄 | `platform` 可留字段，实现只投 fanqie pack |
| S3 | 单人多笔名 | 无多写手权限/绩效 |
| S4 | 月目标约 15、号默认月开 3 | 设置默认值；可改 |
| S5 | 弱耦合 / 管理面板 | 任意本地项目可挂 library；不强制开书向写作流水线 |
| S6 | 存活最小集进 Phase 1 | 同日开书错峰上限、风险号停派、spare 产能 |
| S7 | 这季执行 **L0+L1** | 人去番茄点；SF 出物料/复制/清单；无浏览器助手、无无人值守 |
| S8 | L3-b 永远可选未排期 | 本 PRD 不写 L3 需求 |
| S9 | L4/L3-c 不进产品 | 无反检测、打码、代理链模块 |
| S10 | 时间野心 C | 总计划宪法；本 PRD = 这季切片，不绑 Phase 2–4 |

数据原则（总计划 §6）：本地优先；配额是经营镜像、可手动校准；预留占额度；止损不退已开额度。

---

## 2. 产品定位（Phase 1）

**名称**：发布中枢 / 发行管理面板（Publish Cockpit）  

**一句话**：Desktop 内自用的番茄多笔名 **开书经营面板**——挂书、配额、排期、指派、备料、回写、存活、复盘。

**是**

- 写作 IDE 旁的 **车队管理台**（弱耦合）
- L0 台账 + L1 作业包减负
- 降「一天齐射 / 风险号继续派」的调度层

**不是**

- 第二个 Excel 玩具（必须能跑 15 本级闭环）
- 番茄爬虫 / 自动登录开书 / 无人值守机器人
- 反检测、养号黑产、插件生态
- 强绑「必须走开书向 Agent 流水线才能入库」

---

## 3. 用户故事（Phase 1 必须）

1. **月初规划**：设目标 15 → 见理论产能、spare、目标缺口、号池缺口。  
2. **挂书入库**：当前项目或路径登记进 library；不要求创作流水线状态。  
3. **看流水线**：idea→…→dropped 看板/列表；筛选未指派/本周/某笔名。  
4. **看日历**：计划开书日；改期；超卖/错峰冲突标红。  
5. **智能指派**：规则引擎给 account + 日期建议 → 预览确认 → 预留占额度。  
6. **Ready（弱门禁）**：本地信号 + checklist + 人工确认/强制放行；**不**要求创作侧硬门禁。  
7. **作业包 L1**：生成 meta/简介/标签/清单；一键复制；开书步骤说明。  
8. **今日作战**：今日应开、逾期、本周队列、连载告警 → 作业包 / 确认已开 / 改期。  
9. **存活**：同日全池开书上限；风险号熔断不可派；spare 不满载提示。  
10. **止损与复盘**：止损不退额度；月末目标/负载/止损率/下月号池建议。  
11. **校准**：某号本月已开手动设为 N，与番茄后台对齐。

---

## 4. In Scope（Phase 1）

### 4.1 账号与额度

- 账号池 CRUD、暂停/归档  
- `monthlyOpenLimit` 默认 3  
- 自然月 opened / reserved / remaining  
- **理论月产能** = Σ(active 且非熔断号的 limit)  
- **spare 产能** = 理论产能 − monthlyOpenTarget（可配置 buffer；UI 显示「满载/有备份」）  
- **目标缺口** = max(0, target − 已开 − 预留)  
- **号池缺口**：target > 理论产能时置顶告警  
- 风险状态：`riskStatus: normal | watch | blocked`；`blocked` = 熔断，**智能指派与手工指派均不可选**（解除需人工）

### 4.2 书流水线（Kanban + 列表）

```
idea → writing → polish → ready → scheduled → opened → serializing → dropped
         ↑_______________________________________________|  (opened/serializing 可止损)
```

- 拖拽改阶段；非法迁移给原因（如 ready→scheduled 需已指派）  
- 卡片：书名、笔名、计划日、Ready 分、字数/章摘要  
- **弱耦合**：入库不校验是否来自开书向模板  

### 4.3 开书日历

- 月视图 + 本周作战条  
- 改 `planOpenDate`  
- 校验：  
  - 单号单月超限 → 阻断  
  - **全池同日开书上限**（默认可配，如 3）→ 阻断或强警告（默认阻断）  
  - 同号同日多本警告（可配 max=1）  
  - 可选 preferWeekdays  

### 4.4 智能指派（规则，非 ML）

输入：待分配书 + 月度账 + 窗口  

默认策略：

1. remaining > 0 且 `riskStatus != blocked`  
2. 优先 remaining 高（均衡）  
3. 同号每周开书 ≤ `maxOpensPerAccountPerWeek`（默认 2）  
4. 笔名/号分散，避免连续总落同一号  
5. **错峰**：不把多书挤进已达同日上限的日期  
6. `assignmentLocked` 不改  

输出：预览 diff → 确认写入预留；阻塞列表附原因。

### 4.5 Ready（弱门禁）

本地启发式（无则 unknown，不造假）：

| 信号 | 用途 |
| --- | --- |
| 章数 / 字数 | 首更是否够本 |
| publish checklist | 物料是否齐 |
| 最近 mtime | 是否活跃 |
| `readyConfirmed` | 人工放行 |

Score 0–100（透明可展开）；阈值可配；强制放行二次确认 + reason。  
**不**依赖创作 Agent 流水线状态。

### 4.6 开书作业包（L1）

```
.storyforge/open-pack/
  README.md      # 去番茄手开的步骤顺序
  meta.json
  blurb.txt
  tags.txt
  chapters/      # 清单或副本（实现可选清单-only）
  checklist.md
```

UI：生成；复制书名/简介/标签；打开章节目录。  
**不做** 浏览器自动填表（L2）、不做自动提交（L3）。

### 4.7 今日作战台（默认首页）

1. 今日应开  
2. 逾期未开  
3. 本周后续  
4. 连载告警（已开后 N 天本地无更新，默认 2）  
5. 入口：作业包 / 指派 / 确认已开 / 改期  

### 4.8 连载与止损

- `openedAt` / `lastLocalEditAt` / 风险色 / `dropReason`  
- 止损 → dropped；**不退**当月 opened；文案写清  
- 号级「标记风险/熔断」与书级止损分开  

### 4.9 月度复盘

- 目标 vs 已开 vs 预留 vs spare  
- 各笔名负载  
- 止损率  
- 熔断号列表  
- 下月建议：止损高 → 降开提质；满载 → 加号或降目标  

### 4.10 多项目 library

全局例如：`%APPDATA%/storyforge/publish/library.json`  

- 加入当前项目 / 路径失效重定位  
- 看板/日历/指派读 library，不限当前窗口  
- 项目内 `.storyforge/publish.json` = 书侧真相；library = 调度索引，关键字段双向同步  

### 4.11 存活最小集（本切片硬要求）

| 能力 | 行为 |
| --- | --- |
| 同日错峰上限 | 设置 `maxOpensPerDayGlobal`；日历与智能指派遵守 |
| 风险号熔断停派 | `blocked` 号不可指派；今日作战提示「先处理风险号」 |
| spare 产能 | 产能条同时显示理论产能、目标、spare；满载告警 |

Phase 1 **可不做**（放到后半或 Phase 2）：冷号观察窗策略加厚、作业包全文去同质。可选轻量：开书前对 library 内 blurb 做简单过近提示（非必须验收）。

### 4.12 命令面板

- `Publish: Open Cockpit`  
- `Publish: Add current project to library`  
- `Publish: Auto-assign ready books`  
- `Publish: Generate open pack`  
- `Publish: Mark opened today`  
- `Publish: Reschedule…`  
- `Publish: Mark dropped`  
- `Publish: Mark account blocked/watch`  
- `Publish: Monthly review`  

---

## 5. Out of Scope（本切片明确不做）

| 不做 | 归属 |
| --- | --- |
| L2 本机浏览器会话填表 | 总计划 Phase 3 |
| L3 无人值守开书/自动登录 | 可选未排期；L3-b 非一年必达 |
| L3-c 打码 / L4 反检测代理链 | **不进产品** |
| 黑产养号、批量注册 | 禁止 |
| 爬取番茄后台真实已开数 | 无；用手动校准 |
| 强绑开书向写作流水线 | Phase 2 可选咬合 |
| 多平台 pack 并行、插件市场 | Phase 4 / 不做对外 |
| 多写手权限 | 非目标 |
| 复活 Web 主入口 | 禁止 |

**诚实边界**：额度以用户回写 + 校准为准。

---

## 6. 数据模型（Phase 1）

### 6.1 settings（示意）

```json
{
  "monthlyOpenTarget": 15,
  "defaultPlatform": "fanqie",
  "defaultMonthlyOpenLimit": 3,
  "quotaResetTimezone": "Asia/Shanghai",
  "preferWeekdaysOnly": false,
  "maxOpensPerAccountPerWeek": 2,
  "maxOpensPerDayGlobal": 3,
  "maxOpensPerAccountPerDay": 1,
  "readyScoreThreshold": 70,
  "staleSerializingDays": 2,
  "minChaptersForReady": 3,
  "minCharsForReady": 10000,
  "spareWarnIfBelow": 3
}
```

### 6.2 accounts

在既有字段上增加：`color`、`priority`、`riskStatus`、`riskNote`（自填隔离/事件备注，**非**代理配置）。

### 6.3 library.json

```json
{
  "version": 1,
  "books": [
    {
      "projectKey": "normalized-path",
      "title": "书名",
      "path": "D:/novels/x",
      "platform": "fanqie",
      "status": "writing",
      "assignedAccountId": null,
      "assignmentLocked": false,
      "planOpenDate": null,
      "readyScore": 42,
      "readyScoreBreakdown": {},
      "openedAt": null,
      "lastLocalEditAt": null,
      "dropReason": null,
      "updatedAt": "..."
    }
  ]
}
```

### 6.4 quota/YYYY-MM.json

opened + reservations；可选 `calibratedOpenedCount`。

### 6.5 项目 publish.json

含 status、指派、planOpenDate、meta、checklist、readyConfirmed、openPackGeneratedAt、openedAt 等；与 library 同步关键字段。

---

## 7. IA

```
发布中枢
├─ 今日作战（默认）
├─ 流水线
├─ 日历
├─ 账号与额度（含风险/熔断/spare）
├─ 智能指派
├─ 复盘
└─ 设置
```

IDE 内嵌轻运营台；跟随 Desktop 主题。

---

## 8. 技术落点

```
apps/desktop/frontend/src/features/publish/
  model/     # 状态机、额度、Ready、auto-assign、存活规则（纯函数+单测）
  storage/   # 全局 + 项目
  packs/fanqie/
  views/     # DailyOps, Pipeline, Calendar, Accounts, AutoAssign, Review, OpenPack
  commands.ts
```

- Phase 1 **不依赖** API 服务端业务  
- Ready 扫描：Tauri 本地、限深度/类型  
- 写操作至少可撤销最近一次指派/改期（若砍范围见 §11）  

测试重点：状态机、auto-assign 不超卖、错峰/熔断、Ready 边界、library↔publish 同步、跨月预留、校准 opened。

---

## 9. 里程碑

### Phase 1（本 PRD）— 这季

必须：library、Kanban、日历、额度+缺口+spare、智能指派、弱 Ready、作业包 L1、今日作战、已开/改期/止损、风险熔断、同日错峰、月度复盘、手动校准、model 单测。

### 之后（非本 PRD 范围）

- Phase 2：创作侧可选咬合、冷号策略/去同质加厚  
- Phase 3：L2 会话助手  
- L3：单独立项；L3-b 未排期  
- Phase 4：自用 pack / 多平台可选  

---

## 10. 验收（Phase 1）

1. 12+ 书入库，看板拖拽可用  
2. 5 号×3=15、目标 15 → 缺口 0；spare 显示合理；减号后缺口/满载告警正确  
3. 智能指派不超卖、避开 blocked 号、遵守同日全池上限  
4. 日历改期导致超限或破错峰 → 阻断/红字  
5. Ready：缺章分低；强制放行要原因  
6. 作业包生成且书名/简介/标签可一键复制  
7. 今日作战：今日应开 + 逾期  
8. 确认已开占额度；止损不退额度  
9. 号标 blocked 后不可被指派  
10. 校准 opened 后 remaining 正确  
11. 重启后数据不丢  
12. model 单测通过  

---

## 11. 范围加减（确认时用）

默认 **Phase 1 全开**（§4）。可选：

**可砍**

- C1 复盘图表（保留数字表）  
- C2 撤销栈  
- C3 作业包 chapters 物理拷贝（仅清单）  

**可后置（不进这季）**

- A1 桌面通知  
- A2 笔名赛道标签  
- A3 空书位占坑  
- A4 blurb 去同质  

**已确认（2026-07-13）：`Phase1 按 PRD 全做`** — §4 全开；§11 可砍项均不砍。  

下一步（另步，非本文自动开工）：开 Trellis 任务 + 可选分支 `feat/publish-cockpit-phase1` 做实现规划。

---

## 12. 一句话

> 这季只做 Desktop 里自用的番茄 **管理面板**：弱耦合挂书、配额排期指派、L1 作业包、存活三件套；  
> 开书仍人在番茄点；不爬后台、不自动开书、不交付反检测。
