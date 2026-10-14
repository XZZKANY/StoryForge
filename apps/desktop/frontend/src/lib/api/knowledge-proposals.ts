import type {
  ApiKnowledgeProposalInbox,
  ApiKnowledgeProposalItemEdit,
  ApiKnowledgeProposalPatch,
  ApiKnowledgeProposalResolveRequest,
} from './contracts';
import { getApiConfig, trimApiBaseUrl } from './config';
import { readErrorDetail } from './errors';
import { sessionsInEngine } from '../engine/flags';

const API_PATH = '/api/agent-runs/knowledge-proposals';

/** 提议是 run 的 artifact：跟着会话与 run 放在哪个库走（ts 档在引擎库；Python 档不初始化引擎）。 */
const engine = () => import('../engine/knowledge');

async function postKnowledgeApi<T>(action: string, body: object): Promise<T> {
  const { baseUrl, apiKey } = await getApiConfig();
  const response = await fetch(`${trimApiBaseUrl(baseUrl)}${API_PATH}/${action}`, {
    method: 'POST',
    cache: 'no-store',
    headers: {
      'Content-Type': 'application/json',
      'X-StoryForge-API-Key': apiKey,
    },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(await readErrorDetail(response));
  return (await response.json()) as T;
}

export async function refreshKnowledgeProposals(
  projectRoot: string,
): Promise<ApiKnowledgeProposalInbox> {
  if (sessionsInEngine()) return (await engine()).refreshEngineKnowledge(projectRoot);
  return postKnowledgeApi('refresh', { project_root: projectRoot });
}

export async function reviseKnowledgeProposalGroup(input: {
  projectRoot: string;
  artifactId: number;
  revision: number;
  proposals: ApiKnowledgeProposalItemEdit[];
}): Promise<ApiKnowledgeProposalInbox> {
  if (sessionsInEngine()) return (await engine()).reviseEngineKnowledge(input);
  return postKnowledgeApi('revise', {
    project_root: input.projectRoot,
    artifact_id: input.artifactId,
    revision: input.revision,
    proposals: input.proposals,
  });
}

export async function materializeKnowledgeProposal(input: {
  projectRoot: string;
  artifactId: number;
  revision: number;
  proposalId: string;
}): Promise<ApiKnowledgeProposalPatch> {
  if (sessionsInEngine()) return (await engine()).materializeEngineKnowledge(input);
  return postKnowledgeApi('materialize', {
    project_root: input.projectRoot,
    artifact_id: input.artifactId,
    revision: input.revision,
    proposal_id: input.proposalId,
  });
}

export async function resolveKnowledgeProposal(
  input: ApiKnowledgeProposalResolveRequest,
): Promise<ApiKnowledgeProposalInbox> {
  if (sessionsInEngine()) return (await engine()).resolveEngineKnowledge(input);
  return postKnowledgeApi('resolve', input);
}
