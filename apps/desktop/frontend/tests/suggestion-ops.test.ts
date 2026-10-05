import assert from 'node:assert/strict';
import { test } from 'vitest';
import { applyPatchHunkToCurrent, buildPatchHunks } from '../src/lib/patch-hunks';
import {
  buildSuggestionOps,
  invertPatchHunk,
  matchSuggestionOp,
  planHunkAccept,
  planWholeAccept,
  verifiedAppliedOpIds,
} from '../src/lib/suggestion-ops';
import {
  associateIssuesToOps,
  hasIssueAttribution,
  resolveIssueStatuses,
  summarizeIssueResolutions,
  type IssueScope,
} from '../src/lib/suggestion-ops';

const normalize = (text: string) => text.replace(/\r\n/g, '\n');

test('D06：作者确认历史与当前覆盖分开，未知或重复确认不增加计数', () => {
  const resolutions = [
    { id: 'a', status: 'open' as const },
    { id: 'c', status: 'resolved' as const },
    { id: 'unknown', status: 'open' as const },
  ];
  assert.deepEqual(
    summarizeIssueResolutions(resolutions, [
      { id: 'a', status: 'resolved' },
      { id: 'a', status: 'resolved' },
      { id: 'c', status: 'touched' },
      { id: 'outside', status: 'resolved' },
    ]),
    { observed: 3, authorConfirmed: 2, resolved: 1 },
  );
});

for (const newline of ['\n', '\r\n']) {
  test(`D06：${JSON.stringify(newline)} 与 emoji 原 op 只核验当前文字，不重新施加历史确认`, () => {
    const before = ['甲😀。', '中段。', '尾段。'].join(newline);
    const after = ['甲😀改。', '中段。', '尾段改。'].join(newline);
    const ops = buildSuggestionOps(before, after);
    assert.equal(ops.length, 2);
    const ids = new Set(ops.map((op) => op.id));
    assert.deepEqual(verifiedAppliedOpIds(after, before, ops, new Set()), new Set());
    assert.ok(verifiedAppliedOpIds(after, before, ops, ids).has(ops[0].id));
    for (const changed of ['甲😀。', '作者重新写了甲😀。']) {
      const current = [changed, '中段。', '尾段改。'].join(newline);
      assert.equal(verifiedAppliedOpIds(current, before, ops, ids).has(ops[0].id), false);
    }
  });
}

test('D06：结果文字只出现在别处不算当前原 op 已完成；重复删除位置歧义也不算', () => {
  const before = '目标句。\n中段。\n尾段。';
  const ops = buildSuggestionOps(before, '替换句。\n中段。\n尾段。');
  assert.equal(
    verifiedAppliedOpIds('作者自改。\n中段。\n替换句。', before, ops, new Set([ops[0].id])).size,
    0,
  );
  const p = '甲'.repeat(48);
  const s = '乙'.repeat(48);
  const source = [p, '重复句。', s, p, '重复句。', s].join('\n');
  const deletion = buildSuggestionOps(source, [p, s, p, '重复句。', s].join('\n'));
  assert.equal(deletion.length, 1);
  const ambiguous = [p, '作者自改。', s, p, '重复句。', s].join('\n');
  assert.equal(
    verifiedAppliedOpIds(ambiguous, source, deletion, new Set([deletion[0].id])).size,
    0,
  );
});

test('D06：别处相同前后文已有替换文，也不能替代原目标当前覆盖证据', () => {
  const p = '甲'.repeat(48);
  const s = '乙'.repeat(48);
  const before = [p, '目标句。', s, p, '目标句。', s].join('\n');
  const after = [p, '替换句。', s, p, '目标句。', s].join('\n');
  const ops = buildSuggestionOps(before, after);
  assert.equal(ops.length, 1);
  const current = [p, '作者自改。', s, p, '替换句。', s].join('\n');
  assert.equal(verifiedAppliedOpIds(current, before, ops, new Set([ops[0].id])).size, 0);
});

