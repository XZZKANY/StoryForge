# Monaco Worker 单变量对照：2026-09-06（B3a）

## 结论与决策

**本地 Worker 配置可用，但本轮未证明整体交互提速；不改产品代码。**

- 控制组 10/10 次仍回退主线程；候选组 10/10 次 Worker 初始化成功，5/5 次真实 `$computeDiff` 回复成功、没有提前退出。两组公共 diff 行范围均为 `[[3,3,3,3]]`，输入结果一致。
- 在本轮合成长文稀疏 diff 下，候选组 SSE→公共 diff 完成回调的配对差值中位数是 **+15.9 ms**（更慢）；完成后/装饰后的双 rAF 差值方向不一，不能因最大值下降宣称更流畅。
- 回答双 rAF 代理 5/5 对更早，中位配对差值 **−11.6 ms**；这是局部正向信号，与 diff 完成延后并存，不外推实际 paint 或整体流畅度。
- 启动仍两组各 5/5 次出现长任务，均发生在开文件之前；候选组也早于 Worker 创建。当前证据不支持 Worker 配置能解决入口启动成本。

因此不把「消除 fallback 告警」等同于「优化性能」。若下一批以线程隔离/配置完整性为目标，可另确认最小产品配置修复及 production Worker 验收；若目标是启动更快，应另做入口 CPU trace 归因。**两条都不是本批已授权实施，B4 也未启动。**

## 版本、控制变量与负载

- 当前 HEAD：`9f5899d0eda0f22ab7c532684e8ed5fcefe7ed74`。复用 B3 的 99 个 production 产物（源码基线 `08377dc0`）；两提交间相关 frontend/shared/project-core 源码无变化，原产物逐文件 SHA-256 一致，未重新构建或修改产品。
- 同一 HTML 在 bootstrap 后、原 App module 前加载同一 factory；只有 `arm=worker` 安装 `getWorker`。两组共同设置 `globalAPI:true`、公共 diff 监听及 Worker RPC 元数据监听，不把旧 B3 不同观测环境的数据当控制组。
- 使用本地已安装 Vite 6.4.3 的 `?worker` 独立构建，无依赖升级。新增 factory 392 bytes、editor worker 232,516 bytes；只支持本轮实际请求的 `editorWorkerService`，未知 label 显式失败，不冒充 JSON/TS/CSS/HTML 支持。
- Windows / Chrome 152；20 logical processors、deviceMemory=16；viewport 1440×920、DPR=1，全程 visible。不做 CPU/network throttling，未控制 OS 调度、电源策略和浏览器代码缓存。
- 5 对、10 个新 loopback origin。奇数对 control→worker，偶数对 worker→control；每个 arm 先新 origin 长文 diff，再同 origin 新导航长文输入，合计 **20 个正式样本**。测量不与 lint/build/test 并行。4 个交互/RPC 校准样本单独保留，不参与统计；没有正式失败、补跑或删除不利耗时。
- 相同内存 fixture：39,598 UTF-16 code units / 99,598 UTF-8 bytes / 7,199 行，只将首处逗号改句号。模拟 SSE started/step/tool_trace/result，120 ms 间隔；最终回答 796 code units，assistant-message DOM textContent 长度 736 字符。它不是稠密改写、真实 provider 或长会话。
- 输入每轮 32 个 ASCII insertText，每组 160 个事件；实际键间隔中位数 control/worker 为 61.5/61.4 ms。dirty 与归一化可见文本逐轮通过，不测中文 IME，也不在 dirty 页发送 chat/保存/接受 patch。

## 数据（毫秒，中位数 / 最大值）

配对差值定义为同一对 **worker − control**；正数表示候选组更慢。每个 diff 指标每组 n=5。

| 观测边界 | Control | Worker | 配对差值中位数 |
| --- | ---: | ---: | ---: |
| SSE result 入队→公共 diff 完成回调 | 54.8 / 67.7 | 70.7 / 75.1 | +15.9 |
| SSE result 入队→完成后双 rAF | 75.2 / 94.2 | 77.6 / 82.1 | +2.4 |
| SSE result 入队→diff 装饰双 rAF | 79.1 / 99.3 | 80.5 / 87.2 | +0.5 |
| SSE result 入队→回答双 rAF | 79.1 / 99.3 | 69.9 / 73.2 | −11.6 |
| 输入事件→下一 rAF（每组 160 事件） | 2.4 / 9.7 | 2.5 / 12.2 | 不将事件当独立配对轮次 |

