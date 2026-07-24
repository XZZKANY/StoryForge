# 验证报告 · UI/UX 审计 Ctrl+K 行间 diff 句内高亮（E22）

时间：2026-07-24
分支：`feat/uiux-inline-char-diff-20260724`

审计「编辑器与改稿反馈」主题里最后一条（P3-L）：Ctrl+K 行间 diff 只做整行红/绿，改一个词也整行标记。

## 变更（全前端）

- **E22 单行替换的句内高亮**：
  - `lib/inline-chat.ts` 加纯函数 `intraLineChangeRange(oldLine, newLine)`——掐掉公共前缀/后缀，只留真正改动的中段（1-based 列、endCol 独占，纯插入/删除时该侧零宽）；
  - `useInlineChat.renderDiff`：对**单行替换**（一旧行→一新行）的 hunk，在整行淡红底之上叠一层句内红高亮 `sf-inline-diff-old-seg`（Monaco 字符级 decoration）；
  - `buildDiffZoneDom`：绿新行把改动中段包成 `sf-inline-diff-new-seg` span、前后逐字保留；
  - `index.css` 加两个 seg 高亮类；多行 hunk / 纯增删 graceful 回退整行铺色（不做句内高亮）。
  - 有界实现：不改 hunk→行级 diff 管线（`hunksToLineDiff` 的整行塌陷/去重不动），句内区间在 renderDiff 就地按旧/新行文本算，
    避免重构核心 Ctrl+K 流的高风险。

## 验证

```bash
npm --prefix apps/desktop/frontend run typecheck   # PASS
npm --prefix apps/desktop/frontend run test        # 52 files / 275 passed（+1 新：intraLineChangeRange 纯函数，含中文改词 / 纯插入 / 全改）
npm --prefix apps/desktop/frontend run build       # 构建成功
npx eslint <3 touched>                             # 0 problems
npx prettier --check <touched incl. index.css>     # 通过
```

句内高亮渲染是 Monaco decoration + view-zone DOM，SSR 测不到；纯区间函数已单测，真机观感归 E2E-1 未验。

---

至此 2026-07-24 UI/UX 审计 80 条已全部逐桶 branch→PR→merge 收口（PR #159-176）。
