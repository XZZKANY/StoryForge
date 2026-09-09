import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, test, vi } from 'vitest';
import { useWorkspaceSidePanelLimit } from '../src/components/shell/useWorkspaceSidePanelLimit';
import { workspaceSidePanelLimit } from '../src/lib/workspace-layout';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
afterEach(() => vi.restoreAllMocks());

test('平衡态为正文和 Agent 留出空间，聚焦态释放右栏占用', () => {
  expect(workspaceSidePanelLimit(1024, 'balanced')).toBe(236);
  expect(workspaceSidePanelLimit(1400, 'balanced')).toBe(612);
  expect(workspaceSidePanelLimit(1920, 'balanced')).toBe(720);
  expect(workspaceSidePanelLimit(1024, 'editor')).toBe(556);
  expect(workspaceSidePanelLimit(1024, 'chat')).toBe(556);
  expect(workspaceSidePanelLimit(800, 'balanced')).toBe(200);
});

test('视口 resize 更新显示上限，非项目态不挤压欢迎页偏好', () => {
  let width = 1400;
  vi.spyOn(window, 'innerWidth', 'get').mockImplementation(() => width);
  function Harness({ projectOpen }: { projectOpen: boolean }) {
    const limit = useWorkspaceSidePanelLimit(projectOpen, 'balanced');
    return <output>{limit ?? 'unconstrained'}</output>;
  }
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  try {
    act(() => root.render(<Harness projectOpen />));
    expect(container.textContent).toBe('612');
    act(() => {
      width = 1024;
      window.dispatchEvent(new Event('resize'));
    });
    expect(container.textContent).toBe('236');
    act(() => root.render(<Harness projectOpen={false} />));
    expect(container.textContent).toBe('unconstrained');
    act(() => {
      width = 1920;
      window.dispatchEvent(new Event('resize'));
    });
    act(() => root.render(<Harness projectOpen />));
    expect(container.textContent).toBe('720');
  } finally {
    act(() => root.unmount());
    container.remove();
  }
});