- 公共 diff 完成回调逐对差值：`[+14.8, -2.5, +25.7, +18.4, +15.9]`；完成后双 rAF：`[-0.8, -20.2, +10.6, +5.6, +2.4]`；装饰双 rAF：`[+0.5, -20.0, +10.1, +6.0, +0.4]`。
- 公共回调取 diffCompletions.at；其后 diff_computed_event 标记另读时钟，个别样本多 0.1 ms（若按标记统计则 control 中位 54.9、配对 +15.8 ms）。汇总同时保留两种边界，不混用。
- 输入每轮中位数再取中位数，两组均 2.4 ms；逐轮配对差值中位数 +0.1 ms。上述 160 事件的 pooled 中位数与五轮等权中位数不同，不能混用。
- Worker `$computeDiff` RPC 往返中位 4.4 / 最大 6.8 ms；新 origin 初始化 28.4 / 31.2 ms，再导航输入页初始化 24.2 / 27.4 ms。初始化可返回 void，成功不要求 `resultPresent=true`。
- 新 origin 启动长任务逐次 control `[90,92,81,81,79]`、worker `[86,82,86,83,82]` ms；diff 窗口为 SSE result 入队→max(完成后双 rAF,装饰双 rAF,回答双 rAF)，input 窗口为首 input→所有 input 的 next-rAF 最晚时刻，按区间重叠计入完整长任务。两组这两个窗口均未记录到 ≥50 ms 长任务。这不能反证存在较短的主线程工作，也不能算出省下多少 CPU。

## 证据强度与限制

- Worker 可用性来自真实 Monaco 请求及匹配的 reply（`vsWorker` 与 `req/seq`）、`changes=1/moves=0/identical=false/quitEarly=false`，并与公共 `onDidUpdateDiff/getLineChanges()` 结果核对；不是仅凭 Worker 构造、资源下载或告警消失。
- RPC 往返不是 Worker CPU 时间；SSE→公共事件包含消息投递、UI 建模、调度和 diff，不是算法耗时。双 rAF/DOM 不是实际 paint，input→rAF 不包含处理前排队，不等同 INP。少样本不报告 P95/P99、统计显著性或产品 SLO。
- 共同 observer 的正式样本单次最高 7.6 ms、整页累计最高 14.6 ms，明显高于历史 B3；只有累计/最大值，不能定位并扣除某个交互窗口开销。不能从数毫秒差异推断稳定收益。
- 每个 origin 的 diff 在首次加载，input 在下一次导航，资源缓存条件不同，只作同场景 A/B。部分 Worker Resource Timing 的 duration 为负，原值保留，不用于推断下载耗时；RPC/UI 证据用于确认成功。
- 控制组预期 fallback 告警保留；候选组无告警。20 份正式样本 errors=[]、资源无 ≥400、环境/负载/阶段顺序一致。没有过滤不利样本或压制告警来获得结论。
- 本地 factory 使用的公开接口见 [Monaco ESM integration](https://github.com/microsoft/monaco-editor/blob/main/docs/integrate-esm.md)；当前安装源码与真实运行优先于文档示例，官方集成说明本身不证明 Tauri 可用。

## 重放、验证与未验证项

本地原始及派生证据：`D:/StoryForge/.trellis/tasks/archive/2026-09/09-05-monaco-worker-comparison/`。

- `run-plan.json` / `samples/`：固定采样顺序、20 正式 + 4 校准原件。
- `app-build-identity.json` / `experiment-identity.json`：99 原产物与共同观测源码的冻结身份；新增两资产哈希见 `research/worker-assets.json`。
- `summary.json` / `summarize.py` / `summary-check.log`：有效性、逐轮/配对指标、阶段长任务及重算入口。
- `research/replay.md`：构建、启动、实际 UI 操作与 RPC 契约。诊断程序/原始样本位于忽略目录，不会随本文提交，不是已分发的产品监控功能。

已通过：本地候选 Worker 构建、诊断 server **14/14 tests**、Desktop typecheck、`pnpm.cmd lint`、资产与样本校验、独立只读重算。已关闭自建诊断页、恢复 viewport、停止服务并核对 12 个监听端口关闭；原有 9 个未提交文件内容保留，验证报告仅前置本批记录。

无产品/API/DTO/契约变更；未重跑产品 build、`pnpm.cmd verify`、API/Vitest 全量或 OpenAPI。本轮未验收真机 Tauri/WebView2、packaged Worker 协议/路径/CSP、中文 IME、真实磁盘写回、真实 provider、长会话、稠密 diff 或文学质量。后续若合入产品必须重新做对应行为与发布验收，不能把本地实验当产品已修复。
