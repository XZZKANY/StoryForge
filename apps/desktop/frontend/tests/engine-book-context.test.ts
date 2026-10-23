// @vitest-environment node
import { expect, it } from 'vitest';
import {
  buildBookContext,
  toBookContextPayload,
  executeBookContextCommand,
  InputDomainError,
} from '@storyforge/engine';
import golden from '../../../../packages/engine/golden/p1-context.windows.json';
import { contextFixtureReader } from '../../../../packages/engine/src/kernel/contextFixture.test-support';
import {
  commandExpectation,
  commandSecrets,
  contextExpectation,
  currentPresenceVersionFixture,
  currentReadingOrderJson,
  hydrate,
} from '../../../../packages/engine/src/kernel/contextDomain.test-support';
import { mapBookContextPayload } from '../src/lib/book-context';

for (const fixture of golden.book_context) {
  it(`formal engine package → existing mapper: ${fixture.id}`, async () => {
    const { reader, root } = contextFixtureReader(currentPresenceVersionFixture(fixture));
    const current =
      fixture.current === null
        ? null
        : fixture.current.kind === 'relative'
          ? fixture.current.path
          : `${root}/${fixture.current.path}`;
    const build = () => buildBookContext(reader, root, current, 'windows');
    const expectation = contextExpectation(fixture);
    if (expectation.kind === 'declaration-error') {
      await expect(build()).rejects.toBeInstanceOf(InputDomainError);
      return;
    }
    const context = await build();
    const actual = mapBookContextPayload(context === null ? null : toBookContextPayload(context));
    expect(actual).toEqual(
      mapBookContextPayload(
        JSON.parse(currentReadingOrderJson(fixture.id, expectation.source.payload_json!)),
      ),
    );
  });
}

// Registry/serializer response -> the existing mapper, with no new UI state or HTTP routing.
for (const fixture of golden.book_context) {
  for (const command of fixture.commands) {
    const expectation = commandExpectation(fixture, command);
    if (expectation.kind !== 'output') continue;
    it(`maps serialized command ${fixture.id}/${command.id}`, async () => {
      const { reader, root } = contextFixtureReader(currentPresenceVersionFixture(fixture));
      const args = hydrate(command.args_json, root) as Record<string, unknown>;
      const actual = await executeBookContextCommand(
        reader,
        args,
        commandSecrets(command),
        'windows',
      );
      const expected = expectation.output(root) as { payload: Record<string, unknown> };
      const payload = actual.payload as Record<string, unknown>;
      expect(mapBookContextPayload(payload.book_context)).toEqual(
        mapBookContextPayload(expected.payload.book_context),
      );
    });
  }
}
