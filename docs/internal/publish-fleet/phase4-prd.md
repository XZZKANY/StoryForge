# PRD：Phase 4 — 自用 pack 化 / 多平台骨架

日期：2026-07-13  
分支：`feat/publish-cockpit-phase1`  
任务：`07-13-publish-fleet-phase4`  
上级：`master-plan.md` Phase 4

## 目标

把番茄规则从散落常量收成 **Platform Pack**；主程序只依赖 pack 接口。  
可注册第二平台骨架（如起点），默认仍番茄。  
**不含 L3 无人值守。**

## In Scope

1. `PlatformPack` 接口：id/label/默认额度/清单/作业包 README/作者首页/URL 白名单  
2. `fanqie` pack 实现（迁入现有规则）  
3. `registry`：list / get / resolve(settings.defaultPlatform)  
4. 调用点经 registry（open-pack、open-external、assist、settings 默认）  
5. 第二平台 **skeleton**（占位文案与空白名单，不宣称可用）  
6. 设置里可切换 defaultPlatform（仅已注册 pack）

## Out of Scope

- L3 无人值守  
- L4 反检测  
- 可下载 zip 插件市场  
- 对外商业 pack 商店  

## 验收

- [ ] fanqie 行为与 Phase3 等价（默认路径）  
- [ ] 可 list 多个 pack；未知 id 回退 fanqie  
- [ ] open URL 使用当前 pack 白名单  
- [ ] 单测：registry resolve / 白名单  
