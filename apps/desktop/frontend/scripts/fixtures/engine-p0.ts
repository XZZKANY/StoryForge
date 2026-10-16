import { isTauri } from '@tauri-apps/api/core';
import { checkParagraphPatterns } from '../../../../../packages/engine/src/index';
import golden from '../../../../../packages/engine/golden/p0.json';

const yieldTask = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

async function runCpuProbe() {
  if (!isTauri()) throw new Error('P0 CPU measurement requires the real Tauri WebView');
  const results = [];
  for (const fixture of golden.cpu) {
    const prose = fixture.block.repeat(fixture.repetitions) + 'x'.repeat(fixture.padding);
    const bytes = new TextEncoder().encode(prose);
    const sha256 = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)))
      .map((byte) => byte.toString(16).padStart(2, '0'))
      .join('');
    if (bytes.byteLength !== 1_048_576 || sha256 !== fixture.sha256) {
      throw new Error('CPU corpus descriptor does not match the Python oracle');
    }
    const expected = JSON.stringify(fixture.output);
    for (let index = 0; index < 10; index++) {
      if (JSON.stringify(checkParagraphPatterns(prose)) !== expected) {
        throw new Error(`Warmup result differs from Python: ${fixture.id}`);
      }
      await yieldTask();
    }
    const longTasks: { startTime: number; duration: number }[] = [];
    const supported = PerformanceObserver.supportedEntryTypes.includes('longtask');
    const observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        longTasks.push({ startTime: entry.startTime, duration: entry.duration });
      }
    });
    if (supported) observer.observe({ entryTypes: ['longtask'] });
    const samples = [];
    const measuredFrom = performance.now();
    for (let index = 0; index < 10; index++) {
      const start = performance.now();
      const actual = checkParagraphPatterns(prose);
      const duration = performance.now() - start;
      if (JSON.stringify(actual) !== expected) {
        throw new Error(`Measured result differs from Python: ${fixture.id}`);
      }
      samples.push(duration);
      await yieldTask();
    }
    const measuredUntil = performance.now();
    await new Promise((resolve) => setTimeout(resolve, 100));
    observer.disconnect();
    const sorted = [...samples].sort((a, b) => a - b);
    results.push({
      id: fixture.id,
      bytes: bytes.byteLength,
      codepoints: Array.from(prose).length,
      utf16Units: prose.length,
      sha256,
      warmups: 10,
      samplesMs: samples,
      p50Ms: sorted[Math.ceil(sorted.length * 0.5) - 1],
      p95Ms: sorted[Math.ceil(sorted.length * 0.95) - 1],
      maxMs: sorted[sorted.length - 1],
      below200Ms: sorted[Math.ceil(sorted.length * 0.95) - 1] < 200,
      longTasksSupported: supported,
      longTasks: longTasks.filter(
        (entry) =>
          entry.startTime + entry.duration > measuredFrom && entry.startTime < measuredUntil,
      ),
      issueCount: fixture.output.length,
      scope: 'complete four paragraph-pattern families; not full prose_static_scan',
    });
  }
  return { native: true, userAgent: navigator.userAgent, sources: golden.sources, results };
}

declare global {
  interface Window {
    __ENGINE_P0__: { runCpuProbe: typeof runCpuProbe };
  }
}
window.__ENGINE_P0__ = { runCpuProbe };
document.documentElement.dataset.engineP0Ready = 'true';
