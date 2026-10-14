import { describe, expect, it } from 'vitest';
import golden from '../../golden/p3-regex-budget.windows.json';
import type { EncodedFile } from './contextFixture.test-support';
import { fsSearch, inProcessRegexCompiler, type RegexCompiler } from './fsProjectTools';
import { FsToolError } from './fsTools';
import { memoryProject } from './memoryProject.test-support';
import { projectKnowledgeSearch } from './projectKnowledgeFiles';
import { scanRegexLines } from './regexScan';

type Scenario = {
  id: string;
  fn: 'search' | 'knowledge';
  files: Record<string, EncodedFile>;
  timings: Record<string, [number, boolean]>;
  asked: string[];
  calls: {
    args: { query: string; use_regex: boolean; max_matches: number };
    output_json?: string;
    error?: { message: string };
  }[];
};

const ROOT = 'D:\\synthetic-book';

/** 与预言机同一套脚本：每行的耗时与命中由场景给，虚拟时钟从 100 秒起。 */
function scripted(spec: Scenario) {
  const asked: string[] = [];
  let now = 100.0;
  const compile: RegexCompiler = () => ({
    scan: async (lines, limit, remaining) =>
      scanRegexLines(
        (line) => {
          asked.push(line);
          const [seconds, hit] = spec.timings[line] ?? [0.001, false];
          now += seconds;
          return hit;
        },
        lines,
        limit,
        remaining,
        () => now,
      ),
  });
  return { asked, compile };
}

describe('regex budget replays the Python SearchMatcher', () => {
  it('pins the oracle sources and scenario count', () => {
    expect(Object.keys(golden.sources)).toHaveLength(3);
    expect(golden.scenarios).toHaveLength(15);
  });

  it.each((golden.scenarios as unknown as Scenario[]).map((item) => [item.id, item] as const))(
    '%s',
    async (_id, spec) => {
      const project = memoryProject(ROOT, spec.files);
      const { asked, compile } = scripted(spec);
      const [call] = spec.calls;
      const { query, use_regex: useRegex, max_matches: maxMatches } = call.args;
      const run = () =>
        spec.fn === 'search'
          ? fsSearch(project.reader, ROOT, query, {
              useRegex,
              maxMatches,
              platform: 'windows',
              compile,
            })
          : projectKnowledgeSearch(project.reader, ROOT, query, {
              secrets: { values: [] },
              useRegex,
              maxMatches,
              compile,
            });
      if (call.error) {
        const failure = await run().catch((error: unknown) => error);
        expect(failure).toBeInstanceOf(FsToolError);
        expect((failure as Error).message).toBe(call.error.message);
      } else {
        expect(await run()).toEqual(JSON.parse(call.output_json!));
      }
      expect(asked).toEqual(spec.asked);
    },
  );
});

describe('scanRegexLines', () => {
  it('reports the budget left after the scan', () => {
    let now = 0;
    const scan = scanRegexLines(
      () => {
        now += 0.01;
        return true;
      },
      ['a', 'b', 'c'],
      2,
      2,
      () => now,
    );
    expect(scan.hits).toEqual([0, 1]);
    expect(scan.failure).toBeNull();
    expect(scan.remainingSeconds).toBe(2 - 0.01 - 0.01);
  });

  it('compiles plain JS patterns in process', async () => {
    const pattern = inProcessRegexCompiler(() => 0)('林.');
    expect(await pattern.scan(['林舟', '沈禾', '林'], 5, 2)).toEqual({
      hits: [0],
      remainingSeconds: 2,
      failure: null,
    });
  });
});
