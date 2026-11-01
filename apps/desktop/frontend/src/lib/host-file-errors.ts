/**
 * 界面读写作品文件时宿主报的错。宿主序列化成 `{ kind, message }`（Rust `host_error.rs`），
 * `lib/host/tauri-fs.ts` 按 kind 翻成下面这些类，message 一律是宿主原文。调用方按类判断，不匹配文字。
 */
export class HostFileError extends Error {
  // 这些命令以前直接以字符串 reject，调用方 String(error) 拿到的就是原文；翻成类以后保持这一点。
  override toString(): string {
    return this.message;
  }
}

/** 作品内还没有这个文件（`missing`）。 */
export class ProjectFileMissingError extends HostFileError {}

/** 路径越出当前作品（`outside-project`）。 */
export class ProjectPathOutsideError extends HostFileError {}

/**
 * 磁盘内容与写入基线不符，已拒绝覆盖（`drift`）。前端自己核出漂移拒写时也抛它：
 * 再点一次结果一样，界面据此不提示「可重试」。
 */
export class DiskDriftError extends HostFileError {}
