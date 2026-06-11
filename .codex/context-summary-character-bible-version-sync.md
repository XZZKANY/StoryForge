## 项目上下文摘要（Character Bible 版本与同步契约）

生成时间：2026-06-02 19:30:00 +08:00

### 1. 相似实现分析

- **实现1**: `apps/api/app/domains/assets/models.py`、`apps/api/app/domains/assets/service.py`
  - 模式：`VersionMixin` + `lineage_key`，更新时复制最新版本并插入新行。
  - 可复用：`latest_by_lineage()`、`version + 1`、历史按 `lineage_key` 升序读取。
  - 需注意：不原地覆盖旧版本，列表只返回最新版本。
- **实现2**: `apps/api/app/domains/series/models.py`、`apps/api/app/domains/series/service.py`
  - 模式：系列记忆按谱系保留历史版本，并复制证据。
  - 可复用：历史 endpoint、复制上一版本、保留来源证据。
  - 需注意：新版本创建后重新读取，避免懒加载问题。
- **实现3**: `apps/api/app/domains/story_memory/models.py`、`apps/api/app/domains/story_memory/service.py`
  - 模式：`MemoryAtomRecord` 用 `revision`、`source_ref` 和章节范围保存长期事实。
  - 可复用：`create_memory_atom()` 写入可审计角色事实。
  - 需注意：`value` 是文本字段，结构化内容需要 JSON 字符串并避免敏感字段。

### 2. 项目约定

- **命名约定**: Python snake_case，模型 PascalCase，Pydantic schema 使用 `Create/Update/Read` 后缀。
- **文件组织**: 领域内保持 `models.py`、`schemas.py`、`service.py`、`router.py` 分层。
- **导入顺序**: 标准库、第三方、项目内模块。
- **代码风格**: SQLAlchemy 2.0 `Mapped/mapped_column`，Pydantic v2，中文 docstring。

### 3. 可复用组件清单

- `app.db.base.VersionMixin`: 提供 `version` 字段。
- `app.db.queries.latest_by_lineage`: 列表读取每条谱系最新版本。
- `app.domains.story_memory.service.create_memory_atom`: 同步写入 Story Memory。
- `app.domains.character_bible.service._ensure_book_exists`: 作品存在校验。
- `app.domains.character_bible.service._ensure_character_asset`: 角色资产归属校验。

### 4. 测试策略

- **测试框架**: pytest + FastAPI TestClient。
- **测试模式**: 先写 API 红测，再实现模型/schema/service/router。
- **参考文件**: `apps/api/tests/test_character_bible_api.py`、`apps/api/tests/test_series_memory.py`、`apps/api/tests/test_assets_api.py`。
- **覆盖要求**: 表字段、创建首版本、更新生成新版本、列表只返回最新版本、历史返回版本链、Story Memory 同步事实、Prompt/Judge 读侧不回退。

### 5. 依赖和集成点

- **外部依赖**: SQLAlchemy、Pydantic、FastAPI、Alembic。
- **内部依赖**: Character Bible、Story Memory、Asset、Book。
- **集成方式**: Character Bible service 在创建/更新后同步写入 MemoryAtom；router 增加 history endpoint。
- **配置来源**: 不涉及 Provider 配置和密钥。

### 6. 技术选型理由

- **为什么用这个方案**: 项目已有资产和系列记忆的版本谱系模式，直接复用比新增自研历史表更一致。
- **优势**: 历史不可覆盖；列表默认最新；Story Memory 可被后续上下文装配读取。
- **劣势和风险**: 每次 Character Bible 写入会同步一条 MemoryAtom，后续若批量导入需关注写入次数。

### 7. 关键风险点

- **并发问题**: 同一谱系并发更新可能产生相同 next version，后续需要乐观锁或唯一约束。
- **边界条件**: 删除应按谱系删除，避免旧版本残留在列表或历史中。
- **性能瓶颈**: 最新版本查询依赖 `lineage_key/version` 索引。
- **安全考虑**: 同步到 Story Memory 的内容只包含角色规则摘要，不包含 Provider 凭据。
