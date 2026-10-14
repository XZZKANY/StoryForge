import { describe, expect, it } from 'vitest';
import golden from '../../golden/p4-knowledge-inbox.json';
import { decodeFixtureBytes, type EncodedFile } from '../kernel/contextFixture.test-support';
import { FsToolError } from '../kernel/fsTools';
import { knowledgeClaimFingerprint } from '../kernel/knowledgeEntries';
import type { JsonObject } from '../kernel/json';
import {
  buildKnowledgeProposalGroup,
  KNOWLEDGE_PROPOSAL_ARTIFACT_KIND,
  projectFingerprint,
} from '../kernel/knowledgeProposals';
import { memoryProject } from '../kernel/memoryProject.test-support';
import { migratedMemoryDb } from '../store/nodeSqlite.test-support';
import { MemoryRunStore } from '../store/runs';
import { SqlRunStore } from '../store/sqlRuns';
import {
  KnowledgeInboxConflictError,
  KnowledgeInboxRequestError,
  materializeKnowledgeProposal,
  queryKnowledgeInbox,
  refreshKnowledgeEvidence,
  resolveKnowledgeProposal,
  reviseKnowledgeProposalGroup,
  type KnowledgeInboxDeps,
} from './knowledgeInbox';
import {
  recordAgentArtifact,
  recordAgentEvent,
  startAgentUserMessageRun,
  type RunServices,
} from './runEvents';

type Obj = { [key: string]: any }; // eslint-disable-line @typescript-eslint/no-explicit-any -- 按 Python 预言机的 JSON 形状读

const platform = golden.platform as 'windows' | 'posix';
const roots =
  platform === 'windows'
    ? { book: 'D:\\synthetic-book', other: 'D:\\synthetic-other', missing: 'D:\\synthetic-missing' }
    : {
        book: '/tmp/synthetic-book',
        other: '/tmp/synthetic-other',
        missing: '/tmp/synthetic-missing',
      };
const labels: [string, string][] = [
  [roots.other, '$OTHER'],
  [roots.book, '$ROOT'],
  [roots.missing, '$MISSING'],
  [projectFingerprint(roots.book, platform), '$FINGERPRINT'],
  [projectFingerprint(roots.other, platform), '$OTHER_FINGERPRINT'],
];
const mask = (value: unknown): unknown =>
  typeof value === 'string'
    ? labels.reduce(
        (text, [from, to]) => text.split(from).join(to).split(from.replace(/\\/g, '/')).join(to),
        value,
      )
    : Array.isArray(value)
      ? value.map(mask)
      : value !== null && typeof value === 'object'
        ? Object.fromEntries(Object.entries(value).map(([key, item]) => [key, mask(item)]))
        : value;
const plain = (value: unknown) => JSON.parse(JSON.stringify(value));
const text = (file: EncodedFile) => new TextDecoder().decode(decodeFixtureBytes(file));
const records = JSON.parse(golden.records_json) as Obj[];
const [year, month, day, hour, minute, second] = golden.fixed_now;