test('当前稿与 before 逐字一致时走快路径直接写 after', () => {
  const plan = planWholeAccept('A\nB\nC', 'A\nB\nC', 'AA\nB\nCC', new Set(), normalize);
  assert.equal(plan.fastPath, true);
  assert.equal(plan.content, 'AA\nB\nCC');
  assert.equal(plan.applied.length, 0);
});

test('D06：当前稿改回完整 before 不重开快路径或再施加已消费 op', () => {
  const before = 'A\nB\nC';
  const after = 'AA\nB\nCC';
  const ops = buildSuggestionOps(before, after);
  const plan = planWholeAccept(before, before, after, new Set([ops[0].id]), normalize, ops);
  assert.equal(plan.fastPath, false);
  assert.equal(plan.content, 'A\nB\nCC');
  assert.deepEqual(plan.settledOpIds, new Set([ops[1].id]));
  assert.deepEqual(
    plan.applied.map((step) => step.op.id),
    [ops[1].id],
  );
});

test('逐 op 映射保留范围外作者改动，并记录逆 op', () => {
  const before = 'A\nB\nC';
  const after = 'AA\nB\nCC';
  const ops = buildSuggestionOps(before, after);
  assert.equal(ops.length, 2, '应有 A→AA 与 C→CC 两处 op');
  const plan = planWholeAccept('A\nB*\nC', before, after, new Set(), normalize);
  assert.equal(plan.fastPath, false);
  assert.equal(plan.content, 'AA\nB*\nCC', 'B* 应被保留');
  assert.equal(plan.applied.length, 2);
  // 逆 op 逆序应用可回退到接受前的当前稿。
  let reverted = plan.content;
  for (const step of [...plan.applied].reverse())
    reverted = applyPatchHunkToCurrent(reverted, step.inverse);
  assert.equal(reverted, 'A\nB*\nC');
});

test('作者改动落在剩余 op 覆盖行时定位失败并抛冲突', () => {
  const before = '甲。\n乙。\n丙。';
  const after = '甲改。\n乙。\n丙改。';
  const ops = buildSuggestionOps(before, after);
  const applied = new Set([ops[0].id]);
  assert.throws(
    () => planWholeAccept('甲改。\n乙。\n作者自改', before, after, applied, normalize),
    /变化|定位|冲突|多次/,
  );
});

test('已落盘的 op 幂等跳过，不重复插入', () => {
  const plan = planWholeAccept('after', 'before', 'after', new Set(), normalize);
  assert.equal(plan.fastPath, false);
  assert.equal(plan.content, 'after');
  assert.equal(plan.applied.length, 0);
});

test('T07-F2：重复块里 afterText 巧合出现时该 op 仍必须被应用', () => {
  const context = '丙'.repeat(48);
  const tail = '丁'.repeat(48);
  const target = '甲'.repeat(49);
  const replacement = '乙'.repeat(49);
  const before = `${context}${target}${tail}\n${context}${replacement}${tail}\n${context}${replacement}${tail}\n`;
  const after = `${context}${replacement}${tail}\n${context}${replacement}${tail}\n${context}${replacement}${tail}\n`;
  // 当前稿在补丁外多了一行，避免走快路径；第一处重复块仍是原文 target。
  const current = `${before}\n无关。`;
  const plan = planWholeAccept(current, before, after, new Set(), normalize);
  assert.equal(plan.applied.length, 1, '该 op 不得被静默跳过');
  assert.equal(plan.content, `${after}\n无关。`);
  assert.ok(
    plan.content.startsWith(`${context}${replacement}${tail}\n`),
    '第一处重复块应真的被改为新文本',
  );
});

test('T07 高危回归：beforeText 为当前稿子串时应判已应用、幂等跳过（不得出现「铜铜」）', () => {
  const before = '甲。\n灯亮了。\n乙。';
  const after = '甲。\n铜灯亮了。\n乙。';
  const current = '甲。\n铜灯亮了。\n乙。\n作者续写。';
  const plan = planWholeAccept(current, before, after, new Set(), normalize);
  assert.equal(plan.fastPath, false);
  assert.equal(plan.applied.length, 0, '作者已写出同类改动，应幂等跳过');
  assert.equal(plan.content, current, '不得把 beforeText 当子串再施加一次');
});

