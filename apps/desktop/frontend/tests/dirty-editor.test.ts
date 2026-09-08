import assert from 'node:assert/strict';
import { test } from 'vitest';

import {
  canCommitEditorSave,
  canAcknowledgeEditorSave,
  isSameEditorSaveTarget,
  closeEditorFile,
  nextEditorFileAfterClose,
  openEditorFile,
  reorderEditorFiles,
  updateDirtyEditorFiles,
  isRetainedEditorModel,
} from '../src/components/app/editor-tabs-state';

test('异步保存完成后只提交到启动保存时的同一路径和 Monaco model', () => {
  const savedModel = { id: 'a' };
  const replacementModel = { id: 'b' };

  assert.equal(canCommitEditorSave('a.md', savedModel, 'a.md', savedModel), true);
  assert.equal(canCommitEditorSave('a.md', savedModel, 'b.md', replacementModel), false);
  assert.equal(canCommitEditorSave('a.md', savedModel, 'a.md', replacementModel), false);
});

test('标签关闭并移除缓存 model 后，在途保存不能重新提交 dirty 状态', () => {
  const savedModel = { id: 'a' };
  assert.equal(isRetainedEditorModel(savedModel, savedModel), true);
  assert.equal(isRetainedEditorModel(savedModel, null), false);
  assert.equal(isRetainedEditorModel(savedModel, { id: 'replacement' }), false);
});

test('打开文件保持稳定顺序且不会重复标签', () => {
  const first = openEditorFile([], 'a.md');
  assert.deepEqual(openEditorFile(first, 'b.md'), ['a.md', 'b.md']);
  assert.equal(openEditorFile(first, 'a.md'), first);
});

test('关闭标签选择右侧优先、否则左侧相邻标签', () => {
  const files = ['a.md', 'b.md', 'c.md'];
  assert.equal(nextEditorFileAfterClose(files, 'b.md'), 'c.md');
  assert.equal(nextEditorFileAfterClose(files, 'c.md'), 'b.md');
  assert.deepEqual(closeEditorFile(files, 'b.md'), ['a.md', 'c.md']);
});

test('页签拖拽重排：把 from 搬到 to 的位置，越界/同位/未打开原样返回', () => {
  const files = ['a.md', 'b.md', 'c.md'];
  // c 拖到 a 前
  assert.deepEqual(reorderEditorFiles(files, 'c.md', 'a.md'), ['c.md', 'a.md', 'b.md']);
  // a 拖到 c 处（后移）
  assert.deepEqual(reorderEditorFiles(files, 'a.md', 'c.md'), ['b.md', 'c.md', 'a.md']);
  // 同位不动、原数组引用返回
  assert.equal(reorderEditorFiles(files, 'b.md', 'b.md'), files);
  // 未打开的路径不动
  assert.equal(reorderEditorFiles(files, 'x.md', 'a.md'), files);
});

test('dirty 状态按文件独立记录与清除', () => {
  let dirty = updateDirtyEditorFiles(new Set(), 'a.md', true);
  dirty = updateDirtyEditorFiles(dirty, 'b.md', true);
  assert.deepEqual([...dirty], ['a.md', 'b.md']);
  dirty = updateDirtyEditorFiles(dirty, 'a.md', false);
  assert.deepEqual([...dirty], ['b.md']);
});

test('写入旧内容不能确认后来输入已保存', () => {
  const target = { projectPath: 'D:/book', filePath: 'a.md', model: {} };
  const receipt = { target, content: '旧输入' };
  assert.equal(canAcknowledgeEditorSave(receipt, target, target, '旧输入'), true);
  assert.equal(canAcknowledgeEditorSave(receipt, target, target, '旧输入+新输入'), false);
});
test('保存目标的项目、文件、model 必须均一致', () => {
  const target = { projectPath: 'D:/book', filePath: 'a.md', model: {} };
  const receipt = { target, content: '相同正文' };
  for (const changed of [
    { ...target, projectPath: 'D:/other' },
    { ...target, filePath: 'b.md' },
    { ...target, model: {} },
    null,
  ]) {
    assert.equal(isSameEditorSaveTarget(target, changed), false);
    assert.equal(canAcknowledgeEditorSave(receipt, target, changed, '相同正文'), false);
  }
});
test('提前返回或写入其他目标不能产生成功保存应答', () => {
  const target = { projectPath: 'D:/book', filePath: 'a.md', model: {} };
  assert.equal(canAcknowledgeEditorSave(undefined, target, target, '正文'), false);
  assert.equal(
    canAcknowledgeEditorSave(
      {
        target: { ...target, filePath: 'b.md' },
        content: '正文',
      },
      target,
      target,
      '正文',
    ),
    false,
  );
});
