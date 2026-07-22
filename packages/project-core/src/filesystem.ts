export interface FileEntry {
  name: string;
  path: string;
  isDir: boolean;
  size: number;
  modified: number;
  extension?: string;
}

export interface ProjectFileSystem {
  readFile(path: string): Promise<string>;
  readProjectFile(projectRoot: string, path: string): Promise<string>;
  writeFile(projectRoot: string, path: string, content: string): Promise<void>;
  listDir(path: string, recursive?: boolean): Promise<FileEntry[]>;
  createDir(projectRoot: string, path: string, recursive?: boolean): Promise<void>;
  pathExists(path: string): Promise<boolean>;
}