test('T07-F3：删除类 op 重复确认幂等，不再删一次也不抛冲突', () => {
  const before = '甲。\n乙。\n丙。';
  const after = '甲。\n丙。';
  const ops = buildSuggestionOps(before, after);
  assert.equal(ops.length, 1);
  assert.equal(ops[0].afterText, '', '应是纯删除 op');
  const applied = planWholeAccept(before, before, after, new Set(), normalize);
  assert.equal(applied.content, after);
  // 重复确认：当前稿已是 after，删除 op 必须幂等跳过。
  const repeated = planWholeAccept(after, before, after, new Set(), normalize);
  assert.equal(repeated.content, after);
  assert.equal(repeated.applied.length, 0);
  assert.deepEqual([...repeated.settledOpIds], [ops[0].id]);
});

test('同一 before/after 文本出现两处时 matchSuggestionOp 判为不可一一对应', () => {
  const ops = buildSuggestionOps('X\nAAA\nY\nAAA\nZ', 'X\nBBB\nY\nBBB\nZ');
  assert.equal(ops.length, 2);
  assert.equal(ops[0].beforeText, ops[1].beforeText, '两处原文文本相同');
  assert.equal(matchSuggestionOp(ops, ops[0]), null);
});

test('位置 ID 相同但原文已被作者等长改写时，不能冒充原始 op', () => {
  const before = '旧一。\n中间。\n旧二。';
  const after = '新一。\n中间。\n新二。';
  const original = buildSuggestionOps(before, after);
  const rebased = buildSuggestionOps('新一。\n中间。\n手改。', after)[0];
  assert.equal(rebased.id, original[1].id, '位置 ID 并不绑定 beforeText');
  assert.notEqual(rebased.beforeText, original[1].beforeText);
  assert.equal(matchSuggestionOp(original, rebased), null);
});

test('相邻 op 已接受并改变前缀时，原始剩余 op 仍可按唯一原文安全定位', () => {
  const before = '旧一。\n中间。\n旧二。';
  const after = '新一。\n中间。\n新二。';
  const ops = buildSuggestionOps(before, after);
  const current = planHunkAccept(before, ops[0], before).content;
  const result = planHunkAccept(current, ops[1], before);
  assert.equal(result.content, after);
  assert.equal(result.alreadyApplied, false);
});

test('invertPatchHunk 交换前后文本，应用逆 op 回到原文', () => {
  const before = '甲。\n乙。\n丙。';
  const after = '甲改。\n乙。\n丙改。';
  const op = buildSuggestionOps(before, after)[0];
  const inverse = invertPatchHunk(op);
  assert.equal(inverse.beforeText, op.afterText);
  assert.equal(inverse.afterText, op.beforeText);
  const back = applyPatchHunkToCurrent(applyPatchHunkToCurrent(before, op), inverse);
  assert.equal(back, before);
});

test('同一行双句（segment 级 op）逐 op 映射保留范围外改动', () => {
  const before = '甲。乙。\n丙。';
  const after = '甲。乙改。\n丙。';
  const plan = planWholeAccept('甲。乙。\n丙作者。', before, after, new Set(), normalize);
  assert.equal(plan.content, '甲。乙改。\n丙作者。');
});

test('重复句删除按原始偏移 + 前后文定位，落到正确的那一处', () => {
  const before = '重复句。\n重复句。\n尾巴。';
  const after = '重复句。\n尾巴。';
  const ops = buildSuggestionOps(before, after);
  assert.equal(ops.length, 1);
  const plan = planWholeAccept('重复句。\n重复句。\n尾巴改。', before, after, new Set(), normalize);
  assert.equal(plan.content, '重复句。\n尾巴改。');
  assert.equal(plan.fastPath, false);
});

const NL = String.fromCharCode(10);
const block = (ch: string, n = 60) => ch.repeat(n) + NL;

