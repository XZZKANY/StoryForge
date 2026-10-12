import { InputDomainError } from './json';
import { pythonStrip } from './pythonText';

/**
 * DOCX 正文读取：zip 判定贴近 CPython zipfile，XML 只认 well-formed 文档。
 * Python 读不出（坏 zip、缺正文、CRC 不符、XML 不合法）时跳过该文件，这里抛 DocxReadError 让调用方同样跳过；
 * Python 会直接崩溃或 Word 不会产出的形态（加密、zip64、bzip2/lzma、DOCTYPE、非 UTF-8）抛 InputDomainError。
 */
export class DocxReadError extends Error {
  constructor(readonly stage: 'zip' | 'xml') {
    super(stage === 'zip' ? 'DOCX 无法读取' : 'DOCX 正文无法解析');
    this.name = 'DocxReadError';
  }
}

const W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const XML_NS = 'http://www.w3.org/XML/1998/namespace';

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

export function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

type ZipEntry = {
  name: string;
  origName: string;
  flags: number;
  method: number;
  crc: number;
  compressSize: number;
  fileSize: number;
  headerOffset: number;
  endOffset: number | null;
};

const UTF8 = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });

function decodeName(bytes: Uint8Array, utf8: boolean, source: string): string {
  if (!utf8) return String.fromCharCode(...bytes); // cp437 与 latin-1 在 ASCII 段相同，只用于比对名字
  try {
    return UTF8.decode(bytes);
  } catch {
    throw new InputDomainError(`${source}：zip 内的文件名不是合法的 UTF-8`);
  }
}

/** ZipInfo 的文件名清洗：截到第一个 NUL；Windows 上把反斜杠当路径分隔符。 */
function sanitizeName(name: string, platform: 'windows' | 'posix'): string {
  const nul = name.indexOf('\0');
  const cut = nul >= 0 ? name.slice(0, nul) : name;
  return platform === 'windows' ? cut.replace(/\\/g, '/') : cut;
}

function readEntries(bytes: Uint8Array, source: string, platform: 'windows' | 'posix') {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const u32 = (offset: number) => view.getUint32(offset, true);
  const unreadable = () => new DocxReadError('zip');
  const size = bytes.length;
  if (size < 22) throw unreadable();
  let location = -1;
  if (u32(size - 22) === 0x06054b50 && bytes[size - 2] === 0 && bytes[size - 1] === 0)
    location = size - 22;
  else {
    const floor = Math.max(size - 0xffff - 22, 0);
    for (let p = size - 4; p >= floor; p--)
      if (u32(p) === 0x06054b50) {
        if (p + 22 > size) throw unreadable();
        location = p;
        break;
      }
  }
  if (location < 0) throw unreadable();
  if (location >= 20 && u32(location - 20) === 0x07064b50)
    throw new InputDomainError(`${source}：zip64 格式不在拆书输入范围内`);
  const sizeCd = u32(location + 12);
  const offsetCd = u32(location + 16);
  const concat = location - sizeCd - offsetCd;
  const startDir = offsetCd + concat;
  if (startDir < 0) throw unreadable();
  const directory = bytes.subarray(startDir, startDir + sizeCd);
  const dir = new DataView(directory.buffer, directory.byteOffset, directory.byteLength);
  const entries: ZipEntry[] = [];
  const byName = new Map<string, ZipEntry>();
  let total = 0;
  while (total < sizeCd) {
    if (total + 46 > directory.length || dir.getUint32(total, true) !== 0x02014b50)
      throw unreadable();
    const flags = dir.getUint16(total + 8, true);
    const nameLength = dir.getUint16(total + 28, true);
    const extraLength = dir.getUint16(total + 30, true);
    const commentLength = dir.getUint16(total + 32, true);
    if (directory[total + 6] > 63) throw new InputDomainError(`${source}：zip 版本过新`);
    const nameStart = total + 46;
    const rawName = directory.subarray(nameStart, nameStart + nameLength);
    const origName = decodeName(rawName, (flags & 0x800) !== 0, source);
    const entry: ZipEntry = {
      name: sanitizeName(origName, platform),
      origName,
      flags,
      method: dir.getUint16(total + 10, true),
      crc: dir.getUint32(total + 16, true),
      compressSize: dir.getUint32(total + 20, true),
      fileSize: dir.getUint32(total + 24, true),
      headerOffset: dir.getUint32(total + 42, true),
      endOffset: null,
    };
    let extra = directory.subarray(nameStart + nameLength, nameStart + nameLength + extraLength);
    while (extra.length >= 4) {
      const type = extra[0] | (extra[1] << 8);
      const length = extra[2] | (extra[3] << 8);
      if (length + 4 > extra.length) throw unreadable();
      const data = extra.subarray(4, length + 4);
      if (
        type === 0x0001 &&
        [entry.fileSize, entry.compressSize, entry.headerOffset].includes(0xffffffff)
      )
        throw new InputDomainError(`${source}：zip64 格式不在拆书输入范围内`);
      if (type === 0x7075) {
        // Info-ZIP Unicode Path：版本 1 且 CRC 对得上原始名字节时，用其中的 UTF-8 名字。
        if (data.length < 5) throw unreadable();
        const version = data[0];
        const nameCrc = (data[1] | (data[2] << 8) | (data[3] << 16) | (data[4] << 24)) >>> 0;
        if (version === 1 && nameCrc === crc32(rawName)) {
          let unicode: string;
          try {
            unicode = UTF8.decode(data.subarray(5));
          } catch {
            throw unreadable();
          }
          if (unicode) entry.name = sanitizeName(unicode, platform);
        }
      }
      extra = extra.subarray(length + 4);
    }
    entry.headerOffset += concat;
    entries.push(entry);
    byName.set(entry.name, entry);
    total += 46 + nameLength + extraLength + commentLength;
  }
  let endOffset = startDir;
  const order = entries
    .map((_, index) => index)
    .sort((a, b) => entries[a].headerOffset - entries[b].headerOffset || a - b)
    .reverse();
  for (const index of order) {
    entries[index].endOffset = endOffset;
    endOffset = entries[index].headerOffset;
  }
  return { byName, view };
}

