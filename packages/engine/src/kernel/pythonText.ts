// Python str.strip/re \s include U+001C..001F but exclude U+FEFF.
export const PYTHON_WHITESPACE =
  '[\u0009-\u000d\u001c-\u0020\u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]';
const TRIM_WHITESPACE = new RegExp(`^${PYTHON_WHITESPACE}+|${PYTHON_WHITESPACE}+$`, 'gu');
export function pythonStrip(text: string): string {
  return text.replace(TRIM_WHITESPACE, '');
}

// str.splitlines(): CRLF, LF, CR, VT, FF, FS, GS, RS, NEL, LS, PS; no trailing empty line.
const LINE_BREAK = new RegExp(
  '\r\n|[\n\r\u000b\u000c\u001c\u001d\u001e\u0085' + String.fromCharCode(0x2028, 0x2029) + ']',
);
export function pythonSplitlines(text: string): string[] {
  if (!text) return [];
  const lines = text.split(LINE_BREAK);
  if (LINE_BREAK.test(text.slice(-1))) lines.pop();
  return lines;
}
