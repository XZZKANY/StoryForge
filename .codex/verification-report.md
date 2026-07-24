# 验证报告 · AssistantMarkdown 挂 remark-gfm（补速赢包表格/删除线真 BUG）

时间：2026-07-24
分支：`feat/assistant-markdown-gfm-20260724`

本刀 = 速赢包最后一项真 BUG（此前因 npm 镜像不可达延后）：审稿 / 一致性 / 对比类回答自然会用
表格或删除线，但 react-markdown v10 默认只吃 CommonMark，表格渲染成一堆裸管道符、`~~删除线~~`
渲染成裸符号，破坏「审阅 agent 输出」的可读性。

## 变更

- `AssistantMarkdown`：`remarkPlugins={[remarkGfm]}`（依赖 `remark-gfm@^4`，与 react-markdown v10 匹配）。
- `.assistant-md` 补最小 GFM 样式：table（`display:block; overflow-x:auto` → 宽表横向滚动不撑破
  对话区）+ th/td 描边 + th 背景、`del` 弱化色、任务列表 checkbox 间距，全走 design token。
- 新增测试：GFM 表格 + `~~删除线~~` 渲染出 `<table>`/`<td>`/`<del>`、不再是裸管道符（可证伪）。

## 依赖与 lockfile

- `remark-gfm` 经 npmmirror 直连安装（当前网络下 registry.npmjs.org 经代理不可达）；
  **package-lock.json 的 18 条 `resolved` URL 已从 npmmirror 回写 registry.npmjs.org**——
  integrity 为 tarball 内容哈希、npmmirror 与 npmjs 同源，回写后 `npm ci` 校验一致，lockfile
  保持 npmjs 单一来源。

## 验证

```bash
npm --prefix apps/desktop/frontend run typecheck   # PASS
npm --prefix apps/desktop/frontend run test        # 52 files / 267 passed
npx eslint <changed> && npx prettier --check <changed>   # 0 error / 全过
node -e "JSON.parse(fs.readFileSync('package-lock.json'))"  # lockfile 有效 JSON
```

## 边界

- 真机 Tauri 下 markdown 表格 / 删除线实际观感归 E2E-1 真机波。
- 仅助手消息路径启用 GFM；用户消息仍纯文本气泡。
