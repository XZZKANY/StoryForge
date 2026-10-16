// Isolated browser fixture: real Monaco and production hook, synthetic FS/HTTP only.
import { useEffect, useRef, useState } from 'react';
import ReactDOM from 'react-dom/client';
import * as monaco from 'monaco-editor';
import { useInlineChat } from '../../src/components/editor/useInlineChat.ts';
import { TauriFileSystem, invalidateFileSystemCache } from '../../src/lib/tauri-fs.ts';
import '../../src/index.css';
const A = 'D:/browser-fiction/A';
const B = 'D:/browser-fiction/B';
const SOURCE = A + '/设定/灯塔.md';
const PIN = A + '/素材/作者固定.md';
const text = '首段。\n中段。\n尾段保持不动。';
const disk = /* @__PURE__ */ new Map([
  [SOURCE, '旧资料：铜钥匙。'],
  [PIN, 'PIN_FINAL：灯塔全年开放。'],
]);
let releaseRead = null;
let holdRead = false;
let releaseResponse = null;
let heldResponse = false;
const requests = [];
const writes = [];
const signals = [];
window.__STORYFORGE_MOCK_FS__ = {
  listDir: (root) =>
    [...disk.keys()]
      .filter((path) => path.startsWith(root + '/'))
      .map((path) => ({
        path,
        name: path.split('/').at(-1),
        isDir: false,
        isFile: true,
        extension: 'md',
        modified: 0,
        size: 100,
      })),
  readFile: (path) => {
    const value = disk.get(path);
    if (value === void 0) throw new Error('fixture file missing');
    if (holdRead && path === SOURCE) {
      holdRead = false;
      return new Promise((resolve) => {
        releaseRead = () => resolve(value);
      });
    }
    return value;
  },
  writeFile: (path, content) => disk.set(path, content),
};
localStorage.clear();
localStorage.setItem('storyforge:project-knowledge:' + A, JSON.stringify(['素材/作者固定.md']));
const fetchOriginal = window.fetch.bind(window);
window.fetch = async (input, init) => {
  const url = new URL(String(input), location.href);
  if (url.pathname === '/api/assistant/continue') {
    if (url.origin !== 'http://inline-browser.invalid') throw new Error('unexpected API origin');
    requests.push(JSON.parse(String(init?.body)));
    signals.push(init.signal);
    const done = () =>
      new Response(
        'event: done\ndata: {"text":"新增浏览器段。","model":"fixture","assistant_session_id":71}\n\n',
        { headers: { 'Content-Type': 'text/event-stream' } },
      );
    if (heldResponse) {
      heldResponse = false;
      return new Promise((resolve) => {
        releaseResponse = () => resolve(done());
      });
    }
    return done();
  }
  if (url.origin !== location.origin) throw new Error('unexpected network request: ' + url.href);
  return fetchOriginal(input, init);
};
function Harness() {
  const host = useRef(null);
  const editorRef = useRef(null);
  const [ready, setReady] = useState(false);
  const [project, setProject] = useState(A);
  const file = project + '/正文/第02章.md';
  const projectRef = useRef(project);
  const fileRef = useRef(file);
  projectRef.current = project;
  fileRef.current = file;
  useEffect(() => {
    const editor = monaco.editor.create(host.current, {
      value: text,
      language: 'plaintext',
      automaticLayout: true,
      minimap: { enabled: false },
      fontSize: 18,
    });
    editorRef.current = editor;
    setReady(true);
    window.__INLINE_AUDIT__ = {
      requests,
      writes,
      unmount: () => appRoot.unmount(),
      get signals() {
        return signals.map((signal) => signal.aborted);
      },
      get project() {
        return projectRef.current;
      },
      get ready() {
        return editorRef.current != null;
      },
      focus: () => {
        editor.setPosition({ lineNumber: 2, column: 2 });
        editor.focus();
      },
      body: () => editor.getValue(),
      reset: () => {
        editor.setValue(text);
        editor.setPosition({ lineNumber: 2, column: 2 });
        invalidateFileSystemCache();
      },
      holdRead: () => {
        invalidateFileSystemCache();
        holdRead = true;
      },
      get readHeld() {
        return releaseRead != null;
      },
      releaseRead: () => {
        releaseRead?.('');
        releaseRead = null;
      },
      saveSource: () => TauriFileSystem.writeFile(A, SOURCE, '新资料：银钥匙。'),
      holdResponse: () => {
        heldResponse = true;
      },
      get responseHeld() {
        return releaseResponse != null;
      },
      releaseResponse: () => {
        releaseResponse?.();
        releaseResponse = null;
      },
      switchProject: () => {
        editor.setModel(monaco.editor.createModel(text));
        setProject(B);
      },
    };
    return () => {
      editorRef.current = null;
      editor.dispose();
    };
  }, []);
  useInlineChat({
    editorRef,
    editorReady: ready,
    filePath: file,
    filePathRef: fileRef,
    projectPathRef: projectRef,
    projectName: 'browser fixture',
    setSuggestionStatus: () => {},
    writeAcceptedSuggestion: async (...args) => {
      writes.push(args);
      return {};
    },
  });
  useEffect(() => {
    document.documentElement.dataset.inlineReady = String(ready);
  }, [ready]);
  return (
    <div>
      <h1>当前源码行间续写浏览器验收（隔离 fixture）</h1>
      <div ref={host} style={{ height: 580, width: 1e3 }} />
    </div>
  );
}
const appRoot = ReactDOM.createRoot(document.getElementById('root'));
appRoot.render(<Harness />);
