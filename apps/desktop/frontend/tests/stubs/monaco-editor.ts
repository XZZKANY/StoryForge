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
