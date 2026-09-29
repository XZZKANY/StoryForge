// Isolated visual fixture: no project files, providers, sidecar or network I/O.
import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Input, InputShell, Select, Textarea, type ControlSize } from '../../src/components/ui';
import '../../src/index.css';

function Fixture() {
  const [light, setLight] = useState(false);
  const [disabled, setDisabled] = useState(false);
  const [invalid, setInvalid] = useState(false);
  const [cleared, setCleared] = useState(0);
  return (
    <main className="mx-auto max-w-4xl space-y-6 p-8">
      <h1 className="text-xl">基础表单 · 隔离验收夹具</h1>
      <div className="flex gap-6">
        <button
          onClick={() => {
            document.documentElement.dataset.theme = light ? 'dark' : 'light';
            setLight(!light);
          }}
        >
          切换主题
        </button>
        <label>
          <input
            type="checkbox"
            checked={disabled}
            onChange={(e) => setDisabled(e.target.checked)}
          />
          禁用
        </label>
        <label>
          <input type="checkbox" checked={invalid} onChange={(e) => setInvalid(e.target.checked)} />
          错误
        </label>
      </div>
      {(['sm', 'md', 'lg'] satisfies ControlSize[]).map((controlSize) => (
        <section key={controlSize} className="space-y-3" aria-label={controlSize}>
          <h2>{controlSize}</h2>
          <div className="grid grid-cols-2 gap-4">
            <label>
              书名
              <Input
                aria-label={`${controlSize} 书名`}
                placeholder="请输入书名"
                controlSize={controlSize}
                disabled={disabled}
                invalid={invalid}
              />
            </label>
            <label>
              题材
              <Select
                aria-label={`${controlSize} 题材`}
                controlSize={controlSize}
                disabled={disabled}
                invalid={invalid}
              >
                <option>幻想</option>
                <option>悬疑</option>
              </Select>
            </label>
            <label>
              简介
              <Textarea
                aria-label={`${controlSize} 简介`}
                placeholder="请输入简介"
                controlSize={controlSize}
                disabled={disabled}
                invalid={invalid}
              />
            </label>
            <div>
              复合搜索
              <InputShell
                controlSize={controlSize}
                disabled={disabled}
                invalid={invalid}
                aria-label={`${controlSize} 搜索组合`}
              >
                <span aria-hidden="true">⌕</span>
                <Input aria-label={`${controlSize} 搜索`} placeholder="搜索作品" />
                <button
                  type="button"
                  aria-label={`${controlSize} 清除`}
                  onClick={() => setCleared(cleared + 1)}
                >
                  ×
                </button>
              </InputShell>
            </div>
          </div>
        </section>
      ))}
      <output>清除次数：{cleared}</output>
    </main>
  );
}
createRoot(document.getElementById('root')!).render(<Fixture />);
