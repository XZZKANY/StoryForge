import type {
  ApiKnowledgeProposalInbox,
  ApiKnowledgeProposalItemEdit,
  ApiKnowledgeProposalPatch,
  ApiKnowledgeProposalResolveRequest,
} from './contracts';

/** 提议是 run 的 artifact，与会话、run 同在引擎库。 */
const engine = () => import('../engine/knowledge');

export async function refreshKnowledgeProposals(
  projectRoot: string,
): Promise<ApiKnowledgeProposalInbox> {
  return (await engine()).refreshEngineKnowledge(projectRoot);
}

export async function reviseKnowledgeProposalGroup(input: {
  projectRoot: string;
  artifactId: number;
  revision: number;
  proposals: ApiKnowledgeProposalItemEdit[];
}): Promise<ApiKnowledgeProposalInbox> {
  return (await engine()).reviseEngineKnowledge(input);
}

export async function materializeKnowledgeProposal(input: {
  projectRoot: string;
  artifactId: number;
  revision: number;
  proposalId: string;
}): Promise<ApiKnowledgeProposalPatch> {
  return (await engine()).materializeEngineKnowledge(input);
}

export async function resolveKnowledgeProposal(
  input: ApiKnowledgeProposalResolveRequest,
): Promise<ApiKnowledgeProposalInbox> {
  return (await engine()).resolveEngineKnowledge(input);
}
