# StoryForge 待办清单

更新时间：2026-09-28

## 当前执行入口

当前状态以 `docs/internal/current-phase.md` 为准；TODO 只保留下一步执行入口。项目总览见 `docs/internal/PROJECT_SUMMARY.md`，旧执行清单见 [待办历史](../archive/internal-history-2026-09/TODO-history-2026-07-26.md)。

## 下一步优先级

1. **R1–R8 可靠性切片已完成本地集成，先审阅再决定提交。** 当前完整门禁、E2E、API/Desktop 重建、packaged、两条 browser 与两次全新隔离 native GUI 均通过，未提交/发布。后续改动按 [反馈地图](../architecture/authoring-feedback.md) 选最小回归，再过总门禁。文风语料枚举的链接 containment/遍历预算仍是独立安全切片，不混为本轮已解决。
2. **回到真实写作验证。** 接续 n=1 连载前确认仓库外资产现状；记录固定任务的完成时间、改稿保留率、返工和人工偏好。7 月章节数与 S3 手稿保险计划任务状态本轮未复核，不作为今天事实。
3. **按版本执行发布验收。** 指定拟发布构建，运行对应门禁并复验 GUI 保存、diff 确认和权限档位；冻结 sidecar 冒烟不能替代真机 GUI 验收。Windows 原生符号链接可在具备权限的环境补跑，不把 Linux 通过描述成 Windows 原生通过。

## 已实现与待核实

- 2026-09-28 可靠性 R1–R8 已完成当前本地实现与规定的集成验收；原范围、源码/产物绑定和未验收边界见 current-phase 与 verification-report，不等同发版或文学质量验收。
- 2026-09-27 持续演进切片已实施：修订能力/会话分离、固定上下文选择、ToolSpec 策略派生、结算状态/证据原子性、安全 provider 诊断、分阶段性能反馈、第二条润色真实路径矩阵及单项有界读取。已完成本地集成验收，未提交；详细证据以 current-phase 为准，不重复建设 SDK。
- 下列 `fd7a7fa6`、Linux/冻结搜索与旧门禁修复为 2026-09-05 历史成果，不将其数字冒充本轮。

- 文件工具边界与资源限制已提交为 `fd7a7fa6`；Linux 补验 56 passed / 1 skipped，普通符号链接三项及 Project Knowledge 越界链接均通过；Windows junction 与冻结 exe 实际搜索已有通过证据。
- 已修复 intent 测试遗漏 `chapter.polish`、Windows PowerShell 中文脚本解析和拆书报告 effect lint；报告加载已覆盖项目切换与旧响应回流的行为回归。
- 全文搜索、项目/页签/光标恢复已接入 Desktop，不再作为缺失能力提名。
- `chapter.write`、`chapter.polish`、结构化拆书已有代码；不代表质量或用户收益已验收。
- 旧清单的 canon/hook 提案并入、观测已处理状态持久化、改稿锚点稳定性、原生菜单，必须核对当前实现再决定是否立项，不能照抄 7 月结论。
- BookRun 的 Agent 启动工具已退役，后台兼容不是重建桌面自动整书入口的待办。
- 重跑真实 3-5 万字长程不在本轮自动排期，需要独立样本、成本和人工评审方案。

## 本地验证入口

```powershell
cd D:/StoryForge
pnpm.cmd lint
pnpm.cmd verify
pnpm.cmd check:drift
pnpm.cmd smoke:sidecar:packaged
npm --prefix apps/desktop/frontend run typecheck
npm --prefix apps/desktop/frontend run test
```

```powershell
cd D:/StoryForge/apps/api
uv run pytest tests/test_phase9_fact_sources.py -q
uv run pytest tests/test_ide_agent_orchestrator.py tests/test_real_llm_long_evidence_validator.py -q
uv run pytest tests/test_agent_fs_tools.py tests/test_agent_fs_boundaries.py tests/test_agent_fs_budget_feedback.py -q
uv run ruff check app/domains/agent_runs app/domains/ide tests
```

真实 LLM 使用独立授权的本地配置和明确预算，不把密钥或私有小说正文写入报告。


## 2026-10-01 下一入口补充：先完成P1/P2联合验收

idle正常退出/重开、owned dev API丢失后的deadline/持久警告已由真机Tauri/WebView执行；不要再把“缺GUI工具”或这些idle项列为尚未执行。继续进行中单文件写回/明确手动恢复GUI、各交付边界kill/断电及packaged矩阵，并处理已有总门禁阻断。真机写回实验须有独立测试能力来源，不得用环境变量绕过生产release常量。P1/P2完成联合最终验收前，不进入P3多文件/发布，不自动开放功能；当前状态和证据以current-phase最新补充及活动任务research/gui为准。

## 2026-10-02 P2下一入口更新

- [x] debug fixture audit在途正常关闭 / 已写冷恢复继续（零第二写）；空SQLite waiting退出→新API冷发现→明确资格→独立批准→同run完成，最终GUI自动结算。
- [x] Native off-event-loop admission、旧审批隔离、续跑ACK间隙GET轮询及历史delivery防误判；相关回归/契约字节核对。最后历史delivery保护尚未再次GUI。
- [ ] 按用户“全权操控、之后验收”继续P2：自主原生目录选择、最后保护的新构建GUI、各交付强杀/断电及packaged/installed分档；不使用旧hash截图代新构建。
- [ ] 真实provider/权限矩阵与总门禁另行补齐；当前pnpm NO_TTY、root ESLint两个无关bootstrap红项、旧Rustfmt/缺long runner不隐藏。保持P1/P2活动、生产gate关闭，不进P3、不commit/push/archive、不付费。


## 2026-10-02 自主强杀与安装子集后的下一入口

