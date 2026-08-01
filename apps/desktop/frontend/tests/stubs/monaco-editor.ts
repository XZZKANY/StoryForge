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
}

class FakeEditor {
  private model: FakeModel | null = null;
  private listener: Listener | null = null;
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
    this.listener?.();
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
    this.listener = listener;
    return { dispose() {} };
  }

  addCommand() {}
  layout() {}
  dispose() {}

  updateOptions(options: Record<string, unknown>) {
    this.options = { ...this.options, ...options };
  }
}

let lastEditor: FakeEditor | null = null;
const models: FakeModel[] = [];

export const editor = {
  create() {
    lastEditor = new FakeEditor();
    return lastEditor;
  },
  createDiffEditor() {
    return {
      setModel() {},
      layout() {},
      dispose() {},
      // 面板挂载后会按字号/字体设置追平一次；缺这个方法会在 effect 里抛错，
      // 表现为 React root 被打坏、整组交互用例莫名其妙地 'Should not already be working'。
      updateOptions() {},
    };
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

export function __getModels() {
  return models;
}

export function __resetMonacoStub() {
  lastEditor = null;
  models.splice(0, models.length);
}
