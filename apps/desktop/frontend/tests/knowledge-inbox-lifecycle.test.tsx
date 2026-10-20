/**
 * 知识收件箱跨作品的迟到结果（全项目审计 10-19 E-11）：在甲作品发起的修改还没回来就换到乙作品，
 * 回来的结果不能盖到乙作品的收件箱上。
 */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';

import { proposalToEdit, useKnowledgeInbox } from '../src/components/app/useKnowledgeInbox';
import {
  refreshKnowledgeProposals,
  reviseKnowledgeProposalGroup,
  type ApiKnowledgeProposalInbox,
} from '../src/lib/api/knowledge-proposals';

vi.mock('../src/lib/api/knowledge-proposals', () => ({
  refreshKnowledgeProposals: vi.fn(),
  reviseKnowledgeProposalGroup: vi.fn(),
  materializeKnowledgeProposal: vi.fn(),
  resolveKnowledgeProposal: vi.fn(),
}));
vi.mock('../src/lib/project/knowledge-writeback', () => ({ applyKnowledgePatch: vi.fn() }));
vi.mock('../src/lib/toast', () => ({ emitToast: vi.fn() }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const A = 'D:/甲书';
const B = 'D:/乙书';
const inbox = (label: string) =>
  ({
    pending_count: 1,
    items: [
      {
        artifact_id: label === 'A' ? 1 : 2,
        proposal_group_id: `group-${label}`,
        run_id: `run-${label}`,
        revision: 1,
        state: 'pending',
        created_at: '2026-10-01T00:00:00Z',
        proposals: [
          {
            proposal_id: `proposal-${label}`,
            knowledge_id: 'pk_11111111-1111-4111-8111-111111111111',
            target_path: '设定/规则.md',
            operation: 'create',
            title: `作品${label}的提案`,
            claim: `规则${label}`,
            kind: 'world_rule',
            confidence: 'author_declared',
            sources: [{ type: 'author_statement' }],
            related_knowledge_ids: [],
            reason: '合成',
            claim_fingerprint: `sha256:${'a'.repeat(64)}`,
            state: 'pending',
          },
        ],
      },
    ],
  }) as unknown as ApiKnowledgeProposalInbox;

let root: Root;
let handle: ReturnType<typeof useKnowledgeInbox>;
function Harness({ project }: { project: string }) {
  handle = useKnowledgeInbox(project);
  return null;
}
const mount = async (project: string) => {
  await act(async () => root.render(<Harness project={project} />));
  await act(async () => handle.refresh());
};
const titles = () =>
  handle.inbox.items.flatMap((item) => item.proposals.map((proposal) => proposal.title));

beforeEach(() => {
  vi.useFakeTimers();
  root = createRoot(document.createElement('div'));
  vi.mocked(refreshKnowledgeProposals).mockImplementation(async (project) =>
    inbox(project === A ? 'A' : 'B'),
  );
});
afterEach(() => {
  act(() => root.unmount());
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.resetAllMocks();
});

test('甲作品的修改迟到回来时已换到乙作品：乙作品的收件箱不被盖掉', async () => {
  let release!: (value: ApiKnowledgeProposalInbox) => void;
  vi.mocked(reviseKnowledgeProposalGroup).mockImplementationOnce(
    () => new Promise((resolve) => (release = resolve)),
  );
  await mount(A);
  const group = handle.inbox.items[0];
  let pending!: Promise<boolean>;
  await act(async () => {
    pending = handle.revise(
      group,
      group.proposals[0].proposal_id,
      proposalToEdit(group.proposals[0]),
    );
  });
  await mount(B);
  expect(titles()).toEqual(['作品B的提案']);
  await act(async () => {
    release(inbox('A'));
    await pending;
  });
  expect(titles()).toEqual(['作品B的提案']);
  expect(vi.mocked(reviseKnowledgeProposalGroup).mock.calls[0][0].projectRoot).toBe(A);
});

test('同一作品里的修改照常更新收件箱', async () => {
  vi.mocked(reviseKnowledgeProposalGroup).mockResolvedValueOnce(inbox('A'));
  await mount(A);
  const group = handle.inbox.items[0];
  await act(async () => {
    await handle.revise(group, group.proposals[0].proposal_id, proposalToEdit(group.proposals[0]));
  });
  expect(vi.mocked(reviseKnowledgeProposalGroup)).toHaveBeenCalledTimes(1);
  expect(titles()).toEqual(['作品A的提案']);
});

test('甲作品的拒绝、生成补丁迟到回来：乙作品的收件箱和审阅都不受影响', async () => {
  const { materializeKnowledgeProposal, resolveKnowledgeProposal } =
    await import('../src/lib/api/knowledge-proposals');
  let rejectA!: (value: ApiKnowledgeProposalInbox) => void;
  let patchA!: (value: never) => void;
  vi.mocked(resolveKnowledgeProposal).mockImplementationOnce(
    () => new Promise((resolve) => (rejectA = resolve)),
  );
  vi.mocked(materializeKnowledgeProposal).mockImplementationOnce(
    () => new Promise((resolve) => (patchA = resolve as never)),
  );
  await mount(A);
  const group = handle.inbox.items[0];
  let rejecting!: Promise<void>;
  let materializing!: Promise<void>;
  await act(async () => {
    rejecting = handle.reject(group, group.proposals[0]);
    materializing = handle.materialize(group, group.proposals[0]);
  });
  await mount(B);
  await act(async () => {
    rejectA(inbox('A'));
    patchA({ proposal_id: 'proposal-A' } as never);
    await rejecting;
    await materializing;
  });
  expect(titles()).toEqual(['作品B的提案']);
  expect(handle.reviewPatch).toBeNull();
});

test('甲作品的修改迟到回来时已经切到乙又切回甲（全项目审计 E-17）：不把甲书刷新后的列表改回旧样子', async () => {
  let release!: (value: ApiKnowledgeProposalInbox) => void;
  vi.mocked(reviseKnowledgeProposalGroup).mockImplementationOnce(
    () => new Promise((resolve) => (release = resolve)),
  );
  await mount(A);
  const group = handle.inbox.items[0];
  let pending!: Promise<boolean>;
  await act(async () => {
    pending = handle.revise(
      group,
      group.proposals[0].proposal_id,
      proposalToEdit(group.proposals[0]),
    );
  });
  await mount(B);
  await mount(A);
  expect(titles()).toEqual(['作品A的提案']);
  await act(async () => {
    release(inbox('旧A'));
    await pending;
  });
  expect(titles()).toEqual(['作品A的提案']);
});
