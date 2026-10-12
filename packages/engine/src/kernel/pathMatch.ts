/** PurePath.parts semantics, deliberately not UI path containment/normalization. */
function parts(path: string, windows: boolean): { anchor: string; parts: string[] } {
  let drive = '',
    root = '',
    tail = path;
  if (windows) {
    tail = path.replace(/\//g, '\\');
    if (tail.startsWith('\\\\')) {
      const start = tail.slice(0, 8).toUpperCase() === '\\\\?\\UNC\\' ? 8 : 2;
      const first = tail.indexOf('\\', start);
      const second = first < 0 ? -1 : tail.indexOf('\\', first + 1);
      if (second < 0) {
        drive = tail;
        tail = '';
      } else {
        drive = tail.slice(0, second);
        root = '\\';
        tail = tail.slice(second + 1);
      }
    } else if (tail.startsWith('\\')) {
      root = '\\';
      tail = tail.slice(1);
    } else {
      // Windows ntpath.splitroot is native and tests UTF-16 units, unlike its Python fallback.
      if (tail[1] === ':') {
        drive = tail.slice(0, 2);
        tail = tail.slice(drive.length);
        if (tail.startsWith('\\')) {
          root = '\\';
          tail = tail.slice(1);
        }
      }
    }
    if (!root && drive.startsWith('\\') && !drive.endsWith('\\')) {
      const pieces = drive.split('\\');
      if ((pieces.length === 4 && !'?.'.includes(pieces[2])) || pieces.length === 6) root = '\\';
    }
  } else if (tail.startsWith('/')) {
    root = tail.startsWith('//') && !tail.startsWith('///') ? '//' : '/';
    tail = tail.slice(root.length);
  }
  const anchor = drive + root;
  const segments = tail.split(windows ? '\\' : '/').filter((part) => part !== '' && part !== '.');
  return { anchor, parts: anchor ? [anchor, ...segments] : segments };
}

type Token =
  | { kind: 'star' }
  | { kind: 'question' }
  | { kind: 'literal'; point: number }
  | { kind: 'class'; negated: boolean; ranges: readonly (readonly [number, number])[] };

function characterClass(pattern: readonly string[], from: number, end: number): Token {
  // fnmatch removes reversed ranges instead of treating them as a syntax error.
  // Literal '-' inside a chunk is distinct from the range separator between chunks.
  let chunks: string[][] = [pattern.slice(from, end)];
  if (chunks[0].includes('-')) {
    chunks = [];
    let start = from,
      search = from + (pattern[from] === '!' ? 2 : 1);
    while (true) {
      const hyphen = pattern.indexOf('-', search);
      if (hyphen < 0 || hyphen >= end) break;
      chunks.push(pattern.slice(start, hyphen));
      start = hyphen + 1;
      search = hyphen + 3;
    }
    const last = pattern.slice(start, end);
    if (last.length) chunks.push(last);
    else chunks[chunks.length - 1].push('-');
    for (let i = chunks.length - 1; i > 0; i--) {
      const left = chunks[i - 1],
        right = chunks[i];
      if (left[left.length - 1].codePointAt(0)! > right[0].codePointAt(0)!) {
        chunks[i - 1] = [...left.slice(0, -1), ...right.slice(1)];
        chunks.splice(i, 1);
      }
    }
  }
  const members: (number | null)[] = [];
  for (const [i, chunk] of chunks.entries()) {
    if (i) members.push(null);
    for (const char of chunk) members.push(char.codePointAt(0)!);
  }
  const negated = members[0] === 33;
  if (negated) members.shift();
  const ranges: [number, number][] = [];
  for (let i = 0; i < members.length; i++) {
    const point = members[i];
    if (point !== null && members[i + 1] === null && typeof members[i + 2] === 'number') {
      ranges.push([point, members[i + 2]!]);
      i += 2;
    } else ranges.push([point ?? 45, point ?? 45]);
  }
  return { kind: 'class', negated, ranges };
}

function tokens(pattern: string, separator: string): Token[] {
  const result: Token[] = [];
  for (const [segmentIndex, segment] of pattern.split(separator).entries()) {
    if (segmentIndex) result.push({ kind: 'literal', point: separator.codePointAt(0)! });
    // glob.translate('*') requires a nonempty segment; '**' is not recursive in Path.match.
    if (segment === '*') {
      result.push({ kind: 'question' }, { kind: 'star' });
      continue;
    }
    const characters = Array.from(segment);
    for (let i = 0; i < characters.length; i++) {
      const char = characters[i];
      if (char === '*') {
        if (result[result.length - 1]?.kind !== 'star') result.push({ kind: 'star' });
      } else if (char === '?') result.push({ kind: 'question' });
      else if (char === '[') {
        let end = i + 1;
        if (characters[end] === '!') end++;
        if (characters[end] === ']') end++;
        while (end < characters.length && characters[end] !== ']') end++;
        if (end === characters.length) result.push({ kind: 'literal', point: 91 });
        else {
          result.push(characterClass(characters, i + 1, end));
          i = end;
        }
      } else result.push({ kind: 'literal', point: char.codePointAt(0)! });
    }
  }
  return result;
}

function matchPart(path: string, pattern: string, windows: boolean): boolean {
  const separator = windows ? '\\' : '/';
  const compiled = tokens(pattern, separator);
  const points = Array.from(path, (char) => char.codePointAt(0)!);
  // Windows 不区分大小写：用宿主正则的 Unicode 大小写折叠（迁移计划 §4.3.1），不带 Python 的字符表。
  const flags = windows ? 'iu' : 'u';
  const code = (point: number) => `\\u{${point.toString(16)}}`;
  const matchers = compiled.map((token) =>
    token.kind === 'literal'
      ? new RegExp(`^${code(token.point)}$`, flags)
      : token.kind === 'class'
        ? new RegExp(
            `^[${token.negated ? '^' : ''}${token.ranges
              .map(([from, to]) => (from === to ? code(from) : `${code(from)}-${code(to)}`))
              .join('')}]$`,
            flags,
          )
        : null,
  );
  const accepts = (index: number, point: number) => {
    const token = compiled[index];
    if (token.kind === 'question') return point !== separator.codePointAt(0);
    if (token.kind === 'star') return false;
    return matchers[index]!.test(String.fromCodePoint(point));
  };
  let position = 0,
    index = 0,
    star = -1,
    retry = 0;
  // Single-width tokens and non-recursive stars permit bounded, non-exponential backtracking.
  while (position < points.length) {
    const token = compiled[index];
    if (token?.kind === 'star') {
      star = index++;
      retry = position;
    } else if (token && accepts(index, points[position])) {
      position++;
      index++;
    } else if (star >= 0 && retry < points.length && points[retry] !== separator.codePointAt(0)) {
      position = ++retry;
      index = star + 1;
    } else return false;
  }
  while (compiled[index]?.kind === 'star') index++;
  return index === compiled.length;
}

/** Python Path.match(glob), including right-relative matching and platform-specific anchors.
 * Lexical only: never resolves '..', trims names, reads files, or expands recursive globs.
 */
export function matchPythonPath(
  path: string,
  pattern: string,
  platform: 'windows' | 'posix',
): boolean {
  const windows = platform === 'windows';
  const actual = parts(path, windows).parts;
  const expected = parts(pattern, windows);
  if (!expected.parts.length) throw new RangeError('empty pattern');
  if (
    actual.length < expected.parts.length ||
    (actual.length > expected.parts.length && expected.anchor)
  )
    return false;
  for (let i = 1; i <= expected.parts.length; i++) {
    if (!matchPart(actual[actual.length - i], expected.parts[expected.parts.length - i], windows))
      return false;
  }
  return true;
}
