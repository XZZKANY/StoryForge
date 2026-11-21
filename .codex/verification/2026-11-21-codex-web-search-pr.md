## 2026-11-21 联网搜索与公开网页跟读

- 改动：作品对话新增可选的 Tavily/OpenAI Responses 搜索、公开 HTML/纯文本读取及同站实际链接跟读。设置支持启用、服务选择和密钥管理；步骤展示实际来源和截断状态。网页读取沿用整次对话预算，不额外固定阅读层数和页数。
- 权限与数据：默认关闭；密钥在 Rust 宿主加密保存或复用当前模型服务。网页 GET 不携带模型/搜索密钥、Cookie 或 Referer；限制超时、响应大小和重定向，校验 DNS 并固定连接，拒绝本机及内网。网页材料不构成工具授权。
- 对比与范围：以 GitHub master 的 7bad05a1 为基线，仅提交搜索/网页阅读及相应测试和文档。原有写作资料与连续修订提交已经在独立 PR #612 中，本次不重复收录。工作期间出现的后续并行编辑保留在原工作区，最终门禁改在提交 4b9ecfc3 的独立克隆中执行。

### 验证

- Node.js 22.23.4；隔离克隆按锁文件从本地缓存执行 pnpm install --offline --frozen-lockfile 及前端 npm ci --offline。VITEST_MAX_WORKERS=4，使用已有 Playwright 浏览器缓存。
- pnpm verify EXIT=0，八道门禁全部通过：project-core 48 项；engine 14403 通过、2 跳过；frontend 2893 项；真实 Monaco、浏览器冒烟和 Agent 对话三组回归全部通过。
- Rust 全量：cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml，EXIT=0，255 通过、2 忽略；新增 Rust 源码与本次提交一致。
- npm --prefix apps/desktop run build:release-smoke，EXIT=0；node apps/desktop/scripts/verify-tauri-smoke.mjs --release，EXIT=0。隔离原生 IPC 中 default_disabled、disabled_refused、openai_selected、page_read_disabled、page_private_refused、no_key_leak 均为 true；既有写回、漂移与恢复冒烟通过。
- 行尾核验：已有文件保留原有 LF/CRLF；普通 numstat 与 --ignore-space-at-eol 完全一致。与 --ignore-all-space 比较时仅 agent.ts 和 chatLoop.ts 因表达式重排的必要缩进不同，未出现整文件行尾噪音。git -c core.whitespace=cr-at-eol diff --check 通过。
- 凭据模式检查：命中仅为代码中的合成测试/冒烟占位符，不上传本机配置、产物或运行日志。
- 重试说明：首次原工作区门禁在浏览器阶段发现默认缓存路径缺失，改用已有缓存后三组浏览器回归通过。Node 22 门禁曾在并行 Rust 编译时发生一项既有修订测试 5 秒超时；其后重试遇到工作区并行编辑导致的格式检查变化，故不采用该轮结果。最终以独立克隆的完整门禁结果为准，未放宽时限或修改测试断言。

### 未覆盖

- 本轮没有使用真实模型或搜索密钥，没有付费 Tavily/OpenAI 搜索；默认忽略的 Rust 外网探针未重跑。
- 未在最终应用链路评估真实模型选链接与引用质量，未验证所有第三方 Responses 服务均支持 web_search。
- 不支持登录、JavaScript 渲染页面或 PDF 等下载格式；不保证读完整站。
