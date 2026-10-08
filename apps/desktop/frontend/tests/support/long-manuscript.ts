export function longManuscript(size: number, shape: 'paragraphs' | 'blank-dialogue' | 'one-line') {
  const unit =
    shape === 'one-line'
      ? '夜雨落在旧窗台上，木门没有关紧。她把纸条压在茶杯下面，仍旧等着那个人。'
      : shape === 'blank-dialogue'
        ? '\n\n“再等一会儿。”\n\n“再等一会儿。”\n'
        : '夜雨落在旧窗台上，木门没有关紧。她把纸条压在茶杯下面，仍旧等着那个人。\n\n“再等一会儿。”\n门外没有回答，钟声从街尾慢慢传来。\n\n';
  return unit.repeat(Math.ceil(size / unit.length)).slice(0, size);
}
