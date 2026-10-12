/**
 * Python 的 repr(str)：默认单引号，串里有单引号且没有双引号时改用双引号；
 * 反斜杠、所用引号、\n \r \t 转义；Unicode 类别为 Other / Separator 的字符（ASCII 空格除外）按 \x / \u / \U 转义。
 */
export function pythonStrRepr(text: string): string {
  const quote = text.includes("'") && !text.includes('"') ? '"' : "'";
  let output = quote;
  for (const char of text) {
    const code = char.codePointAt(0)!;
    if (char === '\\') output += '\\\\';
    else if (char === quote) output += `\\${quote}`;
    else if (char === '\n') output += '\\n';
    else if (char === '\r') output += '\\r';
    else if (char === '\t') output += '\\t';
    else if (char !== ' ' && /[\p{C}\p{Z}]/u.test(char))
      output +=
        code < 0x100
          ? `\\x${code.toString(16).padStart(2, '0')}`
          : code < 0x10000
            ? `\\u${code.toString(16).padStart(4, '0')}`
            : `\\U${code.toString(16).padStart(8, '0')}`;
    else output += char;
  }
  return output + quote;
}
