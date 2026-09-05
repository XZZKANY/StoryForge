# Desktop 性能基线：2026-09-05（B3）

## 结论与决策

本批完成性能诊断，**不修改业务代码，不自动拆包，不启动 B4**。20 个正式样本发现两项值得继续验证的线索：

1. 新 HTTP origin 的欢迎页启动，5 次均出现 91–124 ms 主线程长任务。Long Animation Frame 的脚本归属是入口模块执行，尚不能细分为 Monaco、React 或业务初始化成本。
2. 开文件后，20/20 次出现 Monaco 未配置 Worker factory、回退主线程的告警。这是可重复配置事实，但发生在启动之后；不能用它解释前述启动长任务，也不能声称长文 diff 已被它拖慢。

本次大文本稀疏 diff 与连续输入的代理数据未提供持续卡顿证据；不等于全部文本规模、编辑动作或真机性能均已通过。建议下一小批先做**本地 Monaco editor worker factory 的单变量对照**，验证 Worker 实际启动、告警消失和同场景主线程成本，再决定是否落业务修复。不要同时拆 chunk、改 diff 算法或升级依赖。

## 版本、环境和负载

- 产品版本：`08377dc0e2b7a97cb9b028f84b6f14d45d78f778`。保留原有 API 清理等未提交改动；Desktop 业务源文件与该提交一致。
- Windows 11 build 26200；Intel Core i5-13500HX，20 logical processors；Node v22.15.0；浏览器报告 Chrome/152.0.0.0，hardwareConcurrency=20、deviceMemory=16；viewport 1440×920、DPR=1。没有 CPU/network throttling；没有控制操作系统调度、电源策略或浏览器代码缓存。
- Vite production build，TAURI_DEBUG 未设置，23.36 秒；99 个产物 SHA-256 已记录。HTML 仅注入诊断 bootstrap，JS/CSS/字体保持原始字节；loopback 服务不启用 gzip/Brotli。构建文件移入任务 `dist/`，沿用项目既有生成目录忽略规则，没有修改 lint 或 chunk 告警阈值。
- 5 个全新 loopback origin，各按「短文初次→同 origin 短文再导航→长文 diff→长文输入」顺序运行，合计 4 组×5 次。每个场景重新导航、重新 seed 内存 fixture；输入后不提交 chat，避免进入 flush/writeback。
- 短文逐字复用 `D:/StoryForge/apps/desktop/frontend/scripts/verify-agent-conversation.mjs` 的 `draftContent`。长文为其确定性重复 1200 次：39,598 UTF-16 code units、99,598 UTF-8 bytes、7,199 行；仅首次出现的一处逗号改为句号。**这是合成大文本稀疏编辑，不是真实小说质量或一般大规模 diff 验收。**
- SSE 复用真实事件词表：started、step、tool_trace、result，间隔 120 ms；最终回答 796 code units、60 段重复正文。当前主 chat 不是逐 token 输出，本轮不覆盖长会话或真实 provider 延迟。
- 输入为 5 次各 32 个真实 `insertText` 事件，共 160 个 ASCII 字符；实际键间隔中位数 62.2 ms、最大 85.8 ms。没有测试中文 IME。

## 数据（毫秒，中位数 / 最大值）

| 观测边界 | 样本 | 中位数 | 最大值 |
| --- | ---: | ---: | ---: |
| 新 origin 导航→欢迎页 DOM | 5 | 236.0 | 283.6 |
| 新 origin 导航→欢迎页双 rAF 代理 | 5 | 257.1 | 301.2 |
| 同 origin 再导航→欢迎页 DOM | 5 | 58.4 | 80.1 |
| 同 origin 再导航→欢迎页双 rAF 代理 | 5 | 123.7 | 139.0 |
| 短文首次点击→文字双 rAF 代理（新 origin） | 5 | 37.2 | 50.9 |
| 短文首次点击→文字双 rAF 代理（复用 origin） | 5 | 19.0 | 23.8 |
| 长文首次点击→文字双 rAF 代理（diff 组） | 5 | 29.4 | 37.9 |
| SSE step 入队→步骤双 rAF 代理（复用 origin 短文） | 5 | 3.1 | 3.7 |
| SSE result 入队→回答双 rAF 代理（复用 origin 短文） | 5 | 15.2 | 20.8 |
| SSE result 入队→长文 diff DOM | 5 | 54.3 | 60.0 |
| SSE result 入队→diff 装饰双 rAF 代理 | 5 | 82.6 | 107.6 |
| 展开既有 diff 面板→双 rAF 代理 | 5 | 7.0 | 7.5 |
| 长文输入事件→下一 rAF | 160 事件 / 5 轮 | 2.7 | 9.1 |