async function inflate(data: Uint8Array): Promise<Uint8Array> {
  // Python 的 zlib 在流截断时交出已解出的部分、忽略流后垃圾；这里同样保留出错前已解出的字节，交给 CRC 判定。
  // slice()：TS 5.9 的 BlobPart 只收 ArrayBuffer 背书的视图（前端用 5.9 编译引擎源码）。
  const stream = new Blob([data.slice()])
    .stream()
    .pipeThrough(new DecompressionStream('deflate-raw'));
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
    }
  } catch {
    // 交给 CRC 判定
  }
  const output = new Uint8Array(chunks.reduce((sum, chunk) => sum + chunk.length, 0));
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.length;
  }
  return output;
}

/** ZipFile(path).read(member)。 */
export async function readZipMember(
  bytes: Uint8Array,
  member: string,
  source: string,
  platform: 'windows' | 'posix',
): Promise<Uint8Array> {
  const { byName, view } = readEntries(bytes, source, platform);
  const entry = byName.get(member);
  if (entry === undefined) throw new DocxReadError('zip');
  const header = entry.headerOffset;
  if (header < 0 || header + 30 > bytes.length || view.getUint32(header, true) !== 0x04034b50)
    throw new DocxReadError('zip');
  const nameLength = view.getUint16(header + 26, true);
  const extraLength = view.getUint16(header + 28, true);
  if (entry.flags & 0x60)
    throw new InputDomainError(`${source}：zip 补丁或强加密不在拆书输入范围内`);
  const localName = decodeName(
    bytes.subarray(header + 30, header + 30 + nameLength),
    (view.getUint16(header + 6, true) & 0x800) !== 0,
    source,
  );
  if (localName !== entry.origName) throw new DocxReadError('zip');
  const dataStart = header + 30 + nameLength + extraLength;
  if (
    entry.endOffset !== null &&
    dataStart + entry.compressSize > entry.endOffset &&
    entry.endOffset !== header
  )
    throw new DocxReadError('zip');
  if (entry.flags & 0x1) throw new InputDomainError(`${source}：加密的 DOCX 不在拆书输入范围内`);
  if (entry.method !== 0 && entry.method !== 8)
    throw new InputDomainError(`${source}：zip 压缩方式 ${entry.method} 不在拆书输入范围内`);
  if (dataStart + entry.compressSize > bytes.length)
    throw new InputDomainError(`${source}：zip 数据被截断`);
  const compressed = bytes.subarray(dataStart, dataStart + entry.compressSize);
  const raw = entry.method === 0 ? compressed : await inflate(compressed);
  const content = raw.subarray(0, entry.fileSize);
  if (crc32(content) !== entry.crc) throw new DocxReadError('zip');
  return content;
}

