import { describe, expect, it } from 'vitest';
import { RunControl, RunInterrupted } from './control';

function control(interruption: () => string | null = () => null) {
  const clock = { now: 100 };
  const run = new RunControl({
    checkInterruption: interruption,
    deadline: 100 + 900,
    clock: () => clock.now,
    wait: async () => {},
  });
  return { clock, run };
}

const reasonOf = (fn: () => void) => {
  try {
    fn();
  } catch (error) {
    if (error instanceof RunInterrupted) return error.reason;
    throw error;
  }
  return null;
};

describe('RunControl.renewDeadline', () => {
  it('gives a fresh budget from now', () => {
    const { clock, run } = control();
    clock.now = 800;
    run.renewDeadline(900);
    expect(run.deadline).toBe(1700);
    clock.now = 1500;
    expect(reasonOf(() => run.check('before_tool:chapter.check'))).toBeNull();
    clock.now = 1700;
    expect(reasonOf(() => run.check('before_tool:chapter.check'))).toBe('deadline_exceeded');
  });

  it('does not undo a deadline that already ran out', () => {
    const { clock, run } = control();
    clock.now = 1000;
    expect(reasonOf(() => run.check('a'))).toBe('deadline_exceeded');
    run.renewDeadline(900);
    expect(reasonOf(() => run.check('b'))).toBe('deadline_exceeded');
  });

  it('keeps a pause or stop in force', () => {
    let status: string | null = null;
    const { run } = control(() => status);
    status = 'paused';
    run.renewDeadline(900);
    expect(reasonOf(() => run.check('before_tool:chapter.draft'))).toBe('paused');
    run.renewDeadline(900);
    expect(reasonOf(() => run.check('before_tool:chapter.check'))).toBe('paused');
  });

  it('leaves a run without a deadline unbounded', () => {
    const run = new RunControl({
      checkInterruption: () => null,
      clock: () => 0,
      wait: async () => {},
    });
    run.renewDeadline(900);
    expect(run.deadline).toBeNull();
  });
});
