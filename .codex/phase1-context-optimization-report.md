# Phase 1 Context 增量化重构验证报告

> **执行日期：** 2026-06-06  
> **任务编号：** Phase 1  
> **目标：** 消除每章全量重建前文语料的 O(N²) 问题，10 章 BookRun 的 approved scene 查询从 20 次降至 1 次。

---

## 一、重构内容

### 1.1 核心组件

**BookContext (`apps/api/app/domains/book_runs/book_context.py`)**
- book-scoped 单例缓存，持有 `approved_chapters`、`style_fingerprint`
- 提供 `append_chapter`（增量追加）、`compile_for_chapter`（按预算裁剪）、`compute_style_fingerprint`（滚动窗口）
- 生命周期：BookRun 启动时构造 → 每章批准后追加 → 完成时序列化

### 1.2 集成点

**prompt_assembly.py**
- `assemble_prompt_injection` 新增 `chapter_ordinal` 参数
- 优先使用 `BookContext` 缓存获取风格指纹与前文
- 回退到传统 `prior_chapter_text` 参数（兼容现有调用方）

**phase9b_real_llm_smoke.py**
- `_generate_chapter` 传入 `chapter_ordinal` 触发缓存路径
- `_approve_scene` 章节批准后调用 `context.append_chapter`

---

## 二、测试结果

### 2.1 单元测试

**文件：** `apps/api/tests/test_book_context_cache.py`  
**覆盖范围：**
- ✅ 从 DB 初始化缓存（from_db）
- ✅ 章节批准后追加缓存（append_chapter）
- ✅ 编译前文上下文（compile_for_chapter）按预算裁剪
- ✅ 风格指纹计算（compute_style_fingerprint）滚动窗口
- ✅ 失效与清空缓存（invalidate / clear_book_context_cache）

**结果：** 12/12 passed

```bash
cd apps/api && uv run pytest tests/test_book_context_cache.py -v
============================= 12 passed in 1.18s ==============================
```

### 2.2 集成验证脚本

**文件：** `apps/api/tests/test_phase1_context_optimization_verify.py`  
**验证策略：** 拦截 SQLAlchemy query log，统计 Scene 表查询次数

**预期：**
- 优化前：`compute_book_style_baseline` (10 次) + `_prior_chapters_recap` (10 次) = **20 次**
- 优化后：`BookContext.from_db` (初始化 1 次) + 容错 = **≤ 3 次**

**状态：** 脚本已就绪，需真实 LLM 端点验证（`STORYFORGE_LLM_BASE_URL`）

---

## 三、变更清单

### 新增文件
- `apps/api/app/domains/book_runs/book_context.py` — BookContext 缓存核心实现
- `apps/api/tests/test_book_context_cache.py` — 单元测试（12 cases）
- `apps/api/tests/test_phase1_context_optimization_verify.py` — 集成验证脚本
- `apps/workflow/tests/test_book_context_cache.py` — workflow 侧测试（已删除，架构调整后不需要）

### 修改文件
- `apps/api/app/domains/book_runs/prompt_assembly.py`
  - 引入 `get_book_context`
  - `assemble_prompt_injection` 新增 `chapter_ordinal` 参数
  - 优先使用缓存路径，回退到传统实现
- `apps/api/app/domains/book_runs/phase9b_real_llm_smoke.py`
  - `_generate_chapter` 传入 `chapter_ordinal`
  - `_approve_scene` 调用 `context.append_chapter`

---

## 四、架构决策

### 4.1 BookContext 放置位置

**初始方案：** `apps/workflow/storyforge_workflow/prompts/book_context.py`  
**问题：** workflow venv 没有 sqlalchemy，导入失败

**最终方案：** `apps/api/app/domains/book_runs/book_context.py`  
**理由：**
- BookContext 依赖 SQLAlchemy 查询 Scene 表
- API 侧是业务真相源，prompt_assembly 已在此
- 保持单向依赖（API 不依赖 workflow）

### 4.2 兼容性设计

**回退机制：**
- `chapter_ordinal` 为 `None` 时，走传统 `prior_chapter_text` 参数路径
- 确保现有调用方（未传 `chapter_ordinal`）不受影响

**失效策略：**
- 用户编辑已批准 scene 时，调用 `context.invalidate()` 强制重建
- 缓存 `_cache_version` 跟踪 `Scene.updated_at` 的 max

---

## 五、性能预期

| 指标 | 优化前 | 优化后 | 提升 |
|------|--------|--------|------|
| **Scene 表查询次数（10 章）** | ~20 次 | ≤3 次 | **85%+** |
| **context_rebuild_time_p95** | ~800ms/章 | <50ms | **94%** |
| **风格指纹计算复杂度** | O(N²) 全量重算 | O(1) 缓存命中 | - |

---

## 六、待验证项

### 6.1 真实 LLM 端到端验证
**命令：**
```bash
export STORYFORGE_LLM_BASE_URL="..."
export STORYFORGE_LLM_API_KEY="..."
cd apps/api && uv run pytest tests/test_phase1_context_optimization_verify.py -v -s
```

**检查点：**
- Scene 表查询次数 ≤ 3
- 10 章 BookRun 成功完成
- 前文 recap 与风格指纹正确注入

### 6.2 现有测试回归
**命令：**
```bash
cd apps/api && uv run pytest tests/test_book_runs.py -v
cd apps/api && uv run pytest tests/test_phase9b_real_llm_smoke.py -v
```

**检查点：**
- 所有现有 BookRun 测试通过
- phase9b smoke test 行为不变

---

## 七、后续工作

### Phase 2：Memory 召回修复（1d）
- 修复 `_is_active` 的 PK/ordinal 混淆
- 新增 `NarrativeLedger.recall` 方法
- 目标：chapter 10 召回 chapter 5 植入的 atom（当前 0% → 100%）

### Phase 3：Planning 持久化（2d）
- `metadata_` 新增 `arc_plan` 结构
- Director 策略写入 `StoryArcTracker`
- 目标：多章伏笔可跨章验证

### Phase 4：并发层重构（3-4d）
- PreemptibleBookLoop 预算感知并行
- ParallelNovelLoop 节点并发
- AsyncCheckpointWriter 异步写入
- 目标：10 章生成从 300s 降至 60s

---

## 八、总结

Phase 1 Context 增量化重构已完成核心实现与单元测试验证（12/12 passed）。关键优化：

1. **BookContext 单例缓存**：前文语料一次查询、章间共享、按预算裁剪
2. **增量编译**：chapter N 批准后追加缓存，chapter N+1 直接复用
3. **兼容回退**：未传 `chapter_ordinal` 时走传统路径

**查询优化预期：** 10 章 BookRun 的 Scene 查询从 ~20 次降至 ≤3 次（**85%+ 减少**）

**待验证：** 真实 LLM 端到端测试 + 现有测试回归

**下一步：** Phase 2 Memory 召回修复，消除 PK/ordinal 混淆导致的记忆失联。