const NAME_START =
  'A-Z_a-z\\u00C0-\\u00D6\\u00D8-\\u00F6\\u00F8-\\u02FF\\u0370-\\u037D\\u037F-\\u1FFF\\u200C\\u200D' +
  '\\u2070-\\u218F\\u2C00-\\u2FEF\\u3001-\\uD7FF\\uF900-\\uFDCF\\uFDF0-\\uFFFD\\u{10000}-\\u{EFFFF}';
const NAME_CHAR = `${NAME_START}\\-.0-9\\u00B7\\u0300-\\u036F\\u203F\\u2040`;
const NAME_PATTERN = `[${NAME_START}:][${NAME_CHAR}:]*`;
// eslint-disable-next-line no-misleading-character-class -- XML 1.0 的 NameChar 本就含组合附加符与 ZWNJ/ZWJ 区间
const NAME = new RegExp(NAME_PATTERN, 'uy');
const SPACE = /[ \t\n]*/y;
const XML_CHARS = /^[\t\n\r\u0020-\uD7FF\uE000-\uFFFD\u{10000}-\u{10FFFF}]*$/u;
// eslint-disable-next-line no-misleading-character-class -- 同上
const REFERENCE = new RegExp(`&(?:(${NAME_PATTERN})|#([0-9]+)|#x([0-9a-fA-F]+));`, 'uy');
const PREDEFINED: Record<string, string> = { lt: '<', gt: '>', amp: '&', apos: "'", quot: '"' };

class XmlSyntaxError extends Error {}

function decodeReferences(raw: string): string {
  let output = '';
  let index = 0;
  for (;;) {
    const amp = raw.indexOf('&', index);
    if (amp < 0) return output + raw.slice(index);
    output += raw.slice(index, amp);
    REFERENCE.lastIndex = amp;
    const match = REFERENCE.exec(raw);
    if (!match) throw new XmlSyntaxError('bad reference');
    if (match[1] !== undefined) {
      if (!Object.prototype.hasOwnProperty.call(PREDEFINED, match[1]))
        throw new XmlSyntaxError('undefined entity');
      output += PREDEFINED[match[1]];
    } else {
      const code = match[2] !== undefined ? Number(match[2]) : parseInt(match[3], 16);
      if (code > 0x10ffff) throw new XmlSyntaxError('bad char ref');
      const char = String.fromCodePoint(code);
      if (!XML_CHARS.test(char)) throw new XmlSyntaxError('bad char ref');
      output += char;
    }
    index = REFERENCE.lastIndex;
  }
}

type Frame = {
  rawName: string;
  scope: Map<string, string>;
  isT: boolean;
  paragraph: number | null;
  text: string;
  textOpen: boolean;
};

