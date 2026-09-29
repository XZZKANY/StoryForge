import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { test } from 'vitest';

test('retired UI islands and native watcher have no source implementation', () => {
  for (const file of [
    'src/components/shell/StatusBar.tsx',
    'src/components/shell/ManuscriptCard.tsx',
    'src/components/shell/useDismissableMenu.ts',
    '../src-tauri/src/watcher.rs',
  ])
    assert.equal(existsSync(file), false, `${file} is retired`);
});

test('retired IPC commands and exclusive notify dependency stay removed', () => {
  const main = readFileSync('../src-tauri/src/main.rs', 'utf8');
  const adapter = readFileSync('src/lib/tauri-fs.ts', 'utf8');
  const manifest = readFileSync('../src-tauri/Cargo.toml', 'utf8');
  assert.doesNotMatch(main, /watcher::|shadow_git::shadow_git_status|fs::get_file_info/);
  assert.doesNotMatch(adapter, /watchFile|stopWatching|getFileInfo|FileChangeEvent|file-change/);
  assert.doesNotMatch(manifest, /^notify\s*=/m);
});

test('unused legacy style chains stay removed while skeleton and dynamic review markers survive', () => {
  const css = readFileSync('src/index.css', 'utf8');
  assert.doesNotMatch(
    css,
    /\.(?:animate-fade-in-scale|animate-slide-in-left|animate-pulse-soft|animate-shimmer|card-hover|focus-ring)\b/,
  );
  assert.doesNotMatch(
    css,
    /\[data-tooltip\]|@keyframes (?:fade-in-scale|pulse-soft|slide-in-left)\b|--sf-space-\d|--transition-(?:easing-)?spring/,
  );
  assert.match(css, /\.skeleton::after\s*\{[^}]*animation: shimmer/s);
  for (const severity of ['high', 'medium', 'low']) {
    assert.ok(css.includes(`.sf-issue-${severity}`));
    assert.ok(css.includes(`.sf-issue-glyph-${severity}::after`));
  }
});
