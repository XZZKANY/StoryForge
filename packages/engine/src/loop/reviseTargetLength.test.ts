// issue #492：修订指令里写了明确字数，修订稿落在目标外要在补丁上提示；只提示、不拦稿。
import { describe, expect, it } from 'vitest';
import {
  parseTargetLength,
  revisionTargetLength,
  targetLengthHint,
  type TargetLength,
} from './reviseTargetLength';

const range = (min: number | null, max: number | null, approximate = false): TargetLength => ({
  min,
  max,
  approximate,
});

describe('从修订指令里认出目标字数', () => {
  it.each([
    ['把这章改成4000字', range(3600, 4400, true)],
    ['4000 字左右', range(3600, 4400, true)],
    ['整章大概四千字', range(3600, 4400, true)],
    ['改成大约 4000 字', range(3600, 4400, true)],
    ['扩写到6000字', range(5400, 6600, true)],
    ['压缩成四千五百字', range(4050, 4950, true)],
    ['改成四千五', null],
    ['改成四千五字左右', range(4050, 4950, true)],
    ['改到一万二字', range(10800, 13200, true)],
    ['改到 3k 字', range(2700, 3300, true)],
    ['改成１．５万字', range(13500, 16500, true)],
    ['改成４０００字左右', range(3600, 4400, true)],
    ['字数控制在4000左右', range(3600, 4400, true)],
    ['改成4000多字', range(3600, 4400, true)],
  ])('单个数按上下各一成：%s', (instruction, expected) => {
    expect(parseTargetLength(instruction)).toEqual(expected);
  });

  it.each([
    ['3600-4400 字', range(3600, 4400)],
    ['3600–4400字', range(3600, 4400)],
    ['3600～4400字', range(3600, 4400)],
    ['改成 3600 到 4400 字', range(3600, 4400)],
    ['3600字至4400字', range(3600, 4400)],
    ['写成三四千字', range(3000, 4000)],
    ['控制在三到四千字', range(3000, 4000)],
    ['压到 3-4k 字', range(3000, 4000)],
    ['4400-3600字', range(3600, 4400)],
  ])('明写的区间照用：%s', (instruction, expected) => {
    expect(parseTargetLength(instruction)).toEqual(expected);
  });

  it.each([
    ['不超过3000字', range(null, 3000)],
    ['别超过三千字', range(null, 3000)],
    ['压缩到3000字以内', range(null, 3000)],
    ['控制在3000字之内', range(null, 3000)],
    ['篇幅压到3000以内', range(null, 3000)],
    ['至少5000字', range(5000, null)],
    ['扩写到5000字以上', range(5000, null)],
    ['不少于五千字', range(5000, null)],
    ['至少3000字，不超过4000字', range(3000, 4000)],
  ])('单边的上限 / 下限：%s', (instruction, expected) => {
    expect(parseTargetLength(instruction)).toEqual(expected);
  });

  it.each([
    ['从6000字压缩到4000字', range(3600, 4400, true)],
    ['篇幅从6000到4000字', range(3600, 4400, true)],
    ['这章现在6000字左右，压到4000字', range(3600, 4400, true)],
    ['开头改得抓人一点，整章压到4000字', range(3600, 4400, true)],
    ['改成4000字左右，每段不超过300字', range(3600, 4400, true)],
  ])('原稿字数、局部要求不算目标：%s', (instruction, expected) => {
    expect(parseTargetLength(instruction)).toEqual(expected);
  });

  it.each([
    '把对话写得更有力',
    '第3章的节奏太慢了',
    '6000字的稿子太长了',
    '删掉2000字',
    '压缩2000字左右',
    '再加1000字',
    '比原来少两千字',
    '删掉2000-3000字',
    '把开头那段扩写到300字',
    '开头那段，压到300字',
    '第三段压到200字以内',
    '标题别超过20字',
    '以后每章至少三千字',
    '已经写到6000字了，再精简一点',
    '在第2000字附近加一句伏笔',
    '写到2000字的时候让她出场',
    '读到6000字就腻了',
    '现在不到3000字',
    '改成4000',
    '每千字一个钩子',
    '第一章改成4000字，第二章改成3000字',
  ])('认不出或说不清就不给目标：%s', (instruction) => {
    expect(parseTargetLength(instruction)).toBeNull();
  });

  it('作者原话优先，认不出再看修订指令', () => {
    expect(revisionTargetLength(['改成4000字左右', '压缩到3000字'])).toEqual(
      range(3600, 4400, true),
    );
    expect(revisionTargetLength(['就照刚才说的改', '压缩到3000字以内'])).toEqual(range(null, 3000));
    expect(revisionTargetLength([null, undefined, '把对话写得更有力'])).toBeNull();
  });
});

describe('修订稿字数落在目标外才提示', () => {
  const chapter = (chars: number) => `第一章\n\n${'字'.repeat(chars - 3)}`;

  it('偏多：按上限算差额，口径是空白以外的每个字', () => {
    const hint = targetLengthHint(range(3600, 4400, true), chapter(5999));
    expect(hint).toEqual({
      message: '字数提示：目标约 3600–4400 字，这版实际 5999 字（偏多 1599 字）。',
      target_min: 3600,
      target_max: 4400,
      actual_chars: 5999,
      direction: 'over',
      off_by: 1599,
    });
  });

  it('偏少、单边上限、单边下限、明写区间各自的说法', () => {
    expect(targetLengthHint(range(3600, 4400), chapter(3000))?.message).toBe(
      '字数提示：目标 3600–4400 字，这版实际 3000 字（偏少 600 字）。',
    );
    expect(targetLengthHint(range(null, 3000), chapter(3500))?.message).toBe(
      '字数提示：目标不超过 3000 字，这版实际 3500 字（偏多 500 字）。',
    );
    expect(targetLengthHint(range(5000, null), chapter(4200))?.message).toBe(
      '字数提示：目标至少 5000 字，这版实际 4200 字（偏少 800 字）。',
    );
  });

  it('落在区间内（含边界）、没有目标都不提示', () => {
    expect(targetLengthHint(range(3600, 4400, true), chapter(3600))).toBeNull();
    expect(targetLengthHint(range(3600, 4400, true), chapter(4400))).toBeNull();
    expect(targetLengthHint(range(null, 3000), chapter(10))).toBeNull();
    expect(targetLengthHint(range(5000, null), chapter(9000))).toBeNull();
    expect(targetLengthHint(null, chapter(5999))).toBeNull();
  });

  it('换行、空格、全角空格不计数', () => {
    const spaced = `${'字'.repeat(2000)}\n\n  ${'字'.repeat(2000)}${String.fromCharCode(0x3000)}\r\n`;
    expect(targetLengthHint(range(3600, 4400, true), spaced)).toBeNull();
    expect(targetLengthHint(range(4100, 4400), spaced)?.actual_chars).toBe(4000);
  });
});
