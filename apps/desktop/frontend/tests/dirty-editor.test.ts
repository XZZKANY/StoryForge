import assert from 'node:assert/strict';
import { test } from 'vitest';

import {
  canCommitEditorSave,
  closeEditorFile,
  nextEditorFileAfterClose,
  openEditorFile,
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

test('dirty 状态按文件独立记录与清除', () => {
  let dirty = updateDirtyEditorFiles(new Set(), 'a.md', true);
  dirty = updateDirtyEditorFiles(dirty, 'b.md', true);
  assert.deepEqual([...dirty], ['a.md', 'b.md']);
  dirty = updateDirtyEditorFiles(dirty, 'a.md', false);
  assert.deepEqual([...dirty], ['b.md']);
});