test('重复块过度施加：作者已手动改出同一结果时幂等跳过，不碰第二处 B', () => {
  const P = block('P');
  const B = block('B');
  const S = block('S');
  const A = block('A');
  const before = P + B + S + P + B + S;
  const after = P + A + S + P + B + S;
  const plan = planWholeAccept(after, before, after, new Set(), normalize);
  assert.equal(plan.applied.length, 0, '补丁只改第一处，目标处已是 afterText，应幂等跳过');
  assert.equal(plan.content, after, '不得把第二处 B 也改成 A');
  assert.ok(plan.content.includes(B), '第二处 B 必须保留');
});

test('重复块不再把补丁施加到作者没打算改的第二处（子串/重复结果）', () => {
  const before = '甲。\n灯亮了。\n乙。';
  const after = '甲。\n铜灯亮了。\n乙。';
  const current = '甲。\n铜灯亮了。\n乙。\n甲。\n灯亮了。\n乙。';
  const plan = planWholeAccept(current, before, after, new Set(), normalize);
  assert.equal(plan.content, current, '第一处已是结果，第二处原文不得被改');
  assert.ok(plan.content.endsWith('甲。\n灯亮了。\n乙。'), '第二处必须保持原样');
});

test('前缀出现多处且出现序号越界时判冲突，不取候选猜着写', () => {
  const ctx = block('丙');
  const tgt = block('甲');
  const repl = block('乙');
  const before = ctx + tgt + ctx + tgt + ctx + tgt;
  const after = ctx + tgt + ctx + tgt + ctx + repl;
  // 作者删掉开头一组：前缀出现次数少于 op 的原始出现序号，无法唯一确定目标。
  const current = ctx + tgt + ctx + tgt;
  assert.throws(
    () => planWholeAccept(current, before, after, new Set(), normalize),
    /多次|冲突|定位/,
  );
});

test('前缀在原文中重复时按出现序号锚定到正确的那一处', () => {
  const ctx = block('丙');
  const tgt = block('甲');
  const repl = block('乙');
  const before = ctx + tgt + ctx + tgt;
  const after = ctx + tgt + ctx + repl;
  const current = before + '无关。\n';
  const plan = planWholeAccept(current, before, after, new Set(), normalize);
  assert.equal(plan.content, after + '无关。\n', '应改第二处 tgt');
  assert.ok(plan.content.startsWith(ctx + tgt + ctx + repl), '第一处 tgt 不得被改');
});

test('associateIssuesToOps 按行范围归属问题，无范围的问题不臆造关联', () => {
  const before = ['甲。', '乙。', '丙。'].join(NL);
  const after = ['甲改。', '乙。', '丙改。'].join(NL);
  const ops = buildSuggestionOps(before, after);
  assert.equal(ops.length, 2);
  const scopes: IssueScope[] = [
    { id: 'A', lineStart: 1, lineEnd: 1 },
    { id: 'B', lineStart: 3, lineEnd: 3 },
  ];
  const links = associateIssuesToOps(ops, scopes);
  assert.deepEqual(links.get(ops[0].id), ['A']);
  assert.deepEqual(links.get(ops[1].id), ['B']);
  assert.equal(associateIssuesToOps(ops, []).size, 0, '没有行范围时不得产生任何归属');
  assert.equal(hasIssueAttribution(['A', 'B'], scopes), true);
  assert.equal(
    hasIssueAttribution(['missing'], scopes),
    false,
    '匹配不到任何行范围的问题不算已归属',
  );
  assert.equal(hasIssueAttribution(['A'], []), false, '没有行范围时不得报已归属');
  // 有行范围数据但本次没有 op 覆盖它：仍算已归属，调用方应如实报 0/N 而非「未归属」。
  assert.equal(hasIssueAttribution(['C'], [{ id: 'C', lineStart: 2, lineEnd: 2 }]), true);
});

