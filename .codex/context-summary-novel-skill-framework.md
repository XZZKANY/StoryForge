## 项目上下文摘要（Novel Skill Framework 阶段一）

生成时间：2026-05-31 04:36:48 +08:00

### 1. 相似实现分析

- **实现1**: pps/workflow/storyforge_workflow/tools/registry.py
  - 模式：dataclass(frozen=True) 描述静态能力，CreativeToolRegistry 用 tuple 保持顺序，用 MappingProxyType 构建只读索引。
  - 可复用：静态注册表、重复名称校验、明确缺失错误、序列字段归一化。
  - 需注意：本任务不抽象共享基类，避免扩大阶段一改动半径。
- **实现2**: pps/workflow/storyforge_workflow/orchestrators/novel_loop.py
  - 模式：端口注入 + 单章顺序状态机，真实终态只有 pproved 和 waiting_review。
  - 可复用：NovelLoopResult 字段作为审计摘要的事实来源；memory_atom_ids 只在结果中保留引用。
  - 需注意：不得引入 epair_required、epair_limit_exceeded、provider_failed、udget_exceeded 等虚构终态。
- **实现3**: pps/workflow/storyforge_workflow/orchestrators/book_loop.py
  - 模式：BookLoop 汇总 completed_chapters、checkpoint、udget，在 Book 级处理预算和 provider 降级。
  - 可复用：progress 的 completed_chapters、locked_chapter、pause_reason、provider_degradation 作为只读派生输入。
  - 需注意：checkpoint 只保存 chapter_index、model_run_id、judge_report_id、approved_scene_id。
- **实现4**: pps/workflow/tests/test_creative_tool_registry.py
  - 模式：pytest plain assert、pytest.raises(..., match=...)、中文测试意图注释，断言内容而非文件存在。
  - 可复用：注册表顺序、字段完整性、不可变性和缺失错误测试风格。

### 2. 项目约定

- **命名约定**: Python 包与函数使用 snake_case；类使用 PascalCase；常量使用大写或语义化默认实例名。
- **文件组织**: workflow 代码位于 pps/workflow/storyforge_workflow/；测试位于 pps/workflow/tests/；新增阶段一模块放入 storyforge_workflow/skills/。
- **导入顺序**: rom __future__ import annotations 在文件首行；标准库、第三方、项目导入分组；ruff 规则启用 I 排序。
- **代码风格**: pyproject.toml 设定 Python >=3.11、ruff 行宽 120、pytest testpaths 为 	ests。

### 3. 可复用组件清单

- pps/workflow/storyforge_workflow/tools/registry.py: 静态注册表设计模式参考。
- pps/workflow/storyforge_workflow/orchestrators/book_loop.py: progress 结构和 Book 级状态事实源。
- pps/workflow/storyforge_workflow/orchestrators/novel_loop.py: 单章状态、端口和引用字段事实源。
- pps/workflow/tests/test_creative_tool_registry.py: 注册表测试模式。
- pps/workflow/tests/test_book_loop_three_chapters.py: progress 样例与预算/provider 降级样例。

### 4. 测试策略

- **测试框架**: pytest 9.x（Context7 查询确认可用 plain assert 与 pytest.raises(..., match=...)）。
- **测试模式**: deterministic 单元测试，不依赖真实 LLM、数据库或网络。
- **参考文件**: pps/workflow/tests/test_creative_tool_registry.py、pps/workflow/tests/test_book_loop_three_chapters.py、pps/workflow/tests/test_generation_state_references.py。
- **覆盖要求**: 注册表 6 技能顺序与字段完整性；禁止虚构状态；audit 派生覆盖 approved、blocked、预算暂停、provider 降级；输入 progress 深比较不变。

### 5. 依赖和集成点

- **外部依赖**: Python 标准库 dataclasses、collections.abc、copy；pytest；无新增运行时依赖。
- **内部依赖**: 新包 storyforge_workflow.skills 不反向依赖 orchestrators；udit.py 只读取 Mapping[str, Any]，避免耦合 BookLoop 类型。
- **集成方式**: 阶段一为旁路定义和只读派生，不接入运行时，不修改 un_single_chapter_loop() 或 un_book_loop()。
- **配置来源**: pps/workflow/pyproject.toml 定义 pytest、ruff 和 Python 版本。

### 6. 技术选型理由

- **为什么用静态 dataclass + registry**: 设计文档要求第一阶段静态注册，不做动态发现；项目已有 CreativeToolRegistry 成熟模式。
- **优势**: 可审计、确定性强、无 I/O、测试简单；保持未来第二阶段 Runner 可复用这些定义。
- **劣势和风险**: SKILL.md 与 Python 定义存在重复，需要测试和审查约束关键字段一致；阶段一不自动读取 SKILL.md 是有意限制。

### 7. 关键风险点

- **并发问题**: 无共享可变状态；registry 使用 tuple 和不可变 dataclass。
- **边界条件**: progress 缺少可选 ID 时输出 None 或空数组，不编造引用。
- **性能瓶颈**: audit 派生 O(n) 遍历章节，n 为章节数，无外部 I/O。
- **安全考虑**: 阶段一禁止动态扫描或执行技能文件，避免把文件化定义变成插件执行面。

### 8. 外部检索记录

- **Context7**: 查询 /pytest-dev/pytest，确认 pytest plain assert 与 pytest.raises(..., match=...) 用法。
- **GitHub search_code**: 搜索静态 registry/dataclass 示例；首轮精确搜索无结果，泛化搜索返回 PyTorch、Canonical Operator 等大型项目条目，最终只作为“静态 registry 常见模式”参考，不直接复制实现。
- **工具回退**: desktop-commander 未在当前工具集中可用（tool_search 结果 0），本地文件检索使用 PowerShell 与 g，已记录。

### 9. 充分性检查

- ✅ 我能定义清晰接口契约：NovelSkillDefinition 与 derive_skill_chain_summary(progress: Mapping[str, Any]) -> dict[str, Any]。
- ✅ 我理解技术选型理由：静态定义 + 只读派生，符合阶段一不改运行时要求。
- ✅ 我识别主要风险：状态虚构、输入被修改、SKILL.md/Python 定义漂移。
- ✅ 我知道如何验证：定向 pytest + ruff，本地执行并生成 .codex/verification-report.md。
