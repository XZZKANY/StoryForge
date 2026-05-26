export type Phase6DataSourceStatus =
  | 'Web 单点读取已实现'
  | 'API 最小契约已实现'
  | '已有契约但未联通'
  | '完全不存在';

export type Phase6DataSource = {
  readonly page: string;
  readonly contractSection: string;
  readonly nextAction: string;
  readonly name: string;
  readonly input: string;
  readonly output: string;
  readonly status: Phase6DataSourceStatus;
};

type Phase6DataSourceSeed = Omit<Phase6DataSource, 'page' | 'contractSection' | 'nextAction'>;

const withTrace = (
  page: string,
  contractSection: string,
  nextAction: string,
  sources: readonly Phase6DataSourceSeed[],
): readonly Phase6DataSource[] =>
  sources.map((source) => ({ page, contractSection, nextAction, ...source }));

export const phase6DataSources = {
  studio: withTrace(
    'Studio',
    'Studio 数据源契约',
    '从批准回写 API 做 Studio 单页面单数据源真实读取 spike',
    [
      {
        name: '作品列表 API',
        input: '当前工作区或默认项目上下文',
        output: '作品 ID、标题、最近章节编号',
        status: 'Web 单点读取已实现',
      },
      {
        name: '章节目标 API',
        input: '作品 ID、目标章节编号',
        output: '章节目标、上章摘要、连续性约束',
        status: 'Web 单点读取已实现',
      },
      {
        name: 'Scene Packet API',
        input: '作品 ID、章节 ID、场景目标',
        output: 'scene_packet_id、证据链接、上下文预算摘要',
        status: 'Web 单点读取已实现',
      },
      {
        name: 'Judge 评审 API',
        input: '草稿或 draft_artifact_id、scene_packet_id',
        output: '问题列表、严重级别、位置和建议',
        status: 'Web 单点读取已实现',
      },
      {
        name: 'Repair 修订 API',
        input: 'Judge 问题、草稿引用、修订策略',
        output: '修订文本、差异摘要、采纳建议',
        status: 'Web 单点读取已实现',
      },
      {
        name: '批准回写 API',
        input: '修订结果、审批决策、章节 ID',
        output: '已批准章节版本、回写状态、后续任务引用',
        status: 'Web 单点读取已实现',
      },
      {
        name: '失败恢复 API',
        input: 'job_run_id、checkpoint 引用、失败节点',
        output: '可恢复步骤、错误摘要、重试入口状态',
        status: 'Web 单点读取已实现',
      },
    ],
  ),
  retrieval: withTrace(
    'Retrieval',
    'Retrieval 数据源契约',
    '从证据跳转路由或重排状态 API 做 Retrieval 单页面单数据源真实读取 spike',
    [
      {
        name: '资料源列表 API',
        input: '作品 ID、来源类型过滤',
        output: '用户上传、章节快照、系列记忆、Prompt Pack 来源列表',
        status: 'Web 单点读取已实现',
      },
      {
        name: '刷新任务 API',
        input: '资料源 ID、刷新范围、embedding provider',
        output: 'refresh run ID、chunk 引用、provider 元数据、刷新状态',
        status: 'Web 单点读取已实现',
      },
      {
        name: '搜索请求 API',
        input: '查询文本、作品 ID、topK、reranker 开关',
        output: 'search request ID、命中列表、score、rerank 顺序',
        status: 'Web 单点读取已实现',
      },
      {
        name: '命中预览 API',
        input: 'hit ID 或 chunk 引用',
        output: '片段摘要、来源标题、预算 token、关联章节',
        status: 'Web 单点读取已实现',
      },
      {
        name: '证据跳转 API',
        input: 'evidence link、source_ref、chunk_ref',
        output: '可跳转目标、锚点摘要、不可用原因',
        status: '已有契约但未联通',
      },
      {
        name: '重排状态 API',
        input: 'search request ID、reranker provider',
        output: 'rerank provider、model、score 和降级状态',
        status: '已有契约但未联通',
      },
    ],
  ),
  runs: withTrace(
    'Runs',
    'Runs 数据源契约',
    '从 Runs 页面读取 JobRun 状态 API 做单页面单数据源真实读取 spike',
    [
      {
        name: 'JobRun 状态 API',
        input: 'job_run_id 或作品/章节过滤',
        output: '当前节点、运行状态、错误摘要、恢复提示',
        status: 'Web 单点读取已实现',
      },
      {
        name: 'Checkpoint 引用 API',
        input: 'job_run_id、checkpoint ID',
        output: 'scene_packet_id、compiled_context_id、model_run_id、恢复节点',
        status: 'Web 单点读取已实现',
      },
      {
        name: 'ModelRun 日志 API',
        input: 'job_run_id、provider 或状态过滤',
        output: 'provider、model、token、latency、错误消息和 payload 摘要',
        status: 'Web 单点读取已实现',
      },
      {
        name: '失败重试 API',
        input: 'job_run_id、失败节点、checkpoint 引用',
        output: '重试资格、重试任务引用、不可重试原因',
        status: '已有契约但未联通',
      },
    ],
  ),
  artifacts: withTrace(
    'Artifacts',
    'Artifacts 数据源契约',
    '从导出物 API 做单页面单数据源真实读取 spike',
    [
      {
        name: '导出物 API',
        input: '作品 ID、章节 ID、导出类型',
        output: 'artifact ID、文件名、版本、下载状态、详情和下载摘要',
        status: 'Web 单点读取已实现',
      },
      {
        name: '上传资料 API',
        input: '作品 ID、资料来源类型',
        output: '上传对象、入库状态、检索刷新引用',
        status: '已有契约但未联通',
      },
      {
        name: '工作流快照 API',
        input: 'job_run_id、checkpoint 引用',
        output: '快照摘要、关联节点、上下文引用和恢复状态',
        status: '已有契约但未联通',
      },
      {
        name: '评测报告 API',
        input: 'evaluation run ID、artifact ID',
        output: '报告摘要、指标、失败样例引用',
        status: '已有契约但未联通',
      },
    ],
  ),
  evaluations: withTrace(
    'Evaluations',
    'Evaluations 数据源契约',
    '从评测集 API 做单页面单数据源真实读取 spike',
    [
      {
        name: '评测集 API',
        input: '作品 ID、评测类型',
        output: 'eval set ID、样例数量、覆盖范围',
        status: '已有契约但未联通',
      },
      {
        name: '评测运行 API',
        input: 'eval set ID、模型或版本过滤',
        output: 'run ID、状态、开始/结束时间、关联制品、失败样例摘要',
        status: 'Web 单点读取已实现',
      },
      {
        name: '指标趋势 API',
        input: '指标名称、时间范围、作品 ID',
        output: '趋势点、均值、异常点摘要',
        status: '已有契约但未联通',
      },
      {
        name: '失败样例 API',
        input: 'eval run ID、失败类别',
        output: '样例 ID、失败原因、关联章节和修复建议',
        status: '已有契约但未联通',
      },
    ],
  ),
} satisfies Record<string, readonly Phase6DataSource[]>;

export const phase6FirstDataSourceSpike = phase6DataSources.studio[0];