test('resolveIssueStatuses 完整覆盖才 resolved，部分覆盖 touched，未覆盖 open', () => {
  const before = '甲。\n乙。\n丙。';
  const after = '甲改。\n乙。\n丙改。';
  const ops = buildSuggestionOps(before, after);
  const scopes: IssueScope[] = [
    { id: 'A', lineStart: 1, lineEnd: 1 },
    { id: 'B', lineStart: 3, lineEnd: 3 },
    { id: 'C', lineStart: 1, lineEnd: 3 },
  ];
  // 只接受覆盖第 1 行的 op：A 完整覆盖 resolved；C（1-3 行）只覆盖到第 1 行 → touched。
  const firstOnly = resolveIssueStatuses(['A', 'B', 'C'], scopes, ops, new Set([ops[0].id]));
  assert.deepEqual(firstOnly, [
    { id: 'A', status: 'resolved' },
    { id: 'B', status: 'open' },
    { id: 'C', status: 'touched' },
  ]);
  // 只接受覆盖第 3 行的 op：C 仍不完整 → touched。
  const lastOnly = resolveIssueStatuses(['A', 'B', 'C'], scopes, ops, new Set([ops[1].id]));
  assert.deepEqual(lastOnly, [
    { id: 'A', status: 'open' },
    { id: 'B', status: 'resolved' },
    { id: 'C', status: 'touched' },
  ]);
  // 两处都接受：C 跨 1-3 行但第 2 行无 op 覆盖，仍有缺口 → 保持 touched。
  const full = resolveIssueStatuses(['A', 'B', 'C'], scopes, ops, new Set(ops.map((op) => op.id)));
  assert.deepEqual(full, [
    { id: 'A', status: 'resolved' },
    { id: 'B', status: 'resolved' },
    { id: 'C', status: 'touched' },
  ]);
  assert.deepEqual(summarizeIssueResolutions(firstOnly), {
    observed: 3,
    authorConfirmed: 2,
    resolved: 1,
  });
});

test('resolveIssueStatuses 单个跨行 op 完整覆盖问题范围即 resolved', () => {
  const before = '甲。\n乙。\n丙。';
  const after = '甲改。\n乙改。\n丙改。';
  const ops = buildSuggestionOps(before, after);
  assert.equal(ops.length, 1, '连续三行的改动归并为一个 op');
  assert.equal(ops[0].originalEndIndex - ops[0].originalStartIndex, 3);
  const scopes: IssueScope[] = [{ id: 'span', lineStart: 1, lineEnd: 3 }];
  assert.deepEqual(resolveIssueStatuses(['span'], scopes, ops, new Set([ops[0].id])), [
    { id: 'span', status: 'resolved' },
  ]);
  assert.deepEqual(resolveIssueStatuses(['span'], scopes, ops, new Set()), [
    { id: 'span', status: 'open' },
  ]);
});

// 确定性 fuzz：重复长块 / CRLF / emoji 下，随机作者改动后整份接受必须满足
// 「改动只落在 op 定位到的目标块，未授权块一律不动，歧义时抛冲突而非写盘」。
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

