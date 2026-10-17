type Listener = () => void;

class FakeModel {
  private value: string;
  private version = 1;
  disposed = false;

  constructor(value: string) {
    this.value = value;
  }

  getValue() {
    return this.value;
  }

  setValue(value: string) {
    this.value = value;
    this.version += 1;
  }

  getAlternativeVersionId() {
    return this.version;
  }

  dispose() {
    this.disposed = true;
  }
  isDisposed() {
    return this.disposed;
  }
}

class FakeEditor {
  private model: FakeModel | null = null;
  private listeners = new Set<Listener>();
  private viewState: unknown = { cursor: 1 };
  options: Record<string, unknown> = {};
  restoredViewState: unknown = null;

  getModel() {
    return this.model;
  }

  setModel(model: FakeModel | null) {
    this.model = model;
  }

  getValue() {
    return this.model?.getValue() ?? '';
  }

  setValue(value: string) {
    this.model?.setValue(value);
    for (const listener of this.listeners) listener();
  }

  saveViewState() {
    return this.viewState;
  }

  restoreViewState(state: unknown) {
    this.restoredViewState = state;
    this.viewState = state;
  }

  setTestViewState(state: unknown) {
    this.viewState = state;
  }

  onDidChangeModelContent(listener: Listener) {
    this.listeners.add(listener);
    return { dispose: () => this.listeners.delete(listener) };
  }

  addCommand() {}
  layout() {}
  dispose() {}

  // 接受改稿后编辑器停到哪一行：测试读这两个值。
  revealedLine: number | null = null;
  position: { lineNumber: number; column: number } | null = null;
  revealLineInCenter(line: number) {
    this.revealedLine = line;
  }
  setPosition(position: { lineNumber: number; column: number }) {
    this.position = position;
  }

  updateOptions(options: Record<string, unknown>) {
    this.options = { ...this.options, ...options };
  }
}

let lastEditor: FakeEditor | null = null;
let lastDiffEditor: ReturnType<typeof editor.createDiffEditor> | null = null;
const models: FakeModel[] = [];

export const editor = {
  create() {
    lastEditor = new FakeEditor();
    return lastEditor;
  },
  createDiffEditor() {
    const original = new FakeEditor();
    const modified = new FakeEditor();
    const diffListeners = new Set<() => void>();
    const diffEditor = {
      // 真 Monaco 的差异是异步算的：测试用 __fireDiffUpdate() 模拟「算完了」，
      // revealFirstDiffCalls 数面板在算完后停到第一处改动的次数。
      onDidUpdateDiff(listener: () => void) {
        diffListeners.add(listener);
        return { dispose: () => diffListeners.delete(listener) };
      },
      revealFirstDiff() {
        diffEditor.revealFirstDiffCalls += 1;
      },
      revealFirstDiffCalls: 0,
      __fireDiffUpdate() {
        for (const listener of [...diffListeners]) listener();
      },
      setModel() {},
      layout() {},
      dispose() {},
      // 面板挂载后会按字号/字体设置追平一次；缺这个方法会在 effect 里抛错，
      // 表现为 React root 被打坏、整组交互用例莫名其妙地 'Should not already be working'。
      updateOptions() {},
      getOriginalEditor() {
        return original;
      },
      getModifiedEditor() {
        return modified;
      },
      getLineChanges: () => [] as Array<{ originalStartLineNumber: number }> | null,
    };
    lastDiffEditor = diffEditor;
    return diffEditor;
  },
  createModel(value: string) {
    const model = new FakeModel(value);
    models.push(model);
    return model;
  },
  setModelLanguage() {},
};

export const KeyMod = { CtrlCmd: 1 };
export const KeyCode = { KeyS: 2 };

export function __getLastEditor() {
  return lastEditor;
}

export function __getLastDiffEditor() {
  return lastDiffEditor;
}

export function __getModels() {
  return models;
}

export function __resetMonacoStub() {
  lastEditor = null;
  models.splice(0, models.length);
}
