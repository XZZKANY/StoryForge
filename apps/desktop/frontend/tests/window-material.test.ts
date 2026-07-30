import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { test } from 'vitest';

// 窗口材质（Windows 11 Mica）的安全护栏。
//
// 这一刀有两个各自会炸的地雷，测试就是钉住它们：
//   1. transparent:true 会把 WebView2 的背景强制清零，所以「哪一层是不透明的」变成
//      正确性问题而不是观感问题。任何脱离 data-window-effect='mica' 的透明规则，
//      都会让 Win10 / 非桌面运行时看见一个透明的应用。
//   2. 装机 smoke 的 visualTone 断言直接采样 welcome-workspace / composer 的
//      backgroundColor，要求每通道 ≥24 / ≥36。把这两层改透明会读出 rgba(0,0,0,0)。

const abs = (rel: string) => fileURLToPath(new URL(rel, import.meta.url));
const read = (rel: string) => readFileSync(abs(rel), 'utf8');

const cssPath = '../src/index.css';
const shellPath = '../src/components/app/AppShell.tsx';
const bridgePath = '../src/components/app/useTauriMenuBridge.ts';
const mainRsPath = '../../src-tauri/src/main.rs';
const confPath = '../../src-tauri/tauri.conf.json';

/** 取出所有提到 data-window-effect 的规则（选择器 + 规则体）。注释先剥掉，否则说明文字会被当成选择器。 */
function materialRules(): Array<{ selector: string; body: string }> {
  const css = read(cssPath).replace(/\/\*[\s\S]*?\*\//g, '');
  return [...css.matchAll(/([^{};]*data-window-effect[^{}]*)\{([^}]*)\}/g)].map((m) => ({
    selector: m[1].trim(),
    body: m[2],
  }));
}

test('材质规则一条都不许脱离 mica 闸', () => {
  const rules = materialRules();
  assert.ok(rules.length >= 3, '找不到窗口材质规则');
  for (const { selector } of rules) {
    // 每个逗号分隔的选择器分支都必须自带闸；漏一个分支就漏一整类元素
    for (const branch of selector.split(',')) {
      if (!branch.trim()) continue;
      assert.match(
        branch,
        /\[data-window-effect='mica'\]/,
        `材质规则有分支没锁在 mica 下：${branch.trim()}`,
      );
    }
  }
});

test('正文区与欢迎页不许透明——可读性优先，且装机 smoke 会采它们的背景色', () => {
  const forbidden = ['editor-panel', 'shell-center', 'welcome-workspace', 'welcome-composer'];
  for (const { selector } of materialRules()) {
    for (const testid of forbidden) {
      assert.doesNotMatch(selector, new RegExp(testid), `${testid} 不该被材质规则改成半透明`);
    }
  }
});

test('材质透明度来自 Rust 的真 Result，而不是 tauri.conf.json 的 windowEffects', () => {
  // tauri 的 config 路径在内部把 apply 的 Result 丢掉（let _ = ...），成败无从得知；
  // 而这里的透明画布只有在材质真挂上时才允许启用，所以必须拿到真结果。
  const conf = read(confPath);
  assert.doesNotMatch(conf, /windowEffects/, '不要走 config 路径，它拿不到成败');
  assert.match(conf, /"transparent":\s*true/, 'Mica 需要窗口透明');

  const mainRs = read(mainRsPath);
  assert.match(mainRs, /window_vibrancy::apply_mica\(/);
  // 必须对 Result 分支，而不是 let _ = 吞掉
  assert.doesNotMatch(mainRs, /let _ = window_vibrancy::apply_mica/);
  assert.match(mainRs, /Err\(error\) => WindowEffectStatus \{[\s\S]*?"none"/);
});

test('前端默认停在 none：拿不到 / 不是桌面运行时都不启用透明', () => {
  const bridge = read(bridgePath);
  assert.match(bridge, /useState<'mica' \| 'none'>\('none'\)/);
  // 只有 Rust 明确回 mica 才升级
  assert.match(bridge, /status\?\.effect === 'mica'/);
  assert.match(read(shellPath), /data-window-effect=\{runtime\.windowEffect\}/);
});
