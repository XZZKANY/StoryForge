import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { runInNewContext } from 'node:vm';

// Execute the exact JavaScript embedded in the native smoke, not a parallel
// implementation. These unit checks do not replace real WebView hit-testing.
const source = readFileSync(new URL('../src-tauri/src/smoke_ui.rs', import.meta.url), 'utf8');
const helpers = source.match(/const DOM_HELPERS: &str = r#"([\s\S]*?)"#;/)?.[1];
assert.ok(helpers, 'native smoke DOM helpers must be available');

function probe(options = {}, probeOnly = false) {
  const counters = { clicks: 0, scrolls: 0 };
  const style = { display: 'block', visibility: 'visible', opacity: '1' };
  const rect = { x: 20, y: 20, width: 80, height: 30, right: 100, bottom: 50 };
  const child = {};
  const target = {
    isConnected: true,
    parentElement: options.parentStyle ? { style: { ...style, ...options.parentStyle } } : null,
    style: { ...style, ...options.style },
    closest(selector) {
      return selector.includes('aria-disabled') ? options.disabledAncestor : options.hiddenAncestor;
    },
    matches: () => Boolean(options.disabled),
    getBoundingClientRect: () => ({ ...rect, ...options.rect }),
    scrollIntoView: () => counters.scrolls++,
    contains: (hit) => hit === child,
    getAttribute: (name) => (name === 'data-testid' ? 'smoke-target' : null),
    click: () => counters.clicks++,
  };
  Object.assign(target, options.target);
  const result = runInNewContext(
    `(() => { ${helpers} return click(document.querySelector('target'), ${probeOnly}); })()`,
    {
      innerWidth: 1000,
      innerHeight: 700,
      document: {
        querySelector: () => (options.missing ? null : target),
        elementFromPoint: () => (options.occluded ? {} : options.childHit ? child : target),
      },
      getComputedStyle: (element) => element.style,
    },
  );
  return { result, counters };
}

test('smoke click reaches a visible target or its child exactly once', () => {
  for (const childHit of [false, true]) {
    const { result, counters } = probe({ childHit });
    assert.equal(result.clicked, true);
    assert.deepEqual(counters, { clicks: 1, scrolls: 1 });
  }
});

test('readiness polling never clicks and shares the actual click guards', () => {
  for (const options of [{}, { childHit: true }]) {
    const { result, counters } = probe(options, true);
    assert.equal(result.ready, true);
    assert.deepEqual(counters, { clicks: 0, scrolls: 1 });
  }
  for (const [options, reason] of [
    [{ missing: true }, 'missing-target'],
    [{ parentStyle: { opacity: '0' } }, 'hidden-target'],
    [{ hiddenAncestor: {} }, 'hidden-target'],
    [{ disabled: true }, 'disabled-target'],
    [{ disabledAncestor: {} }, 'disabled-target'],
    [{ rect: { bottom: 800 } }, 'outside-viewport'],
    [{ occluded: true }, 'occluded-target'],
  ]) {
    const { result, counters } = probe(options, true);
    assert.notEqual(result.ready, true);
    assert.equal(result.reason, reason);
    assert.equal(counters.clicks, 0);
  }
});

test('a remounted patch stays unclicked until its opacity animation admits interaction', () => {
  const hidden = probe({ parentStyle: { opacity: '0' } }, true);
  assert.equal(hidden.result.reason, 'hidden-target');
  assert.equal(hidden.counters.clicks, 0);
  const ready = probe({ parentStyle: { opacity: '1' } }, true);
  assert.equal(ready.result.ready, true);
  assert.equal(ready.counters.clicks, 0);
  assert.equal(probe({ parentStyle: { opacity: '1' } }).counters.clicks, 1);
});

test('mounted hidden workspace controls cannot be clicked or scrolled into view', () => {
  for (const options of [
    { hiddenAncestor: {} },
    { parentStyle: { display: 'none' } },
    { parentStyle: { visibility: 'hidden' } },
    { parentStyle: { opacity: '0' } },
    { rect: { width: 0 } },
    { target: { isConnected: false } },
  ]) {
    const { result, counters } = probe(options);
    assert.equal(result.reason, 'hidden-target');
    assert.deepEqual(counters, { clicks: 0, scrolls: 0 });
  }
});

test('missing, disabled, clipped and occluded targets cannot pass the click probe', () => {
  for (const [options, reason] of [
    [{ missing: true }, 'missing-target'],
    [{ disabled: true }, 'disabled-target'],
    [{ disabledAncestor: {} }, 'disabled-target'],
    [{ rect: { x: -20 } }, 'outside-viewport'],
    [{ rect: { right: 1200 } }, 'outside-viewport'],
    [{ rect: { bottom: 800 } }, 'outside-viewport'],
    [{ occluded: true }, 'occluded-target'],
  ]) {
    const { result, counters } = probe(options);
    assert.equal(result.clicked, false);
    assert.equal(result.reason, reason);
    assert.equal(counters.clicks, 0);
  }
});
