import type {
  ApiKnowledgeProposalInbox,
  ApiKnowledgeProposalItemEdit,
  ApiKnowledgeProposalPatch,
  ApiKnowledgeProposalResolveRequest,
} from './contracts';
import { getApiConfig, trimApiBaseUrl } from './config';
import { readErrorDetail } from './errors';

const API_PATH = '/api/agent-runs/knowledge-proposals';

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

export function queryKnowledgeProposals(projectRoot: string): Promise<ApiKnowledgeProposalInbox> {
  return postKnowledgeApi('query', { project_root: projectRoot });
}

export function refreshKnowledgeProposals(projectRoot: string): Promise<ApiKnowledgeProposalInbox> {
  return postKnowledgeApi('refresh', { project_root: projectRoot });
}

export function reviseKnowledgeProposalGroup(input: {
  projectRoot: string;
  artifactId: number;
  revision: number;
  proposals: ApiKnowledgeProposalItemEdit[];
}): Promise<ApiKnowledgeProposalInbox> {
  return postKnowledgeApi('revise', {
    project_root: input.projectRoot,
    artifact_id: input.artifactId,
    revision: input.revision,
    proposals: input.proposals,
  });
}

export function materializeKnowledgeProposal(input: {
  projectRoot: string;
  artifactId: number;
  revision: number;
  proposalId: string;
}): Promise<ApiKnowledgeProposalPatch> {
  return postKnowledgeApi('materialize', {
    project_root: input.projectRoot,
    artifact_id: input.artifactId,
    revision: input.revision,
    proposal_id: input.proposalId,
  });
}

export function resolveKnowledgeProposal(
  input: ApiKnowledgeProposalResolveRequest,
): Promise<ApiKnowledgeProposalInbox> {
  return postKnowledgeApi('resolve', input);
}
