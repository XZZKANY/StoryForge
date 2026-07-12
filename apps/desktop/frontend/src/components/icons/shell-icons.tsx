/**
 * 壳子图标统一走 Lucide 矢量库（原型定调 stroke 1.5–1.75，取代旧的 Unicode/字形图标，
 * 免 Win11 彩色 emoji 化毁暗色质感）。P1 起各栏从此处按名引用，集中一处便于风格收敛。
 *
 * 命名对照原型（StoryForge壳子原型-整端.html）：
 *   活动栏：故事=FileText / 搜索=Search / 会话=Sparkles(agent 紫) / 质检=Flag / 命令=Command / 设置=Settings
 *   顶栏：命令面板触发=Search / 窗控=Minus·Square·X
 *   中栏页签：版本=Clock / 面板=PanelRight
 *   右栏 composer：发送=ArrowUp / 挂载上下文=Plus
 *   树/会话：ChevronRight·ChevronDown / Folder·FolderOpen·File / 新建文件=FilePlus / 新建会话=MessageSquarePlus / 分支=GitBranch
 *   观测/补丁：勾选=Check
 */
import type { LucideIcon, LucideProps } from 'lucide-react';
import {
  ArrowUp,
  Check,
  ChevronDown,
  ChevronRight,
  Clock,
  Command,
  File,
  FilePlus,
  FileText,
  Flag,
  Folder,
  FolderOpen,
  GitBranch,
  Maximize2,
  MessageSquarePlus,
  Minus,
  PanelRight,
  PanelRightClose,
  Plus,
  Search,
  Settings,
  Sparkles,
  Square,
  X,
} from 'lucide-react';

export type { LucideIcon, LucideProps };

/** 统一默认：细一档描边贴合单色克制风格；调用处可覆盖 size / strokeWidth / className。 */
export const SHELL_ICON_DEFAULTS = {
  size: 16,
  strokeWidth: 1.6,
} as const satisfies Partial<LucideProps>;

export {
  ArrowUp,
  Check,
  ChevronDown,
  ChevronRight,
  Clock,
  Command,
  File,
  FilePlus,
  FileText,
  Flag,
  Folder,
  FolderOpen,
  GitBranch,
  Maximize2,
  MessageSquarePlus,
  Minus,
  PanelRight,
  PanelRightClose,
  Plus,
  Search,
  Settings,
  Sparkles,
  Square,
  X,
};
