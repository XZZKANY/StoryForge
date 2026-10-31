import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { RefreshCw } from 'lucide-react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';

import { Spinner } from '../src/components/ui';

// 加载圈只留 components/ui/Spinner 一种做法：要转圈就用 <Spinner />，刷新图标转圈用它的 icon 属性；
// 按钮自己的加载态由 Button 内部管。别处手写 animate-spin 或借用按钮的类，就又各写各的了。
function sourceFiles(root: string): string[] {
  return readdirSync(root).flatMap((name) => {
    const path = join(root, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.(tsx?|css)$/.test(name) ? [path] : [];
  });
}

const relativePath = (path: string) => relative('.', path).replace(/\\/g, '/');
const filesContaining = (needle: string) =>
  sourceFiles('src')
    .map(relativePath)
    .filter((path) => readFileSync(path, 'utf8').includes(needle));

it('animate-spin 只出现在 components/ui 里', () => {
  const files = filesContaining('animate-spin');
  expect(files).toContain('src/components/ui/Spinner.tsx');
  expect(files.filter((path) => !path.startsWith('src/components/ui/'))).toEqual([]);
});

it('sf-button-spinner 只出现在 Button 与它的样式里', () => {
  expect(filesContaining('sf-button-spinner').sort()).toEqual([
    'src/components/ui/Button.tsx',
    'src/index.css',
  ]);
});

it('Spinner 默认是装饰，给了 label 才是读屏可读的状态', () => {
  const decorative = renderToStaticMarkup(<Spinner />);
  expect(decorative).toBe(
    '<span class="sf-spinner" style="width:14px;height:14px" aria-hidden="true"></span>',
  );
  const labelled = renderToStaticMarkup(<Spinner size={12} label="正在读取" />);
  expect(labelled).toContain('role="status"');
  expect(labelled).toContain('<span class="sr-only">正在读取</span>');
  expect(labelled).toContain('style="width:12px;height:12px" aria-hidden="true"');
});

it('Spinner 转图标时只在 spinning 为真时转', () => {
  const idle = renderToStaticMarkup(
    <Spinner icon={RefreshCw} spinning={false} size={14} strokeWidth={1.6} />,
  );
  expect(idle).not.toContain('animate-spin');
  expect(idle).toContain('width="14"');
  expect(idle).toContain('stroke-width="1.6"');
  expect(idle).toContain('aria-hidden="true"');
  expect(renderToStaticMarkup(<Spinner icon={RefreshCw} />)).toContain('animate-spin');
});
