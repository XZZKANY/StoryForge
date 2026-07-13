# 验证报告 · 发行 UI/UX 中低优先打磨

时间：2026-07-13

## 范围

中优先 + 低优先（不含高优先：会话健康条 / Agent 桥 / 搜索占位）

## 改动摘要

- Stats 默认一行摘要，可展开四格（`CapacitySummary`）
- 文案：Ready→可开分、spare→余量、API 开书→平台开书
- 确认已开：confirm 摘要 + flash 额度前后
- Flash：失败 8s + 可关闭；语义色 `error/success/warning` token
- 空库 `OnboardingGuide` 三步
- 数字键 1–7 切 Tab
- demo.html 同步

## 验证

```text
npm --prefix apps/desktop/frontend run typecheck  # pass
npm --prefix apps/desktop/frontend run test -- tests/publish-*.test.ts  # 22 passed
```

## 未验证

- 真机 Tauri 观感
- 浅色主题下 token 对比人工目视