test('fuzz：改动只落在 op 目标块，歧义即拒（确定性随机，3000 例）', () => {
  const rng = mulberry32(20261004);
  const alphabet = ['甲', '乙', '丙', '丁', '0', '1', '😀', 'é'];
  const pick = <T>(xs: T[]) => xs[Math.floor(rng() * xs.length)];
  const failures: string[] = [];
  for (let s = 0; s < 3000; s += 1) {
    const n = 2 + Math.floor(rng() * 5);
    const blocks: string[] = [];
    for (let i = 0; i < n; i += 1) {
      let text = '';
      const len = 8 + Math.floor(rng() * 40);
      for (let c = 0; c < len; c += 1) text += pick(alphabet);
      blocks.push(text);
    }
    for (let i = 1; i < n; i += 1) if (rng() < 0.45) blocks[i] = blocks[Math.floor(rng() * i)];
    const k = Math.floor(rng() * n);
    let repl: string;
    do {
      repl = '';
      const len = 8 + Math.floor(rng() * 40);
      for (let c = 0; c < len; c += 1) repl += pick(alphabet);
    } while (repl === blocks[k]);
    const sep = rng() < 0.3 ? '\r\n' : '\n';
    const before = blocks.join(sep);
    const afterBlocks = blocks.slice();
    afterBlocks[k] = repl;
    const after = afterBlocks.join(sep);

    const currentBlocks = blocks.slice();
    const roll = rng();
    if (roll < 0.15) {
      // 不改
    } else if (roll < 0.3) {
      const j = Math.floor(rng() * n);
      if (j !== k) currentBlocks[j] = `远${Math.floor(rng() * 1e6)}`;
    } else if (roll < 0.45) {
      const j = k + (rng() < 0.5 ? -1 : 1);
      if (j >= 0 && j < n) currentBlocks[j] = `邻${Math.floor(rng() * 1e6)}`;
    } else if (roll < 0.6) {
      currentBlocks[k] = `内${Math.floor(rng() * 1e6)}`;
    } else if (roll < 0.8) {
      currentBlocks[k] = repl; // 作者已手动改出同一结果
    } else {
      const dup = blocks.map((b, i) => (b === blocks[k] && i !== k ? i : -1)).filter((i) => i >= 0);
      currentBlocks[dup.length > 0 ? dup[Math.floor(rng() * dup.length)] : k] = repl;
    }
    const current = currentBlocks.join(sep);

    let out: string;
    try {
      out = planWholeAccept(current, before, after, new Set(), normalize).content;
    } catch {
      continue; // 判冲突（拒写）是允许的安全结果
    }
    const outBlocks = out.split(sep);
    const info = `case=${s} k=${k} sep=${JSON.stringify(sep)} before=${JSON.stringify(before)} after=${JSON.stringify(after)} current=${JSON.stringify(current)} out=${JSON.stringify(out)}`;
    if (outBlocks.length !== currentBlocks.length) failures.push(`行长变化 ${info}`);
    for (let i = 0; i < n; i += 1) {
      if (i !== k && outBlocks[i] !== currentBlocks[i]) failures.push(`改到未授权块 ${i} ${info}`);
    }
    if (outBlocks[k] !== currentBlocks[k] && outBlocks[k] !== repl)
      failures.push(`目标块写成非补丁文本 ${info}`);
  }
  assert.deepEqual(failures.slice(0, 2), []);
});

// T10：分块接受改走与整份接受同一套锚定定位器后，重复块 + 目标上下文被改必须拒写。
test('T10：分块接受在目标上下文被改 + 重复块时判歧义，不取最佳分候选写错处', () => {
  const P = '甲'.repeat(48);
  const P2 = '戊'.repeat(10);
  const T = '目标句。';
  const T2 = '替换句。';
  const S = '乙'.repeat(48);
  const line = (s: string) => `${s}\n`;
  const before = [P, T, S, P, T, S].map(line).join('');
  const after = [P, T2, S, P, T, S].map(line).join('');
  const current = [P2, T, S, P, T, S].map(line).join('');
  const hunk = buildPatchHunks(before, after)[0];
  // 旧定位器（patch-hunks.findTextRanges：全部出现里取部分上下文最佳分）在此形态下确实写错处：
  // 目标块前文被改后，第二处重复块成了唯一「上下文完全吻合」的候选，补丁被施加到它身上。
  const misplaced = applyPatchHunkToCurrent(current, hunk);
  assert.ok(
    misplaced.includes(`${P}\n${T2}`),
    `旧定位器应（且确实）把补丁写到第二处重复块；实际: ${JSON.stringify(misplaced)}`,
  );
  // 分块接受走同一锚定定位器：无法唯一确定目标 → 判歧义、不写。
  assert.throws(() => planHunkAccept(current, hunk, before), /歧义|定位|冲突|多次/);
});

