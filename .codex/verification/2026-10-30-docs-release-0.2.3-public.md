## 2026-10-30 记 0.2.3 公开发布

- 改动：`docs/internal/TODO.md` 当前入口改为「0.2.3 已出并公开发布」，记下 Release 地址、tag 与安装包名。只改文档。
- 验证：`gh release view v0.2.3`：非草稿、Latest，发布于 2026-10-30T06:22:09Z；`git rev-parse v0.2.3^{commit}` = `7aa6a6c8`；资产 `StoryForge-IDE_0.2.3_x64-setup.exe` 31,282,569 字节，GitHub 记录的 digest `sha256:ad5fe0b0…5a93ce` 与出包记录一致；发布说明正文与 `output/release-0.2.3/release-notes.md` 开头一致。
- 未覆盖：无代码改动。
