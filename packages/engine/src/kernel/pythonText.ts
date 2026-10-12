// Python str.strip/re \s include U+001C..001F but exclude U+FEFF.
export const PYTHON_WHITESPACE =
  '[\u0009-\u000d\u001c-\u0020\u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]';
const TRIM_WHITESPACE = new RegExp(`^${PYTHON_WHITESPACE}+|${PYTHON_WHITESPACE}+$`, 'gu');
export function pythonStrip(text: string): string {
  return text.replace(TRIM_WHITESPACE, '');
}
