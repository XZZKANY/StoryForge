import { describe, it, expect } from 'vitest';
import { formatWordCount } from '../src/lib/book-profile';

describe('ProjectDashboard dependencies', () => {
  it('formatWordCount works correctly', () => {
    expect(formatWordCount(5000)).toBe('5,000 字');
    expect(formatWordCount(15000)).toBe('1.5 万字');
    expect(formatWordCount(100000)).toBe('10.0 万字');
  });

  it('can import ProjectDashboard component', async () => {
    const { ProjectDashboard } = await import('../src/components/app/ProjectDashboard');
    expect(ProjectDashboard).toBeDefined();
    expect(typeof ProjectDashboard).toBe('function');
  });
});
