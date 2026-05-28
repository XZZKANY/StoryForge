## 项目上下文摘要（storyforge-vscode-ide-p1-real-commands）

生成时间：2026-05-28 21:30:19

### 1. 相似实现分析

- **实现1**: pps/api/tests/test_judge_repair.py
  - 模式：通过 Book → Chapter → Scene → ScenePacket 准备最小故事上下文，再调用 /api/judge/issues 和 /api/repair/patches 验证结构化问题单与补丁。
  - 可复用：JudgeIssue、RepairPatch 状态断言；content、equired_facts、style_rules、evidence_links 请求形态。
  - 需注意：Repair 生成后把 JudgeIssue.status 与 RepairPatch.status 置为 equires_rejudge。
- **实现2**: pps/api/app/domains/repair/service.py
  - 模式：create_repair_patch(session, RepairPatchCreate(...)) 从已有 JudgeIssue 的 span 与 payload 生成局部替换补丁。
  - 可复用：RepairPatchCreate、RepairInputError、create_repair_patch。
  - 需注意：必须传入与 JudgeIssue span 匹配的当前正文，否则会拒绝修复。
- **实现3**: pps/api/app/domains/studio/service.py
  - 模式：pprove_studio_writeback(session, StudioApprovalExecuteRequest(repair_patch_id=...)) 对 RepairPatch 执行真实写回，更新 scene.content、scene.status、chapter.status、epair_patch.status、issue.status，并创建连续性记录。
  - 可复用：StudioApprovalExecuteRequest、pprove_studio_writeback。
  - 需注意：章节已批准或补丁状态非 proposed/requires_rejudge 时返回不可执行结果。
- **实现4**: pps/api/app/domains/ide/service.py
  - 模式：execute_ide_command_by_id 统一返回 IdeCommandResult，写命令生成 ide-command:<id>:<uuid> 审计 ID。
  - 可复用：IdeCommandDefinition、IdeCommandResult、命令目录。
  - 需注意：当前函数未接收数据库会话，导致 Judge/Repair/Approve 只能返回薄壳结果。

### 2. 项目约定

- **命名约定**: Python 使用 snake_case；测试函数使用 	est_...；Pydantic schema 以动词/领域名 + Read/Create/Request 命名。
- **文件组织**: 后端领域按 pps/api/app/domains/<domain>/router.py|service.py|schemas.py|models.py 拆分；测试放在 pps/api/tests/test_*.py。
- **导入顺序**: rom __future__ import annotations → 标准库 → 第三方 → 项目内导入。
- **代码风格**: 简体中文 docstring；服务层抛领域异常，路由层转换 HTTP；写入后 commit 并按需 efresh。

### 3. 可复用组件清单

- pp.domains.judge.service.create_judge_issues: 创建真实 JudgeIssue。
- pp.domains.judge.schemas.JudgeIssueCreate: Judge 请求契约。
- pp.domains.repair.service.create_repair_patch: 创建真实 RepairPatch。
- pp.domains.repair.schemas.RepairPatchCreate: Repair 请求契约。
- pp.domains.studio.service.approve_studio_writeback: 执行 RepairPatch 写回。
- pp.domains.studio.schemas.StudioApprovalExecuteRequest: Approve 请求契约。
- pp.domains.ide.schemas.IdeCommandResult: IDE 命令统一响应。

### 4. 测试策略

- **测试框架**: pytest + FastAPI TestClient，内存 SQLite，pps/api/tests/conftest.py 覆盖数据库依赖。
- **测试模式**: API 集成测试优先，直接验证数据库状态。
- **参考文件**: pps/api/tests/test_judge_repair.py、pps/api/tests/test_approval_writeback.py、pps/api/tests/test_ide_commands.py。
- **覆盖要求**: judge.run 创建问题单；judge.repair 创建补丁；judge.approve 真实写回并返回审计信息；未知命令仍返回 404。

### 5. 依赖和集成点

- **外部依赖**: FastAPI、SQLAlchemy、Pydantic、pytest。
- **内部依赖**: IDE 路由需要把 SessionDependency 传给命令服务；命令服务调用 Judge、Repair、Studio 服务。
- **集成方式**: POST /api/ide/commands/{command_id} 作为统一入口；WebSocket Agent 也复用同一命令执行器。
- **配置来源**: API 测试通过 conftest.py 清理远程 LLM 环境变量，保证确定性本地 Judge。

### 6. 技术选型理由

- **为什么用这个方案**: 复用现有 Judge/Repair/Studio 服务，避免在 IDE 层重写业务逻辑。
- **优势**: 命令层变成真实编排层，保留审计 ID 和既有 API 行为。
- **劣势和风险**: execute_ide_command_by_id 需要新增可选 session 参数，路由和 WebSocket 调用点要同步；旧薄壳测试需要调整为真实参数或保留非 Judge 命令薄壳断言。

### 7. 关键风险点

- **并发问题**: 当前内存测试单请求执行，无并发写入；真实环境需关注同一 patch 重复 approve。
- **边界条件**: 缺失 content、issue_id、epair_patch_id 时应返回可诊断失败，而不是静默 accepted。
- **性能瓶颈**: 命令执行只复用现有单条服务调用，额外开销低。
- **安全考虑**: 本轮只做沙箱内命令真实化，不新增认证或权限控制。