describe.each([
  ['内存存储', async () => new MemoryRunStore()],
  [
    'sqlite 存储',
    async () => SqlRunStore.open(await migratedMemoryDb(), () => '2026-10-14 00:00:00'),
  ],
] as const)('knowledge inbox replays the Python services (%s)', (_label, make) => {
  it('pins the oracle sources and operation count', () => {
    expect(Object.keys(golden.sources)).toHaveLength(4);
    expect(records).toHaveLength(65);
  });

  it('replays every operation with the same results, errors, rows and writes', async () => {
    const store = await make();
    const services: RunServices = { store, secrets: { values: [golden.secret] } };
    const projects = {
      book: memoryProject(roots.book, golden.projects.book),
      other: memoryProject(roots.other, golden.projects.other),
    };
    let counter = 0;
    const proposals = {
      newUuid: () => `00000000-0000-4000-8000-${(++counter).toString(16).padStart(12, '0')}`,
      now: () => new Date(Date.UTC(year, month - 1, day, hour, minute, second)),
    };
    const deps = (project: string): KnowledgeInboxDeps => ({
      ...services,
      reader: projects[project === 'other' ? 'other' : 'book'].reader,
      platform,
      proposals,
    });
    const root = (project: string) => roots[project as keyof typeof roots];
    const ids = new Map<string, number>();
    const artifactId = (op: Obj): number =>
      typeof op.artifact === 'string' ? ids.get(op.artifact)! : op.artifact;
    const proposalId = async (op: Obj): Promise<string> =>
      op.proposal_id ??
      ((await store.artifact(artifactId(op)))!.payload as Obj).proposals[op.proposal].proposal_id;
    const cursor = { events: 0, artifacts: 0, subagents: 0 };
    let lastPatch: Obj = {};

    for (const [index, record] of records.entries()) {
      const op = record.op as Obj;
      const label = `#${index} ${op.op}`;
      const run = async () => (await store.findRun(op.run))!;
      let result: unknown;
      let error: Obj | undefined;
      try {
        switch (op.op) {
          case 'start':
            await startAgentUserMessageRun(services, {
              agentSessionId: op.session,
              message: { user_message: '整理设定', run_id: op.run },
              newRunId: () => 'unused',
            });
            break;
          case 'propose': {
            const group = await buildKnowledgeProposalGroup(
              projects[op.project as 'book' | 'other'].reader,
              root(op.project),
              op.payload,
              { ...proposals, platform },
            );
            const { artifact } = await recordAgentArtifact(services, await run(), {
              kind: KNOWLEDGE_PROPOSAL_ARTIFACT_KIND,
              payload: group,
              requiresConfirmation: false,
            });
            ids.set(op.as, artifact.id);
            break;
          }
          case 'artifact': {
            // 旧数据样例里的项目指纹与断言指纹是占位，两侧各自算。
            const payload = JSON.parse(
              JSON.stringify(op.payload)
                .split('$OTHER_FINGERPRINT')
                .join(projectFingerprint(roots.other, platform))
                .split('$FINGERPRINT')
                .join(projectFingerprint(roots.book, platform))
                .split('$LEGACY_CLAIM')
                .join(knowledgeClaimFingerprint('旧档', '旧档断言。')),
            );
            ids.set(
              op.as,
              (await recordAgentArtifact(services, await run(), { kind: op.kind, payload }))
                .artifact.id,
            );
            break;
          }
          case 'raw_event': {
            const target = ids.get(op.payload.artifact)!;
            const payload: Obj = { artifact_id: target };
            if (op.payload.proposal_ids_of) {
              const items = ((await store.artifact(target))!.payload as Obj).proposals;
              payload.proposal_ids = op.payload.proposal_ids_of.map(
                (at: number) => items[at].proposal_id,
              );
            }
            await recordAgentEvent(services, await run(), {
              eventType: op.event_type,
              actor: 'author',
              payload,
            });
            break;
          }
          case 'query':
            result = await queryKnowledgeInbox(deps(op.project), root(op.project));
            break;
          case 'refresh':
            result = await refreshKnowledgeEvidence(deps(op.project), root(op.project));
            break;
          case 'revise':
            result = await reviseKnowledgeProposalGroup(deps(op.project), {
              projectRoot: root(op.project),
              artifactId: artifactId(op),
              revision: op.revision,
              proposals: op.proposals,
            });
            if (op.as) {
              const kept = await store.artifactsOfKind(KNOWLEDGE_PROPOSAL_ARTIFACT_KIND);
              ids.set(op.as, kept[kept.length - 1].id);
            }
            break;
          case 'resolve': {
            const last = op.patch === 'last';
            result = await resolveKnowledgeProposal(deps(op.project), {
              projectRoot: root(op.project),
              artifactId: artifactId(op),
              revision: op.revision,
              proposalId: await proposalId(op),
              resolution: op.resolution,
              patchIdentity: last ? lastPatch.id : op.patch_identity,
              authorConfirmationEventId:
                last && op.author_confirmation_event_id === undefined
                  ? lastPatch.author_confirmation_event_id
                  : op.author_confirmation_event_id,
            });
            break;
          }
          case 'materialize':
            lastPatch = (await materializeKnowledgeProposal(deps(op.project), {
              projectRoot: root(op.project),
              artifactId: artifactId(op),
              revision: op.revision,
              proposalId: await proposalId(op),
            })) as Obj;
            result = lastPatch;
            break;
          case 'apply_patch':
            // 作者确认后由写回链路落盘：用的是引擎自己算出的 after，与 Python 写下的字节相同。
            expect(text(record.writes[lastPatch.relative_path]), label).toBe(lastPatch.after);
            projects.book.apply(record.writes);
            break;
          case 'author_write':
            projects[op.project as 'book' | 'other'].apply(record.writes);
            break;
          default:
            throw new Error(`unknown op ${op.op}`);
        }
      } catch (failure) {
        if (failure instanceof KnowledgeInboxRequestError) error = { status: 422 };
        else if (failure instanceof KnowledgeInboxConflictError)
          error = { status: 409, message: failure.message };
        else if (failure instanceof FsToolError)
          error = { status: 500, type: 'FsToolError', message: mask(failure.message) };
        else throw failure;
      }
      if ('error' in record) expect(error, label).toEqual(record.error);
      else {
        expect(error, label).toBeUndefined();
        if ('result' in record) expect(mask(plain(result)), label).toEqual(record.result);
      }
      const rows = await store.rowsAfter(cursor);
      for (const key of ['events', 'artifacts'] as const)
        if (rows[key].length) cursor[key] = rows[key][rows[key].length - 1].id;
      expect(
        mask(
          plain({
            events: rows.events.map(
              ({ id, run_id, event_type, actor, message, payload, sequence }) => ({
                id,
                run_id,
                event_type,
                actor,
                message,
                payload,
                sequence,
              }),
            ),
            artifacts: rows.artifacts.map(
              ({ id, run_id, kind, payload, requires_confirmation }) => ({
                id,
                run_id,
                kind,
                payload: payload as JsonObject,
                requires_confirmation,
              }),
            ),
          }),
        ),
        `${label} rows`,
      ).toEqual({ events: record.events, artifacts: record.artifacts });
    }
  });
});
