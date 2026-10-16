/**
 * 测试替身：知识提议收件箱接到可编排的 fetch 上（沿用早先 HTTP 传输的报文形状）。产品里提议在
 * 引擎库；浏览器回归（没有 Tauri 原生端口）经 `scripts/http-doubles-plugin.mjs` 换成它。
 */
import { getApiConfig, trimApiBaseUrl } from './http-config';
import { readErrorDetail } from '../../src/lib/api/errors';
import type {
  ApiKnowledgeProposalInbox,
  ApiKnowledgeProposalItemEdit,
  ApiKnowledgeProposalPatch,
  ApiKnowledgeProposalResolveRequest,
} from '../../src/lib/api/contracts';

async function postKnowledgeApi<T>(action: string, body: object): Promise<T> {
  const { baseUrl, apiKey } = await getApiConfig();
  const response = await fetch(
    `${trimApiBaseUrl(baseUrl)}/api/agent-runs/knowledge-proposals/${action}`,
    {
      method: 'POST',
      cache: 'no-store',
      headers: { 'Content-Type': 'application/json', 'X-StoryForge-API-Key': apiKey },
      body: JSON.stringify(body),
    },
  );
  if (!response.ok) throw new Error(await readErrorDetail(response));
  return (await response.json()) as T;
}

export async function refreshKnowledgeProposals(
  projectRoot: string,
): Promise<ApiKnowledgeProposalInbox> {
  return postKnowledgeApi('refresh', { project_root: projectRoot });
}

export async function reviseKnowledgeProposalGroup(input: {
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

export async function materializeKnowledgeProposal(input: {
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

export async function resolveKnowledgeProposal(
  input: ApiKnowledgeProposalResolveRequest,
): Promise<ApiKnowledgeProposalInbox> {
  return postKnowledgeApi('resolve', input);
}