rAF 和 DOM 指标是**带观测开销的代理**：不是实际显示器 paint、标准 INP、操作系统/进程冷启动或完整 diff 计算完成。输入代理不包含事件处理前排队；首次文字代理不等待语言服务和 Worker 初始化。少样本不报告 P95/P99，不据此设定产品 SLO。

## 运行证据与归因限制

- 5 次新 origin 的主 Monaco / index / React 请求 transferSize 分别为 3,338,182 / 577,749 / 142,071 bytes（含 Resource Timing 估算开销）；同 origin 第二次三者均为 0。实际资源记录证实 Monaco 在欢迎页阶段即加载；chunk gzip 数字不是 WebView 耗时。
- 长 diff 组主 JS/CSS 已缓存，但每轮 codicon 字体首次传输 80,640 bytes，不能称全部资源热缓存。浏览器代码缓存、OS 缓存和 Worker 内部资源没有被此指标完全覆盖。
- 冷启动长任务逐次为 124、110、97、99、91 ms，中位数 99 ms。对应 LoAF 指向 `index-C-uynAxR.js` 的 module-script；无 source-map CPU profile，不能据入口 URL 判断模块内部函数归因。其他所选阶段窗口没有记录到 >=50 ms 长任务；这不是整场所有后台工作的完整验收。
- 20 次均记录 `Could not create web worker(s)...main thread` 和 `You must define a function MonacoEnvironment.getWorkerUrl or MonacoEnvironment.getWorker`。现有 Vite manualChunks 只分包，不配置 factory；诊断 harness 没有覆写 Worker/MonacoEnvironment，CSP 允许 self/blob worker。
- 安装的 Monaco `defaultWorkerFactory.js:28–58` 在没有 factory/esmWorkerLocation 时抛同文错误，`editorWorkerService.js:301–328` 回退同步客户端。源码仅解释现场告警，不替代性能归因。
- 现有 Vitest 将 Monaco alias 到 stub；production Worker 生命周期没有覆盖。已有浏览器 smoke 主要捕获 error/pageerror，未因本次 warn 失败，且使用 Vite dev server。建议对照实验后补 production worker 验收，不把 stub 测试通过当成 Worker 可用。

## 样本有效性与隔离

- 20 个正式样本 errors=[]，resource responseStatus 没有 >=400，初始/变更/结束 visibility 均为 visible；viewport 与阶段顺序一致。MutationObserver 单次检查最大 0.4 ms，每页累计约 1.8–8.5 ms；未声称观测无开销。
- 4 个早期校准样本完整保留但排除。原因是会话历史 fixture initially empty，以及首次缓存前缀方案遗漏 Vite 的绝对 preload 路由造成 404。修正为原始 `/assets/` 路径、新 origin 后才进行上述正式采样；没有从正式组删除不利耗时。
- 输入快照的 literal-space 检查字段为 false：Monaco DOM 将空格变成 NBSP。逐轮真实 UI `getByText(..., exact=true)` 的标准空白归一化断言均为 true，独立保存于 `ui-assertions.json`；同时核对每轮 32 个事件及 dirty 状态。不用该 literal 字段判断输入丢失。
- 内存 MOCK_FS 拒绝 writeFile/createDir；fetch 仅返回明确 fixture，其余请求抛错，CSP connect-src self；不访问真实 API、provider、手稿、已有桌面窗口或用户 origin。原有 9 个未提交文件内容均保留。

## 重放、验证与未验证项

完整原始数据、本地诊断 harness、构建身份和复核日志保存在：
`D:/StoryForge/.trellis/tasks/archive/2026-09/09-05-desktop-performance-baseline/`。

- `samples/`、`summary.json`、`build-identity.json`、`ui-assertions.json`：原始及派生证据。
- `research/replay.md`：隔离构建、启动、实际 UI 操作与计时边界。
- `bootstrap.js`、`server.mjs`、`server.test.mjs`、`summarize.py`：本地诊断与重算入口。它们是忽略目录内的调查产物，不是已分发的产品监控平台；本报告提交不会附带原始样本/构建。

已执行：production build、Desktop typecheck、最终 `pnpm.cmd lint`、server **12/12 tests**、20 样本 validity 检查、全部 99 产物 hash 校验、独立只读重算，均通过。首轮 lint 因临时产物放在 `build/` 被扫描失败；改回标准 `dist/` 并显式声明诊断脚本环境后重跑通过，未修改门禁规则。

没有业务/API/契约变更，本轮没有重跑 `pnpm.cmd verify`、API/Vitest 全量或 OpenAPI 刷新；B2 的全量通过仅是历史记录。未测真机 Tauri/WebView2、packaged smoke、真实磁盘、真实 provider、完整 diff completion、中文 IME、长会话、稠密编辑、权限/写回、人工文学质量。本机浏览器结果不可外推为这些项目通过。
