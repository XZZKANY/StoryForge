/**
 * StoryForge 桌面 IDE 主入口
 */

import * as monaco from 'monaco-editor';
import { TauriFileSystem } from './tauri-fs';
import { open } from '@tauri-apps/plugin-dialog';

// 全局状态
let editor: monaco.editor.IStandaloneCodeEditor;
let currentFilePath: string | null = null;
let currentProjectPath: string | null = null;
let isDirty = false;
let unwatchFile: (() => void) | null = null;

// DOM 元素
const loading = document.getElementById('loading')!;
const btnOpen = document.getElementById('btn-open')!;
const btnSave = document.getElementById('btn-save')!;
const btnNew = document.getElementById('btn-new')!;
const currentFileEl = document.getElementById('current-file')!;
const fileTree = document.getElementById('file-tree')!;
const statusText = document.getElementById('status-text')!;
const statusPos = document.getElementById('status-pos')!;

/**
 * 初始化 Monaco Editor
 */
function initEditor() {
  editor = monaco.editor.create(document.getElementById('editor')!, {
    value: '# 欢迎使用 StoryForge IDE\n\n点击"打开项目"开始编辑...',
    language: 'markdown',
    theme: 'vs-dark',
    fontSize: 14,
    lineNumbers: 'on',
    minimap: { enabled: true },
    wordWrap: 'on',
    automaticLayout: true,
  });

  // 监听内容变化
  editor.onDidChangeModelContent(() => {
    if (currentFilePath) {
      isDirty = true;
      updateSaveButton();
      statusText.textContent = '已修改';
    }
  });

  // 监听光标位置
  editor.onDidChangeCursorPosition((e) => {
    statusPos.textContent = `Ln ${e.position.lineNumber}, Col ${e.position.column}`;
  });

  // 注册保存快捷键
  editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
    if (currentFilePath && isDirty) {
      saveFile();
    }
  });
}

/**
 * 打开项目
 */
async function openProject() {
  try {
    const selected = await open({
      directory: true,
      multiple: false,
      title: '选择项目目录',
    });

    if (!selected || typeof selected !== 'string') return;

    currentProjectPath = selected;
    statusText.textContent = `加载项目: ${selected}`;

    // 列出文件
    await loadFileTree(selected);

    // 监听文件变化
    if (unwatchFile) unwatchFile();
    unwatchFile = await TauriFileSystem.watchFile(selected, (event) => {
      console.log('文件变化:', event);
      // 重新加载文件树
      if (currentProjectPath) {
        loadFileTree(currentProjectPath);
      }
    });

    statusText.textContent = `项目已加载: ${selected}`;
  } catch (error) {
    console.error('打开项目失败:', error);
    alert(`打开项目失败: ${error}`);
  }
}

/**
 * 加载文件树
 */
async function loadFileTree(path: string) {
  try {
    const entries = await TauriFileSystem.listDir(path, true);

    // 只显示 Markdown 文件
    const markdownFiles = entries
      .filter((e) => !e.isDir && (e.extension === 'md' || e.extension === 'markdown'))
      .sort((a, b) => a.path.localeCompare(b.path));

    if (markdownFiles.length === 0) {
      fileTree.innerHTML = '<div style="padding: 20px; text-align: center; color: #6c6c6c;">此目录下没有 Markdown 文件</div>';
      return;
    }

    fileTree.innerHTML = '';
    markdownFiles.forEach((file) => {
      const item = document.createElement('div');
      item.className = 'file-item';
      item.textContent = file.name;
      item.title = file.path;
      item.onclick = () => openFile(file.path);
      fileTree.appendChild(item);
    });
  } catch (error) {
    console.error('加载文件树失败:', error);
    fileTree.innerHTML = `<div style="padding: 20px; color: #f48771;">加载失败: ${error}</div>`;
  }
}

/**
 * 打开文件
 */
async function openFile(path: string) {
  try {
    // 检查未保存的修改
    if (isDirty && currentFilePath) {
      const confirmed = confirm('当前文件有未保存的修改，是否继续？');
      if (!confirmed) return;
    }

    statusText.textContent = `加载文件: ${path}`;

    const content = await TauriFileSystem.readFile(path);
    editor.setValue(content);

    currentFilePath = path;
    isDirty = false;
    updateSaveButton();

    // 高亮当前文件
    document.querySelectorAll('.file-item').forEach((el) => {
      el.classList.toggle('active', el.title === path);
    });

    // 提取文件名
    const fileName = path.split(/[/\\]/).pop() || path;
    currentFileEl.textContent = fileName;

    statusText.textContent = `文件已打开: ${fileName}`;
  } catch (error) {
    console.error('打开文件失败:', error);
    alert(`打开文件失败: ${error}`);
  }
}

/**
 * 保存文件
 */
async function saveFile() {
  if (!currentFilePath) return;

  try {
    statusText.textContent = '保存中...';
    const content = editor.getValue();
    await TauriFileSystem.writeFile(currentFilePath, content);

    isDirty = false;
    updateSaveButton();
    statusText.textContent = '已保存';

    setTimeout(() => {
      statusText.textContent = '就绪';
    }, 2000);
  } catch (error) {
    console.error('保存文件失败:', error);
    alert(`保存文件失败: ${error}`);
    statusText.textContent = '保存失败';
  }
}

/**
 * 新建文件
 */
async function newFile() {
  if (!currentProjectPath) {
    alert('请先打开项目');
    return;
  }

  const fileName = prompt('输入文件名（带 .md 扩展名）：', 'untitled.md');
  if (!fileName) return;

  if (!fileName.endsWith('.md')) {
    alert('文件名必须以 .md 结尾');
    return;
  }

  try {
    const filePath = `${currentProjectPath}/${fileName}`;
    const exists = await TauriFileSystem.pathExists(filePath);

    if (exists) {
      alert('文件已存在');
      return;
    }

    await TauriFileSystem.writeFile(filePath, '# 新建文件\n\n');
    await loadFileTree(currentProjectPath);
    await openFile(filePath);

    statusText.textContent = `已创建: ${fileName}`;
  } catch (error) {
    console.error('创建文件失败:', error);
    alert(`创建文件失败: ${error}`);
  }
}

/**
 * 更新保存按钮状态
 */
function updateSaveButton() {
  const btn = btnSave as HTMLButtonElement;
  btn.disabled = !currentFilePath || !isDirty;
  btn.textContent = isDirty ? '保存 (Ctrl+S) *' : '保存 (Ctrl+S)';
}

/**
 * 初始化应用
 */
async function init() {
  try {
    // 初始化编辑器
    initEditor();

    // 绑定事件
    btnOpen.onclick = openProject;
    btnSave.onclick = saveFile;
    btnNew.onclick = newFile;

    // 隐藏加载遮罩
    loading.classList.add('hidden');

    console.log('StoryForge IDE 初始化完成');
  } catch (error) {
    console.error('初始化失败:', error);
    alert(`初始化失败: ${error}`);
  }
}

// 启动应用
init();
