import { describe, expect, it } from 'vitest';

import {
  resolveActiveCenterTab,
  resolveDisplayedEditorFile,
} from '../../src/components/app/editor-tabs-state';

// 修 #5：预览页签单槽 + focusFile 清空预览导致「至多三个 / 切走消失一个」。
// 引入 activePane 后，切到固定页签只改激活面、不清预览槽——预览页签保留、编辑器切到固定文件。
describe('#5 编辑器页签展示派生', () => {
  it('预览激活时展示预览文件', () => {
    expect(resolveDisplayedEditorFile('preview', 'C', 'B')).toBe('C');
  });

  it('切到固定页签展示当前文件、预览槽仍非空（预览页签不消失）', () => {
    // 关键回归：activePane='file' 时展示 currentFile(B)，previewFile(C) 未被清空。
    expect(resolveDisplayedEditorFile('file', 'C', 'B')).toBe('B');
  });

  it('只开预览（无固定文件）时回落到预览', () => {
    expect(resolveDisplayedEditorFile('file', 'P', null)).toBe('P');
    expect(resolveDisplayedEditorFile('preview', 'P', null)).toBe('P');
  });

  it('无任何文件时为 null', () => {
    expect(resolveDisplayedEditorFile('file', null, null)).toBeNull();
  });

  it('活动页签：展示的是预览文件则预览高亮，否则固定高亮', () => {
    expect(resolveActiveCenterTab('C', 'C')).toBe('preview');
    expect(resolveActiveCenterTab('B', 'C')).toBe('file');
    expect(resolveActiveCenterTab(null, 'C')).toBeNull();
  });
});