// T10 窄项：删除类 op（afterText 为空）无法两侧核验时，重复块必须拒写，不能只信前缀锚点。
test('T10：删除类 op 只剩重复块一处可选时判歧义，不删错处', () => {
  const P = '甲'.repeat(48);
  const S = '乙'.repeat(48);
  const T = '目标句。';
  const line = (s: string) => `${s}\n`;
  const before = [P, T, S, P, T, S].map(line).join('');
  const after = [P, S, P, T, S].map(line).join('');
  const current = [P, '作者自改', S, P, T, S].map(line).join('');
  const hunk = buildPatchHunks(before, after)[0];
  assert.equal(hunk.afterText, '', '应是纯删除 op');
  assert.throws(() => planHunkAccept(current, hunk, before), /歧义|定位|冲突|多次/);
});

// 确定性 fuzz（分块接受路径）：复用整份接受 fuzz 的同一生成器，断言「改动只落在定位到的
// 块、未授权块一律不动、无法唯一确定即拒（纯函数零改动）」。
test('fuzz：分块接受改动只落在定位到的块，歧义即拒（确定性随机，30000 例）', () => {
  const rng = mulberry32(20261004);
  const alphabet = ['甲', '乙', '丙', '丁', '0', '1', '😀', 'é'];
  const pick = <T>(xs: T[]) => xs[Math.floor(rng() * xs.length)];
  const failures: string[] = [];
  let applied = 0;
  let rejected = 0;
  let noop = 0;
  for (let s = 0; s < 30000; s += 1) {
    const n = 2 + Math.floor(rng() * 5);
    const blocks: string[] = [];
    for (let i = 0; i < n; i += 1) {
      let text = '';
      const len = 8 + Math.floor(rng() * 40);
      for (let c = 0; c < len; c += 1) text += pick(alphabet);
      blocks.push(text);
    }
    for (let i = 1; i < n; i += 1) if (rng() < 0.45) blocks[i] = blocks[Math.floor(rng() * i)];
    const k = Math.floor(rng() * n);
    let repl: string;
    do {
      repl = '';
      const len = 8 + Math.floor(rng() * 40);
      for (let c = 0; c < len; c += 1) repl += pick(alphabet);
    } while (repl === blocks[k]);
    const sep = rng() < 0.3 ? '\r\n' : '\n';
    const before = blocks.join(sep);
    const afterBlocks = blocks.slice();
    afterBlocks[k] = repl;
    const after = afterBlocks.join(sep);

    const currentBlocks = blocks.slice();
    const roll = rng();
    if (roll < 0.15) {
      // 不改
    } else if (roll < 0.3) {
      const j = Math.floor(rng() * n);
      if (j !== k) currentBlocks[j] = `远${Math.floor(rng() * 1e6)}`;
    } else if (roll < 0.45) {
      const j = k + (rng() < 0.5 ? -1 : 1);
      if (j >= 0 && j < n) currentBlocks[j] = `邻${Math.floor(rng() * 1e6)}`;
    } else if (roll < 0.6) {
      currentBlocks[k] = `内${Math.floor(rng() * 1e6)}`;
    } else if (roll < 0.8) {
      currentBlocks[k] = repl; // 作者已手动改出同一结果
    } else {
      const dup = blocks.map((b, i) => (b === blocks[k] && i !== k ? i : -1)).filter((i) => i >= 0);
      currentBlocks[dup.length > 0 ? dup[Math.floor(rng() * dup.length)] : k] = repl;
    }
    const current = currentBlocks.join(sep);

    const hunk = buildPatchHunks(before, after)[0];
    if (!hunk) {
      failures.push(`case=${s} 未生成分块`);
      continue;
    }
    const info = `case=${s} k=${k} sep=${JSON.stringify(sep)} before=${JSON.stringify(before)} after=${JSON.stringify(after)} current=${JSON.stringify(current)}`;
    let out: string;
    try {
      const plan = planHunkAccept(current, hunk, before);
      out = plan.content;
      if (plan.alreadyApplied) noop += 1;
      else applied += 1;
    } catch {
      rejected += 1; // 无法唯一确定 → 拒绝；纯函数零改动
      continue;
    }
    const outBlocks = out.split(sep);
    if (outBlocks.length !== currentBlocks.length) failures.push(`行长变化 ${info}`);
    for (let i = 0; i < n; i += 1) {
      if (i !== k && outBlocks[i] !== currentBlocks[i]) failures.push(`改到未授权块 ${i} ${info}`);
    }
    if (outBlocks[k] !== currentBlocks[k] && outBlocks[k] !== repl)
      failures.push(`目标块写成非补丁文本 ${info}`);
  }
  assert.equal(applied + rejected + noop, 30000);
  assert.ok(applied > 1000, `分块接受成功例数偏少：${applied}`);
  assert.deepEqual(failures.slice(0, 2), []);
});

