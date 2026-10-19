import { describe, expect, it } from 'vitest';
import type { ToolExecutionContext } from '../loop/tools/execution';
import { checkToolHandlers } from '../loop/tools/checkHandlers';
import type { ToolDeps } from '../loop/tools/handlerDeps';
import { memoryProject } from './memoryProject.test-support';
import { entityBudgetScan, type EntityBudgetOptions } from './sceneChecks';

const ROOT = 'D:/book';
const PATH = '正文/第030章.md';
const book = () =>
  memoryProject(ROOT, {
    [PATH]: { chunks: [{ base64: btoa('chapter'), repeat: 1 }] },
  });
const rules = async (options: EntityBudgetOptions) => {
  const output = (await entityBudgetScan(book().reader, ROOT, PATH, {
    chapter: 30,
    ...options,
  })) as { verdict: { issues: { rule: string }[] } };
  return output.verdict.issues.map((issue) => issue.rule);
};

describe('late-chapter entity budgets', () => {
  it('flags any late new location or mystery by default', async () => {
    expect(await rules({ newCoreLocations: ['钟楼'], newMysteries: ['谜'] })).toEqual(
      expect.arrayContaining(['late_core_locations', 'late_mysteries']),
    );
  });

  it('honours the budgets the author allowed, and flags only what goes past them', async () => {
    const within = await rules({
      newCoreLocations: ['钟楼', '码头'],
      newMysteries: ['谜'],
      budgetLateCoreLocations: 2,
      budgetLateMysteries: 1,
    });
    expect(within).not.toContain('late_core_locations');
    expect(within).not.toContain('late_mysteries');
    const over = await rules({
      newCoreLocations: ['钟楼', '码头', '灯塔'],
      newMysteries: ['谜', '雾'],
      budgetLateCoreLocations: 2,
      budgetLateMysteries: 1,
    });
    expect(over).toEqual(expect.arrayContaining(['late_core_locations', 'late_mysteries']));
  });

  it('takes both budgets from the tool arguments the model can pass', async () => {
    const deps = { reader: book().reader, platform: 'windows' } as unknown as ToolDeps;
    const result = await checkToolHandlers(deps)['project.entity_budget_check'](
      {} as ToolExecutionContext,
      {
        project_root: ROOT,
        path: PATH,
        chapter: 30,
        new_core_locations: ['钟楼'],
        new_mysteries: ['谜'],
        budget_new_core_entities_after_chapter_20: 1,
        budget_new_mysteries_after_chapter_25: 1,
      },
    );
    const issues = (result.output as { verdict: { issues: { rule: string }[] } }).verdict.issues;
    const fired = issues.map((issue) => issue.rule);
    expect(fired).not.toContain('late_core_locations');
    expect(fired).not.toContain('late_mysteries');
  });
});
