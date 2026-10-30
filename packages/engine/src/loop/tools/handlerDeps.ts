import type { RegexCompiler } from '../../kernel/fsProjectTools';
import type { ProposalEnvironment } from '../../kernel/knowledgeProposals';
import type { SecretContext } from '../../kernel/redaction';
import type { ProjectReader } from '../../readPort';
import type { ProjectWriter } from '../../writePort';

/** 已落库的 artifact 查询（P4 前由内存存储实现）。 */
export interface ToolArtifactQuery {
  /** 这次 run 是否已经有某种 artifact。 */
  runHasArtifact(runId: string, kind: string): Promise<boolean>;
  /** 所有 run 里某种 artifact 的载荷（知识提议跨 run 去重要用）。 */
  artifactPayloads(kind: string): Promise<readonly unknown[]>;
}

/** 工具处理器的外部依赖；处理器本身无状态，依赖在注册时绑定。 */
export type ToolDeps = {
  readonly reader: ProjectReader;
  readonly writer: ProjectWriter;
  readonly platform: 'windows' | 'posix';
  readonly secrets: SecretContext;
  readonly proposals: ProposalEnvironment;
  readonly artifacts: ToolArtifactQuery;
  /** fs.search 的正则编译器；缺省用进程内 JS RegExp。 */
  readonly regex?: RegexCompiler;
  /** 单调时钟（秒），只给正则累计预算用。 */
  readonly clock?: () => number;
  /** 补丁与审稿报告的随机 id（Python 的 uuid4().hex，32 位十六进制）。 */
  readonly newHex: () => string;
  /** 本机插件库根目录；缺省或 null 是没有插件。 */
  readonly pluginLibraryRoot?: string | null;
};