// 删除类分块接受：末块恒为哨兵（不删），目标取非末块，保证 hunk 是不带边界的纯删除；
// 断言「只删目标块、其余逐字不动」，目标被作者改写时必须拒绝。
test('fuzz：删除类分块接受只删目标块（确定性随机，6000 例）', () => {
  const rng = mulberry32(777001);
  const alphabet = ['甲', '乙', '丙', '丁', '0', '1', '😀', 'é'];
  const pick = <T>(xs: T[]) => xs[Math.floor(rng() * xs.length)];
  const failures: string[] = [];
  let applied = 0;
  let rejected = 0;
  let noop = 0;
  for (let s = 0; s < 6000; s += 1) {
    const n = 3 + Math.floor(rng() * 5);
    const blocks: string[] = [];
    for (let i = 0; i < n; i += 1) {
      let text = '';
      const len = 8 + Math.floor(rng() * 40);
      for (let c = 0; c < len; c += 1) text += pick(alphabet);
      blocks.push(text);
    }
    const k = Math.floor(rng() * (n - 1));
    const sep = rng() < 0.3 ? '\r\n' : '\n';
    const before = blocks.join(sep);
    const after = blocks.filter((_, i) => i !== k).join(sep);

    const currentBlocks = blocks.slice();
    const roll = rng();
    if (roll < 0.2) {
      // 不改
    } else if (roll < 0.45) {
      const j = Math.floor(rng() * n);
      if (j !== k) currentBlocks[j] = `远${Math.floor(rng() * 1e6)}`;
    } else if (roll < 0.65) {
      currentBlocks[k] = `内${Math.floor(rng() * 1e6)}`; // 目标被改写 → 必须拒绝
    } else if (roll < 0.85) {
      const j = k + (rng() < 0.5 ? -1 : 1);
      if (j >= 0 && j < n) currentBlocks[j] = `邻${Math.floor(rng() * 1e6)}`;
    } else {
      currentBlocks.push(`新增${Math.floor(rng() * 1e6)}`);
    }
    const current = currentBlocks.join(sep);

    const hunk = buildPatchHunks(before, after)[0];
    if (!hunk) {
      failures.push(`case=${s} 未生成分块`);
      continue;
    }
    if (hunk.afterText !== '') {
      failures.push(`case=${s} 非纯删除 hunk afterText=${JSON.stringify(hunk.afterText)}`);
      continue;
    }
    const info = `case=${s} k=${k} sep=${JSON.stringify(sep)} before=${JSON.stringify(before)} after=${JSON.stringify(after)} current=${JSON.stringify(current)}`;
    let out: string;
    let already: boolean;
    try {
      const plan = planHunkAccept(current, hunk, before);
      out = plan.content;
      already = plan.alreadyApplied;
    } catch {
      rejected += 1;
      continue;
    }
    if (already) {
      noop += 1;
      continue;
    }
    applied += 1;
    const expected = currentBlocks.filter((_, i) => i !== k).join(sep);
    if (out !== expected)
      failures.push(`删除结果非「仅删目标块」 ${info} out=${JSON.stringify(out)}`);
  }
  assert.equal(applied + rejected + noop, 6000);
  assert.ok(applied > 200, `删除分块成功例数偏少：${applied}`);
  assert.ok(rejected > 0, '删除分块应存在被安全拒绝的例');
  assert.deepEqual(failures.slice(0, 2), []);
});
