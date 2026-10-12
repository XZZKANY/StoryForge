import { describe, expect, it } from 'vitest';
import golden from '../../golden/p1-breakdown.windows.json';
import {
  BookBreakdownError,
  BreakdownCancellations,
  loadProjectChapters,
  parseChapters,
  parseModelAnalysis,
  readBookBreakdownStatus,
  readBreakdownSource,
  runBookBreakdown,
  selectedContext,
  selectRepresentativeChapters,
  type Chapter,
  type SelectedChapter,
} from './bookBreakdown';
import { decodeFixtureBytes, type EncodedFile } from './contextFixture.test-support';
import { crc32 } from './docx';
import { InputDomainError } from './json';
import { memoryProject } from './memoryProject.test-support';

const ROOT = golden.synthetic_root;
const platform = golden.platform as 'windows' | 'posix';

type PureRow = {
  fn: string;
  args_json: string;
  output_json?: string;
  error?: { type: string; message: string };
};

function runPure(row: PureRow): unknown {
  const args = JSON.parse(row.args_json);
  switch (row.fn) {
    case 'parse_chapters':
      return parseChapters(args.text, args.source);
    case 'select': {
      const chapters = Array.from({ length: args.count }, (_, i) => ({
        chapter_id: `c:${i + 1}`,
        global_index: i + 1,
        title: `第${i + 1}章`,
        source_path: 'c',
      })) as Chapter[];
      return selectRepresentativeChapters(chapters, args.target);
    }
    case 'parse_model':
      return parseModelAnalysis(args.raw, args.selected as SelectedChapter[]);
    case 'registry': {
      const registry = new BreakdownCancellations();
      return (args.steps as string[]).map((step) => {
        const [action, id] = step.split(':');
        if (action === 'prepare') return registry.prepare(id).isCancelled();
        if (action === 'request') return registry.request(id);
        registry.release(id);
        return null;
      });
    }
    default:
      throw new Error(`Unknown pure oracle ${row.fn}`);
  }
}

describe('real Python book-breakdown pure functions', () => {
  for (const [index, row] of (golden.pure as PureRow[]).entries()) {
    it(`${index} ${row.fn} ${row.args_json.slice(0, 60)}`, () => {
      if (row.error) {
        const caught = (() => {
          try {
            runPure(row);
          } catch (error) {
            return error;
          }
          return null;
        })();
        // JSON 解析失败的措辞不模仿 Python（只核类型）。
        if (row.error.type === 'JSONDecodeError') expect(caught).toBeInstanceOf(InputDomainError);
        else {
          expect(caught).toBeInstanceOf(BookBreakdownError);
          expect((caught as Error).message).toBe(row.error.message);
        }
        return;
      }
      expect(runPure(row)).toEqual(JSON.parse(row.output_json!));
    });
  }
});

type Reply = { content?: unknown } | { raise: string };
type Call = {
  fn: string;
  args: { [key: string]: never };
  output_json?: string;
  error?: { type: string; message: string };
  writes: Record<string, EncodedFile | null>;
};
const projects = golden.projects as unknown as {
  id: string;
  files: Record<string, EncodedFile>;
  calls: Call[];
}[];

function scripted(replies: Reply[]) {
  const calls: object[] = [];
  let index = 0;
  const callLlm = async (request: { systemPrompt: string; userPrompt: string }) => {
    calls.push({ system: request.systemPrompt, user: request.userPrompt });
    const reply = replies[index++];
    if ('raise' in reply) throw new Error(reply.raise);
    return { content: reply.content };
  };
  return { calls, callLlm };
}

async function execute(project: ReturnType<typeof memoryProject>, call: Call): Promise<unknown> {
  const { reader, writer } = project;
  const { args } = call;
  switch (call.fn) {
    case 'read_source':
      return readBreakdownSource(reader, ROOT, args.path, platform);
    case 'status':
      return readBookBreakdownStatus(reader, ROOT, platform);
    case 'selected_context':
      return selectedContext(reader, ROOT, args.report, { platform, maxChars: args.max_chars });
    case 'run': {
      const { calls, callLlm } = scripted(args.replies);
      let checks = 0;
      const output = await runBookBreakdown(reader, writer, ROOT, {
        platform,
        targetCount: args.target_count,
        analysisId: args.analysis_id,
        model:
          args.model_source === 'configured'
            ? { provider: 'openai', model: 'fake-model', callLlm }
            : null,
        cancellation: args.cancel_event
          ? { isCancelled: () => ++checks >= args.cancel_event }
          : null,
        cancellations: new BreakdownCancellations(),
        newAnalysisId: () => 'feedfacefeedfacefeedfacefeedface',
      });
      return { output, calls };
    }
    default:
      throw new Error(`Unknown oracle call ${call.fn}`);
  }
}

describe('real Python book-breakdown project replay', () => {
  for (const record of projects) {
    describe(record.id, () => {
      const project = memoryProject(ROOT, record.files);
      for (const [index, call] of record.calls.entries()) {
        it(`#${index} ${call.fn} ${JSON.stringify(call.args).slice(0, 60)}`, async () => {
          if (call.fn === 'author_write') {
            project.apply(call.writes);
            return;
          }
          if (call.error) {
            const caught = await execute(project, call).then(
              () => null,
              (error: unknown) => error,
            );
            expect(caught).toBeInstanceOf(BookBreakdownError);
            expect((caught as Error).message).toBe(call.error.message);
          } else expect(await execute(project, call)).toEqual(JSON.parse(call.output_json!));
          const writes = project.takeWrites();
          expect(Object.keys(writes).sort()).toEqual(Object.keys(call.writes).sort());
          for (const [path, file] of Object.entries(call.writes)) {
            const expected = decodeFixtureBytes(file!);
            expect(new TextDecoder().decode(writes[path]), path).toBe(
              new TextDecoder().decode(expected),
            );
            expect(writes[path], path).toEqual(expected);
          }
        });
      }
    });
  }
});

