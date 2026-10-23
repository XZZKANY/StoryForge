import { describe, expect, it } from 'vitest';
import golden from '../../golden/p1-context.windows.json';
import { executeBookContextCommand, IdeCommandExecutionError } from './bookContextCommand';
import { contextFixtureReader } from './contextFixture.test-support';
import {
  commandExpectation,
  commandSecrets,
  currentPresenceVersionFixture,
  hydrate,
} from './contextDomain.test-support';
import { InputDomainError } from './json';

describe('complete book.context command: registry + serializer + response oracle', () => {
  for (const fixture of golden.book_context) {
    for (const command of fixture.commands) {
      it(`${fixture.id}/${command.id}`, async () => {
        const { reader, root, trace } = contextFixtureReader(
          currentPresenceVersionFixture(fixture),
        );
        const args = hydrate(command.args_json, root) as Record<string, unknown>;
        const execute = () =>
          executeBookContextCommand(reader, args, commandSecrets(command), 'windows');
        const expectation = commandExpectation(fixture, command);
        if (expectation.kind === 'error') {
          await expect(execute()).rejects.toBeInstanceOf(IdeCommandExecutionError);
          await expect(execute()).rejects.toMatchObject({ status: expectation.status });
          const failure = await execute().catch((error: unknown) => error);
          const message = (failure as Error).message;
          if (expectation.exact)
            expect(message).toBe(expectation.message.split('$ROOT').join(root));
          else expect(message).toContain(expectation.message);
          if (message === 'book.context 需要 project_root。') expect(trace).toEqual([]);
        } else {
          const actual = await execute();
          expect(actual).toEqual(expectation.output(root));
          const payload = actual.payload as Record<string, unknown>;
          const book = payload.book_context as Record<string, unknown>;
          const prompt = book.prompt_block;
          expect(typeof prompt === 'string' ? new TextEncoder().encode(prompt) : null).toEqual(
            expectation.prompt,
          );
        }
        expect(command.write_trace).toEqual([]);
      });
    }
  }
});

it('keeps request JSON semantics and serializes args once without mutating them', async () => {
  const { reader, root } = contextFixtureReader({ files: {}, missing_root: false });
  let calls = 0;
  const args = {
    toJSON() {
      calls += 1;
      return { project_root: ` ${root} `, unused: undefined, invalidNumber: Infinity };
    },
  };
  const output = await executeBookContextCommand(reader, args, { values: [] }, 'windows');
  expect(calls).toBe(1);
  expect(output.payload).toMatchObject({
    args: { project_root: ` ${root} `, invalidNumber: null },
  });
  expect(typeof args.toJSON).toBe('function');
});
it('rejects a relative project root before any IO instead of guessing a cwd', async () => {
  const { reader, trace } = contextFixtureReader({ files: {}, missing_root: false });
  for (const project_root of ['.', 'project', 'D:project', '/project'])
    await expect(
      executeBookContextCommand(reader, { project_root }, { values: [] }, 'windows'),
    ).rejects.toMatchObject({
      status: 400,
      message: 'book.context 的 project_root 必须是绝对路径。',
    });
  expect(trace).toEqual([]);
});
it('resolves a relative current_file against the project root, like the previous-chapter tail', async () => {
  const fixture = golden.book_context.find((candidate) => candidate.id === 'chapters')!;
  const { reader, root } = contextFixtureReader(fixture);
  const relative = await executeBookContextCommand(
    reader,
    { project_root: root, current_file: '正文/02.MD' },
    { values: [] },
    'windows',
  );
  const absolute = await executeBookContextCommand(
    reader,
    { project_root: root, current_file: `${root}/正文/02.MD` },
    { values: [] },
    'windows',
  );
  const book = (output: typeof relative) =>
    (output.payload as Record<string, unknown>).book_context as Record<string, unknown>;
  expect(book(relative)).toEqual(book(absolute));
  expect(book(relative).current_relative_path).toBe('正文/02.MD');
});
it('reports an out-of-domain canon.json to the author as a 400 naming the field', async () => {
  const canon = new TextEncoder().encode(
    '{"entities":[{"canonical_name":"林舟","aliases":"阿舟"}]}',
  );
  const { reader, root } = contextFixtureReader({
    files: {
      '.storyforge/canon/canon.json': {
        chunks: [{ base64: btoa(String.fromCharCode(...canon)), repeat: 1 }],
      },
    },
    missing_root: false,
  });
  const failure = await executeBookContextCommand(
    reader,
    { project_root: root },
    { values: [] },
    'windows',
  ).catch((error: unknown) => error);
  expect(failure).toBeInstanceOf(IdeCommandExecutionError);
  expect(failure).toMatchObject({
    status: 400,
    message: '.storyforge/canon/canon.json 的 entities[0].aliases 应为数组，实际是字符串',
  });
  expect((failure as IdeCommandExecutionError).cause).toBeInstanceOf(InputDomainError);
});
it('retains a domain input error rather than accepting an empty context', async () => {
  const { reader, trace } = contextFixtureReader({ files: {}, missing_root: false });
  await expect(
    executeBookContextCommand(reader, {}, { values: [] }, 'windows'),
  ).rejects.toBeInstanceOf(IdeCommandExecutionError);
  expect(trace).toEqual([]);
});
it('rejects arguments nested deeper than 64 containers before any IO', async () => {
  const { reader, root, trace } = contextFixtureReader({ files: {}, missing_root: false });
  let nested: unknown = 1;
  for (let i = 0; i < 64; i++) nested = [nested];
  await expect(
    executeBookContextCommand(
      reader,
      { project_root: root, extra: nested },
      { values: [] },
      'windows',
    ),
  ).rejects.toMatchObject({ status: 400, message: 'book.context 的参数嵌套超过 64 层。' });
  expect(trace).toEqual([]);
});

it('retains unexpected causes without exposing them, retrying, or returning an empty success', async () => {
  const { reader, root } = contextFixtureReader({ files: {}, missing_root: false });
  const cause = new Error('synthetic internal credential detail');
  let calls = 0;
  reader.resolveProjectPath = async () => {
    calls += 1;
    throw cause;
  };
  await expect(
    executeBookContextCommand(reader, { project_root: root }, { values: [] }, 'windows'),
  ).rejects.toMatchObject({ message: 'API 返回 500', status: 500, cause });
  expect(calls).toBe(1);
});

for (const fixture of golden.request_shapes) {
  it(`matches rejected HTTP args shape ${fixture.args_json}`, async () => {
    const { reader, trace } = contextFixtureReader({ files: {}, missing_root: false });
    const args = { toJSON: () => JSON.parse(fixture.args_json) };
    await expect(
      executeBookContextCommand(reader, args, { values: [] }, 'windows'),
    ).rejects.toMatchObject({ status: fixture.status, message: fixture.display });
    expect(trace).toEqual([]);
  });
}
it('preserves omitted args after request serialization as the default empty object', async () => {
  const { reader, trace } = contextFixtureReader({ files: {}, missing_root: false });
  let calls = 0;
  const args = {
    toJSON() {
      calls += 1;
      return undefined;
    },
  };
  await expect(
    executeBookContextCommand(reader, args, { values: [] }, 'windows'),
  ).rejects.toMatchObject({ status: 400, message: 'book.context 需要 project_root。' });
  expect(calls).toBe(1);
  expect(trace).toEqual([]);
});