- [x] 最新保护新构建的全自主GUI（无需再请用户选目录）；waiting实际强杀/冷资格/独立批准/同run完成。
- [x] Windows Job OS寿命托管，真实子孙继承与自动清理；body已写/audit在途强杀→仅补audit→独立资格/继续，零第二write/version。
- [x] 当前源码frozen/release/隔离NSIS资源/安装/运行/卸载子集；release启动真实PyInstaller双进程强杀自动清空。不是生产external GUI全验收。
- [x] 定向Native/API/combined/Frontend回归、契约hash、原dirty保护和报告/spec同步；owned服务与专用安装身份收尾。
- [ ] 继续P2剩余：其他交付kill边界/断电、生产external GUI、全权限/多窗口、真实provider（需独立授权预算），以及pnpm NO_TTY、旧whole Rustfmt/缺long runner总门禁。不要再次列已通过waiting/audit强杀或安装烟测为没执行。
- [ ] 联合最终验收前仍保持P1/P2活动与两生产gate关闭，不进入P3，不commit/push/archive或付费。当前证据以gui-job/summary.json与verification-report最新追加为准；不能声称全部改造/发布验收完成。


## 2026-10-02 下一入口追加：GUI结算/冷结果投影两个真实红项

本轮完整逐格矩阵入口：`D:/StoryForge/.trellis/tasks/10-01-agent-host-lifecycle/research/gui-matrix/matrix.md`，机器证据`summary.json`及只读`verify-evidence.py`、复现`reproduction.md`。P1/P2未完成、不进入P3、两处生产release gate仍False/false，不提交/push/archive/付费。

- 新debug-only boundary probe复用原pipeline，不另写手稿/receipt/audit。五个干净SQLite/真实GUI输入实验分别命中snapshot、branch、syncedintent、syncedbody/outcome前、audit完成/ACK前并真实强杀。新APIgeneration冷恢复：snapshot/branch明确资格再独立重批，同run完成（保留原快照+新快照版本2、正文一次）；intent/body未知outcome安全拒绝，DB/所有文件/provider不变；audit_done验证原receipt/audit最多一次反馈，仅独立continue，正文/版本/audit各1、durablehash不变。原run/wait/op/messagesprefix/write_budget1/累计时间/MinGit原56B CRLF已核验。五次kill与五次normalclose captured树/端口自动全空，无harness代清子孙。
- 普通release独立应用标识、embeddedfrontend/frozenAPI/bundledMinGit、正常Native DPAPI/BYOK→生产provideradapter→127.0.0.1 OpenAI-compatible HTTP/SSE合成服务器，零云调用：GUI提案/独立确认/真实单写版本history/正常close/reopen通过文件子集；first wire3、cold0、版本/intent/outcome/audit各1，close983/843ms。生产external真实HTTP409且DBcounts零变化，**不是external生产正例**。
- **新产品红项，尚未修复**：普通legacy文件虽写成功，实际API run仍paused / permission.confirm；coldexternal同run已completed但活动聊天为空，没有结果投影。不能把panel消失/模型总结/单文件成功当完整生产闭环通过。下一优先修复两处结算与投影，再做GUI复验。
- 本轮定向绿：API115、SDK/reader/事务/source99、最终17业务+4CORS联合21（新增full/normal）、actualNativebridge1；Native默认100/4ignored、fixture104/4ignored；Frontendtypecheck与156files/1285passed/1skip；Ruff/直接ESLint/Prettier/定向Rustfmt2021/gitdiffcheck。普通release构建绿，4公共契约相对entry字节不变；无新route/DTO，未将其冒称又跑pnpmopenapi绿。
- 总门禁仍红：pnpmverify/lint NO_TTY；cargo fmt全量既有差异；旧全API缺longrunner的15失败未被本轮定向覆盖洗绿。四权限GUI、多窗口/真实reload/跨项目session、真实云provider/质量/断电与productionexternalpositive仍待验。此前gui-job安装/启动强杀仅其分档，不拿旧构建充本轮GUI。
- 原始失败保留：branch-proof未命中且DB author_rejected；branch-clean因harness错分支path并错误继续，明确无效，独立branch-final新root才计通过。audit首次文件分类错断言后在同一真实停驻内正确强杀，无放行/造账。普通release诊断原rawnull来自harness误读Local，另存Roaming本次close_confirmed，不覆盖原raw。全记录见matrix末节。
- cleanup.json自有GUI/API/WebView/provider/Vite全部已收尾，临时数据/证据保留不删除。工作树保护：入口160中nonowned151精确不变，6本轮源码owned与根3appendonly；原29前缀/10rename、HEAD、Cargo.lock与4公共契约不变，最终核验见preservation-final.json。finish-work因本任务未提交与验收红bailout，仅journal --no-commit。


## 2026-10-02 最新续做入口：对话/决策边界已纠偏

- [x] 右侧 Agent 原会话状态+消息；选择/决定弹窗，稍后/Escape无authority、scope/hide/focus/章纲草稿行为回归。
- [x] cold external完成后活动chat原user+持久assistant真实GUI可见；warm 新session空DB history不抹作者消息；唯一chat/一次write/version/audit、原budget保持，新embedded资产验收。
- [ ] 下一窄切片仍是普通生产legacy写完API原run paused permission.confirm的结算红，不扩大到新架构或恢复退役入口。
- [ ] 四权限GUI/多窗口/真实reload、真实provider/断电、productionexternal正例、完整总门禁；pnpmverify/lint NO_TTY未绕过。gate保持关闭，不提交/归档/P3。

最新证据research/gui-chat；原gui-matrix所有历史原件保持，不覆盖validator/summary。