/** 最小 stored zip：只为构造 Python 读得了、但不在拆书输入范围内的 DOCX。 */
function storedZip(
  name: string,
  data: Uint8Array,
  options: { flags?: number; method?: number } = {},
) {
  const nameBytes = new TextEncoder().encode(name);
  const local = new Uint8Array(30 + nameBytes.length + data.length);
  const central = new Uint8Array(46 + nameBytes.length);
  const end = new Uint8Array(22);
  const lv = new DataView(local.buffer);
  const cv = new DataView(central.buffer);
  const ev = new DataView(end.buffer);
  const crc = crc32(data);
  lv.setUint32(0, 0x04034b50, true);
  lv.setUint16(6, options.flags ?? 0, true);
  lv.setUint16(8, options.method ?? 0, true);
  lv.setUint32(14, crc, true);
  lv.setUint32(18, data.length, true);
  lv.setUint32(22, data.length, true);
  lv.setUint16(26, nameBytes.length, true);
  local.set(nameBytes, 30);
  local.set(data, 30 + nameBytes.length);
  cv.setUint32(0, 0x02014b50, true);
  cv.setUint8(6, 20);
  cv.setUint16(8, options.flags ?? 0, true);
  cv.setUint16(10, options.method ?? 0, true);
  cv.setUint32(16, crc, true);
  cv.setUint32(20, data.length, true);
  cv.setUint32(24, data.length, true);
  cv.setUint16(28, nameBytes.length, true);
  central.set(nameBytes, 46);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, 1, true);
  ev.setUint16(10, 1, true);
  ev.setUint32(12, central.length, true);
  ev.setUint32(16, local.length, true);
  return new Uint8Array([...local, ...central, ...end]);
}

const encode = (text: string) => new TextEncoder().encode(text);
const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const wordXml = (head: string) =>
  `${head}<w:document xmlns:w="${W}"><w:body><w:p><w:r><w:t>甲</w:t></w:r></w:p></w:body></w:document>`;
const fixture = (raw: Uint8Array): EncodedFile => ({
  chunks: [
    { base64: btoa(Array.from(raw, (byte) => String.fromCharCode(byte)).join('')), repeat: 1 },
  ],
});

describe('book-breakdown input range (§4.3.1): 范围外直接报错，不复刻 Python 的偶然行为', () => {
  const cases: [string, Uint8Array][] = [
    ['nan.json', encode('{"content": NaN}')],
    ['infinity.json', encode('[1, -Infinity]')],
    ['deep.json', encode('['.repeat(65) + ']'.repeat(65))],
    ['big-int.json', encode('{"n": 12345678901234567890}')],
    ['surrogate.json', encode('"\\ud800"')],
    ['encrypted.docx', storedZip('word/document.xml', encode(wordXml('')), { flags: 1 })],
    ['bzip2.docx', storedZip('word/document.xml', encode(wordXml('')), { method: 12 })],
    [
      'doctype.docx',
      storedZip('word/document.xml', encode(wordXml('<!DOCTYPE d [<!ENTITY e "x">]>'))),
    ],
    [
      'latin1.docx',
      storedZip(
        'word/document.xml',
        encode(wordXml('<?xml version="1.0" encoding="ISO-8859-1"?>')),
      ),
    ],
    ['utf16.docx', storedZip('word/document.xml', new Uint8Array([0xff, 0xfe, 0x3c, 0x00]))],
  ];
  for (const [name, raw] of cases)
    it(name, async () => {
      const { reader } = memoryProject(ROOT, { [`参考/${name}`]: fixture(raw) });
      await expect(loadProjectChapters(reader, ROOT, platform)).rejects.toBeInstanceOf(
        InputDomainError,
      );
    });

  it('zip64 end locator', async () => {
    const zip = storedZip('word/document.xml', encode(wordXml('')));
    const locator = new Uint8Array(20);
    new DataView(locator.buffer).setUint32(0, 0x07064b50, true);
    const raw = new Uint8Array([
      ...zip.subarray(0, zip.length - 22),
      ...locator,
      ...zip.subarray(zip.length - 22),
    ]);
    const { reader } = memoryProject(ROOT, { '参考/zip64.docx': fixture(raw) });
    await expect(loadProjectChapters(reader, ROOT, platform)).rejects.toBeInstanceOf(
      InputDomainError,
    );
  });

  it('a well-formed in-range stored zip from the same builder is read', async () => {
    const zip = storedZip('word/document.xml', encode(wordXml('<?xml version="1.0"?>')));
    const { reader } = memoryProject(ROOT, { '参考/ok.docx': fixture(zip) });
    expect(await readBreakdownSource(reader, ROOT, '参考/ok.docx', platform)).toBe('甲');
  });

  it('source larger than the per-file cap', async () => {
    const { reader } = memoryProject(ROOT, { '参考/a.txt': fixture(encode('第1章 a\n内容')) });
    const capped = {
      ...reader,
      readProjectBytes: async () => ({ bytes: new Uint8Array(), exceeded: true }),
    };
    await expect(loadProjectChapters(capped, ROOT, platform)).rejects.toBeInstanceOf(
      InputDomainError,
    );
  });

  it('report fields of the wrong type count as an unparseable report', async () => {
    const { reader } = memoryProject(ROOT, {
      '正文.txt': fixture(encode('第1章 a\n内容')),
      '.storyforge/analysis/book-breakdown.json': fixture(encode('{"status": 5}')),
    });
    await expect(readBookBreakdownStatus(reader, ROOT, platform)).rejects.toThrow(
      '已有拆书报告无法解析。',
    );
  });
});