/** ElementTree 的 root.iter(w:p) → 每段 = 段内（含嵌套）所有 w:t 的 .text 拼接；返回去空白后的非空段。 */
function wordParagraphs(text: string, source: string): string[] {
  if (!XML_CHARS.test(text)) throw new XmlSyntaxError('invalid character');
  const doc = text.replace(/\r\n?/g, '\n');
  const accumulators: string[] = [];
  const stack: Frame[] = [];
  let index = doc.charCodeAt(0) === 0xfeff ? 1 : 0;
  let rootClosed = false;

  const name = (): string => {
    NAME.lastIndex = index;
    const match = NAME.exec(doc);
    if (!match) throw new XmlSyntaxError('bad name');
    index = NAME.lastIndex;
    return match[0];
  };
  const space = (): boolean => {
    SPACE.lastIndex = index;
    SPACE.exec(doc);
    const moved = SPACE.lastIndex > index;
    index = SPACE.lastIndex;
    return moved;
  };
  const split = (qname: string): [string | null, string] => {
    const colon = qname.indexOf(':');
    if (colon < 0) return [null, qname];
    const prefix = qname.slice(0, colon);
    const local = qname.slice(colon + 1);
    if (!prefix || !local || local.includes(':')) throw new XmlSyntaxError('bad qname');
    return [prefix, local];
  };
  const complete = (frame: Frame) => {
    frame.textOpen = false;
    if (!frame.isT || !frame.text) return;
    for (const open of stack)
      if (open !== frame && open.paragraph !== null) accumulators[open.paragraph] += frame.text;
  };
  const attributeValue = (): string => {
    const quote = doc[index];
    if (quote !== '"' && quote !== "'") throw new XmlSyntaxError('unquoted attribute');
    const end = doc.indexOf(quote, index + 1);
    if (end < 0) throw new XmlSyntaxError('unterminated attribute');
    const raw = doc.slice(index + 1, end);
    if (raw.includes('<')) throw new XmlSyntaxError('< in attribute');
    index = end + 1;
    return decodeReferences(raw.replace(/[\t\n]/g, ' '));
  };

  if (doc.startsWith('<?xml', index) && /[ \t\n?]/.test(doc[index + 5] ?? '')) {
    const end = doc.indexOf('?>', index);
    if (end < 0) throw new XmlSyntaxError('unterminated declaration');
    const declaration = doc.slice(index + 5, end);
    const version = /^[ \t\n]+version[ \t\n]*=[ \t\n]*(["'])1\.[0-9]+\1/.exec(declaration);
    if (!version) throw new XmlSyntaxError('bad declaration');
    const encoding = /[ \t\n]encoding[ \t\n]*=[ \t\n]*(["'])([A-Za-z][A-Za-z0-9._-]*)\1/.exec(
      declaration,
    );
    if (encoding && encoding[2].toLowerCase() !== 'utf-8')
      throw new InputDomainError(`${source}：XML 声明的编码 ${encoding[2]} 不在拆书输入范围内`);
    index = end + 2;
  }

  while (index < doc.length) {
    if (doc[index] !== '<') {
      const end = doc.indexOf('<', index);
      const raw = doc.slice(index, end < 0 ? doc.length : end);
      index = end < 0 ? doc.length : end;
      if (!stack.length) {
        if (!/^[ \t\n]*$/.test(raw)) throw new XmlSyntaxError('text outside root');
        continue;
      }
      if (raw.includes(']]>')) throw new XmlSyntaxError(']]> in text');
      const top = stack[stack.length - 1];
      const value = decodeReferences(raw);
      if (top.isT && top.textOpen) top.text += value;
      continue;
    }
    if (doc.startsWith('<!--', index)) {
      const end = doc.indexOf('-->', index + 4);
      if (end < 0) throw new XmlSyntaxError('unterminated comment');
      const body = doc.slice(index + 4, end);
      if (body.includes('--') || body.endsWith('-')) throw new XmlSyntaxError('-- in comment');
      index = end + 3;
      continue;
    }
    if (doc.startsWith('<![CDATA[', index)) {
      if (!stack.length) throw new XmlSyntaxError('CDATA outside root');
      const end = doc.indexOf(']]>', index + 9);
      if (end < 0) throw new XmlSyntaxError('unterminated CDATA');
      const top = stack[stack.length - 1];
      if (top.isT && top.textOpen) top.text += doc.slice(index + 9, end);
      index = end + 3;
      continue;
    }
    if (doc.startsWith('<!DOCTYPE', index))
      throw new InputDomainError(`${source}：带 DOCTYPE 的正文 XML 不在拆书输入范围内`);
    if (doc.startsWith('<!', index)) throw new XmlSyntaxError('bad markup');
    if (doc.startsWith('<?', index)) {
      index += 2;
      const target = name();
      if (target.toLowerCase() === 'xml') throw new XmlSyntaxError('misplaced declaration');
      if (!doc.startsWith('?>', index) && !space()) throw new XmlSyntaxError('bad PI');
      const end = doc.indexOf('?>', index);
      if (end < 0) throw new XmlSyntaxError('unterminated PI');
      index = end + 2;
      continue;
    }
    if (doc.startsWith('</', index)) {
      index += 2;
      const closing = name();
      space();
      if (doc[index] !== '>') throw new XmlSyntaxError('bad end tag');
      index += 1;
      const frame = stack.pop();
      if (!frame || frame.rawName !== closing) throw new XmlSyntaxError('mismatched tag');
      if (frame.textOpen) complete(frame);
      if (!stack.length) rootClosed = true;
      continue;
    }
    if (rootClosed) throw new XmlSyntaxError('junk after document element');
    index += 1;
    const rawName = name();
    const attributes: [string, string][] = [];
    for (;;) {
      const spaced = space();
      if (doc.startsWith('/>', index) || doc[index] === '>') break;
      if (!spaced) throw new XmlSyntaxError('attributes need whitespace');
      const attribute = name();
      space();
      if (doc[index] !== '=') throw new XmlSyntaxError('missing =');
      index += 1;
      space();
      if (attributes.some(([existing]) => existing === attribute))
        throw new XmlSyntaxError('duplicate attribute');
      attributes.push([attribute, attributeValue()]);
    }
    const selfClosing = doc[index] === '/';
    index += selfClosing ? 2 : 1;

    const parent = stack[stack.length - 1];
    let scope = parent ? parent.scope : new Map<string, string>([['xml', XML_NS]]);
    for (const [attribute, value] of attributes) {
      if (attribute === 'xmlns') {
        if (scope === parent?.scope || !parent) scope = new Map(scope);
        scope.set('', value);
      } else if (attribute.startsWith('xmlns:')) {
        const prefix = attribute.slice(6);
        if (!prefix || prefix.includes(':') || !value || prefix === 'xmlns')
          throw new XmlSyntaxError('bad namespace declaration');
        if ((prefix === 'xml') !== (value === XML_NS)) throw new XmlSyntaxError('reserved prefix');
        if (scope === parent?.scope || !parent) scope = new Map(scope);
        scope.set(prefix, value);
      }
    }
    const expanded = new Set<string>();
    for (const [attribute] of attributes) {
      if (attribute === 'xmlns' || attribute.startsWith('xmlns:')) continue;
      const [prefix, local] = split(attribute);
      const uri = prefix === null ? '' : scope.get(prefix);
      if (uri === undefined) throw new XmlSyntaxError('unbound prefix');
      const key = `${uri}}${local}`;
      if (expanded.has(key)) throw new XmlSyntaxError('duplicate attribute');
      expanded.add(key);
    }
    const [prefix, local] = split(rawName);
    const uri = prefix === null ? (scope.get('') ?? '') : scope.get(prefix);
    if (uri === undefined) throw new XmlSyntaxError('unbound prefix');

    if (parent?.textOpen) complete(parent);
    const isWord = uri === W_NS;
    const frame: Frame = {
      rawName,
      scope,
      isT: isWord && local === 't',
      paragraph: isWord && local === 'p' ? accumulators.push('') - 1 : null,
      text: '',
      textOpen: true,
    };
    stack.push(frame);
    if (selfClosing) {
      stack.pop();
      if (!stack.length) rootClosed = true;
    }
  }
  if (!rootClosed || stack.length) throw new XmlSyntaxError('no complete root element');
  return accumulators.map(pythonStrip).filter(Boolean);
}

/** _read_docx：word/document.xml 里的段落文本，按段换行拼接。 */
export async function readDocxText(
  bytes: Uint8Array,
  source: string,
  platform: 'windows' | 'posix',
): Promise<string> {
  const xml = await readZipMember(bytes, 'word/document.xml', source, platform);
  if ((xml[0] === 0xfe && xml[1] === 0xff) || (xml[0] === 0xff && xml[1] === 0xfe))
    throw new InputDomainError(`${source}：UTF-16 正文 XML 不在拆书输入范围内`);
  let text: string;
  try {
    text = UTF8.decode(xml);
  } catch {
    throw new DocxReadError('xml');
  }
  try {
    return wordParagraphs(text, source).join('\n');
  } catch (error) {
    if (error instanceof XmlSyntaxError) throw new DocxReadError('xml');
    throw error;
  }
}
