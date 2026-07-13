# PRD：Phase 2 — 发行供给对齐（轻量）

日期：2026-07-13  
分支：`feat/publish-cockpit-phase1`（可续）/ 任务 `07-13-publish-fleet-phase2`  
上级：`master-plan.md` Phase 2  
前提：Phase1 管理面板已落地；**弱耦合不推翻**

## 目标

降低「有号没好书 / 开了就死」：在面板内补 **空位占坑、冷号限载、开书前去同质提示**；不绑死创作 Agent 流水线，不做 L2。

## In Scope

1. **空位占坑**：一键创建占位书（无真实项目 path 或占位 path），先占 `planOpenDate` + 额度预留意图，逼自己补稿后再挂真实项目  
2. **冷号策略**：账号可标「冷号观察窗」；观察期内月开上限更严；智能指派遵守  
3. **可选 Ready 软门**：`scheduled` 时若 score &lt; 阈值则警告（可强制）  
4. **简介去同质**：开书/生成作业包前，对 library 内 blurb 做简单过近提示（非洗稿）

## Out of Scope

- 开书向 Agent 全流程重做  
- L2 浏览器助手 / L3  
- 强绑写作流水线硬门禁  

## 验收

- [ ] 可创建 N 个空位并出现在日历/今日作战  
- [ ] 空位可「绑定当前项目」升级为真实书  
- [ ] 冷号在观察窗内指派受 `coldMaxOpensPerMonth` 限制  
- [ ] 低 Ready 进 scheduled 有警告  
- [ ] 两本极近简介触发提示  
- [ ] model 单测覆盖冷号与占位  
