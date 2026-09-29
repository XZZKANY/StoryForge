// Isolated visual fixture: no project/provider/sidecar I/O.
import { useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  Button,
  IconButton,
  DialogSurface,
  FloatingSurface,
  Field,
  Input,
} from '../../src/components/ui';
import '../../src/index.css';
function Fixture() {
  const [light, setLight] = useState(false);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const [nested, setNested] = useState(false);
  const [menu, setMenu] = useState(false);
  const [error, setError] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const name = useRef<HTMLInputElement>(null);
  return (
    <main className="mx-auto max-w-3xl space-y-6 p-6">
      <h1 className="text-xl">基础交互 · 隔离验收</h1>
      <div className="flex flex-wrap gap-3">
        <Button
          onClick={() => {
            document.documentElement.dataset.theme = light ? 'dark' : 'light';
            setLight(!light);
          }}
        >
          切换主题
        </Button>
        <Button onClick={() => setBusy(!busy)}>切换加载</Button>
        <Button variant="primary" loading={busy}>
          保存草稿
        </Button>
        <Button variant="danger">删除草稿</Button>
        <IconButton label="查看说明" tooltip="不会访问真实项目" icon={<span>?</span>} />
        <Button disabled>不可用</Button>
      </div>
      <Field
        label="作品名"
        required
        description="帮助文本"
        error={error ? '请输入作品名' : undefined}
      >
        {(props) => <Input {...props} placeholder="作品名" />}
      </Field>
      <Button onClick={() => setError(!error)}>切换错误</Button>
      <Button variant="primary" onClick={() => setOpen(true)}>
        打开弹窗
      </Button>
      {open && (
        <div
          data-modal-backdrop
          className="fixed inset-0 flex items-center justify-center bg-black/50 p-4"
        >
          <DialogSurface
            aria-label="编辑草稿"
            onClose={() => setOpen(false)}
            initialFocusRef={name}
            className="w-full max-w-lg space-y-4 rounded-lg border border-border bg-panel p-5"
          >
            <h2>编辑草稿</h2>
            <Field label="草稿名" description="关闭子层不丢失内容">
              {(props) => <Input {...props} ref={name} defaultValue="未保存草稿" />}
            </Field>
            <div className="flex flex-wrap gap-2">
              <Button ref={trigger} onClick={() => setMenu(!menu)}>
                更多操作
              </Button>
              <Button onClick={() => setNested(true)}>嵌套确认</Button>
              <Button onClick={() => setOpen(false)}>关闭弹窗</Button>
            </div>
            {menu && (
              <FloatingSurface
                role="menu"
                aria-label="草稿操作"
                triggerRef={trigger}
                onDismiss={() => setMenu(false)}
                className="w-64 rounded-md border border-border bg-surface p-2 shadow-dropdown"
              >
                <button role="menuitem" className="block w-full p-2">
                  第一项
                </button>
                <button role="menuitem" disabled className="block w-full p-2">
                  禁用项
                </button>
                <button role="menuitem" className="block w-full p-2">
                  最后项
                </button>
              </FloatingSurface>
            )}
            {nested && (
              <div
                data-modal-backdrop
                className="fixed inset-0 flex items-center justify-center bg-black/50 p-4"
              >
                <DialogSurface
                  aria-label="确认操作"
                  onClose={() => setNested(false)}
                  className="space-y-4 rounded-lg border border-border bg-surface p-5"
                >
                  <h2>确认操作</h2>
                  <Button onClick={() => setNested(false)}>返回编辑</Button>
                </DialogSurface>
              </div>
            )}
          </DialogSurface>
        </div>
      )}
    </main>
  );
}
createRoot(document.getElementById('root')!).render(<Fixture />);
