# 验证报告 · dogfood 波3：发行 webview 自定义 UA（登录窗黑屏嫌疑收口）

时间：2026-07-18
分支：`fix/publish-webview-ua-20260718`
前置：波1 PR #151、波2 PR #152 已合并。本刀是 15 条清单四波推进的第三波。

## 问题与变更

### #3 发行登录 webview 真机黑屏

- 现场：真机点开平台登录窗（`publish-login`）整页黑屏，标题栏正常。
- 嫌疑排序（静态分析）：① WebView2 默认 UA 非常规浏览器形状，字节 secsdk
  风控可能直接给空白页——**头号嫌疑**；② 远程页 CSP 拦 initialization_script
  注入（表现应为脚本失效而非黑屏，次嫌疑）。
- 修：`publish_api.rs` 新增 `PUBLISH_WEBVIEW_USER_AGENT`（常规 Edge UA 形状），
  `publish-login` 与隐藏 `publish-worker` 两处 WebviewWindowBuilder 统一
  `.user_agent(...)`。grep 确认全仓仅这两处 webview 创建点。

## 验证

- `cargo test` 全量 20 passed（重编译验证 `user_agent` builder API 与常量拼接）。
- 前端 / 后端零改动；`pnpm verify` 全量门禁见 PR。

## 红线审计

- 仅改 webview 构造参数，无新出网路径、无凭据面变化（Cookie/csrf 捕获链原样）。
- 暂存全部使用显式路径。

## 未验证项

- **本修复必须真机闭环**：黑屏是风控行为，headless 无法复现。下次真机波验证
  顺序——① 打开登录窗看是否仍黑屏；② 若仍黑屏，下一刀候选是排查登录 URL 与
  CSP 注入（把 initialization_script 暂时摘掉做 A/B）；③ 登录成功后连带验证
  PR #144 写侧直连与 #138 对账（本来就欠的发行定向真机波）。
