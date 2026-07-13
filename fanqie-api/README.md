# 番茄作者站接口（已验证真相）

> 2026-07-13 用 Playwright + 真实登录会话（Yu定调和 / 书「神秘遇见飞线」book_id=7659694677754399769）逐条实测。
> 原先两份文档的路径与 body 多为推断/编造，已按实测更正。

## 结论速览
| 能力 | 需要 | 需 a_bogus？ | 实测 |
|---|---|---|---|
| 读：验 cookie / 书单 / 卷 / 章 / 字数 / 审核态 | cookie | 否 | account_info、book_list、volume_list 均 200 真数据 |
| 写：建卷 / 建章 / 存稿 / 发布 | cookie + x-secsdk-csrf-token 头 + form body | 否（前端会带，服务端不校验，去掉照样 code:0） | new_article 无 a_bogus 返回 code:0 |

## 关键事实
1. 作者接口公共 query：aid=2503&app_name=muye_novel（作者端 React 应用代号 muye）。
2. 写请求 Content-Type = application/x-www-form-urlencoded，不是 JSON。
3. x-secsdk-csrf-token：secsdk JS 每次页面加载生成、每次不同、纯 HTTP 握手取不到（挑战返回空）。必须从加载过 muye 页面的浏览器/webview 取；取到后可跨请求复用（已实测）。
4. a_bogus / msToken：前端每次都带，但服务端不强制（去掉照样成功），无需逆向 JS-VM 签名。

## 读侧端点表（cookie-only，实测 200）
| 用途 | 端点（GET） | 关键 query |
|---|---|---|
| 验 cookie / 作者信息 | /api/author/account/info/v0/ | aid, app_name |
| 书单 | /api/author/homepage/book_list/v0/ | aid, app_name, page_count, page_index |
| 卷列表 | /api/author/volume/volume_list/v1 | aid, app_name, book_id |
| 章节列表 | /api/author/chapter/chapter_list/v1 | aid, app_name, book_id |
| 书详情 | /api/author/book/book_detail/v0/ | aid, app_name, book_id |

## 注意
本目录未纳入 git，之前被 git clean 清过。要保留请纳入版本控制或备份。