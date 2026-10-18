import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// 产品里这些 `lib/api` 模块交给进程内的 TS 引擎（要 Tauri 原生端口）。浏览器回归只看真界面怎么走，
// 把它们换成与界面测试同一份的 fetch 替身：其余导出照用原模块，替身导出的同名函数盖过原模块。
const DOUBLES = {
  assistant: 'http-assistant-double',
  'agent-socket': 'http-agent-double',
  'chapter-checks': 'http-chapter-checks-double',
  'cross-chapter': 'http-cross-chapter-double',
  facts: 'http-facts-double',
  'ide-commands': 'http-ide-commands-double',
  'knowledge-proposals': 'http-knowledge-double',
};
const WRAPPER = '\0storyforge-http-double:';
const ORIGINAL = 'storyforge-http-original:';
const DOUBLE = 'storyforge-http-double-impl:';

const frontend = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const originalPath = (name) => resolve(frontend, 'src/lib/api', `${name}.ts`);
const doublePath = (name) => resolve(frontend, 'tests/support', `${DOUBLES[name]}.ts`);

export function httpDoublesPlugin() {
  return {
    name: 'storyforge-http-doubles',
    enforce: 'pre',
    async resolveId(source, importer, options) {
      if (source.startsWith(ORIGINAL)) return originalPath(source.slice(ORIGINAL.length));
      if (source.startsWith(DOUBLE)) return doublePath(source.slice(DOUBLE.length));
      // 浏览器直接请求的 URL（Vite 缺省把 importer 记成 index.html）是包装层引用的原模块，不能再绕回来。
      if (!importer || importer.startsWith(WRAPPER) || source.startsWith('/')) return null;
      // 替身自己要用原模块（解码器、类型），不能绕回包装层。
      if (importer.replace(/\\/g, '/').includes('/tests/support/http-')) return null;
      const resolved = await this.resolve(source, importer, { ...options, skipSelf: true });
      const id = resolved?.id.replace(/\\/g, '/').replace(/\?.*$/, '');
      const name = Object.keys(DOUBLES).find((entry) => id?.endsWith(`/src/lib/api/${entry}.ts`));
      return name ? WRAPPER + name : null;
    },
    load(id) {
      if (!id.startsWith(WRAPPER)) return null;
      const name = id.slice(WRAPPER.length);
      const source = readFileSync(doublePath(name), 'utf8');
      const names = [...source.matchAll(/^export (?:async function|function|const) (\w+)/gm)].map(
        (match) => match[1],
      );
      if (!names.length) throw new Error(`${DOUBLES[name]} exports nothing to override`);
      return (
        `export * from ${JSON.stringify(ORIGINAL + name)};\n` +
        `export { ${names.join(', ')} } from ${JSON.stringify(DOUBLE + name)};\n`
      );
    },
  };
}
