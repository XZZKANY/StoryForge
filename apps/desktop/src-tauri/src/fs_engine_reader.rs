// Uncached, bounded raw reads for the deterministic engine. UI list_dir keeps
// its own filtering contract; visibility and completeness belong to the kernel.
use super::ensure_canonical_path_inside_project;
use base64::Engine;
use serde::Serialize;
use std::fs;
use std::io::{self, Read};
use std::path::{Component, Path, PathBuf};

const MAX_ENTRIES: usize = 20_000;
const MAX_BYTES: usize = 2 * 1024 * 1024;
const MAX_SAFE_INTEGER: u64 = 9_007_199_254_740_991;

// Preserve containment failures across IPC; callers must not parse localized messages.
#[derive(Debug, Serialize)]
pub struct EngineReadError {
    kind: &'static str,
    message: String,
}

impl EngineReadError {
    fn outside(message: impl Into<String>) -> Self {
        Self {
            kind: "outside-project",
            message: message.into(),
        }
    }
}

impl From<String> for EngineReadError {
    fn from(message: String) -> Self {
        Self {
            kind: "io",
            message,
        }
    }
}

impl From<&str> for EngineReadError {
    fn from(message: &str) -> Self {
        message.to_string().into()
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ResolvedProjectPath {
    pub relative_path: String,
    pub resolved_relative_path: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectPathMetadata {
    pub entry_kind: &'static str,
    pub target_kind: &'static str,
    pub is_reparse_point: bool,
    pub size_bytes: u64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RawProjectDirectory {
    pub names: Vec<String>,
    pub exceeded: bool,
    pub terminal_error: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RawProjectBytes {
    pub base64: String,
    pub bytes_read: usize,
    pub exceeded: bool,
}

fn relative_string(path: &Path) -> Result<String, String> {
    if path.as_os_str().is_empty() {
        return Ok(".".into());
    }
    path.components()
        .map(|component| {
            component
                .as_os_str()
                .to_str()
                .ok_or("项目路径无法无损转换为 UTF-8")
        })
        .collect::<Result<Vec<_>, _>>()
        .map(|parts| parts.join("/"))
        .map_err(str::to_string)
}

// Unlike the writeback helper, do not use exists(): it turns permission failures
// into missing paths. This read contract supports normal missing suffixes only.
fn resolve_missing_suffix(path: &Path) -> Result<PathBuf, String> {
    let mut cursor = path;
    let mut suffix = Vec::new();
    let mut resolved = loop {
        match fs::canonicalize(cursor) {
            Ok(resolved) => break resolved,
            Err(error) if error.kind() == io::ErrorKind::NotFound => {
                // A dangling alias is not an ordinary missing leaf. Its target
                // needs a separately proven Python-compatible resolution path.
                match fs::symlink_metadata(cursor) {
                    Err(info_error) if info_error.kind() == io::ErrorKind::NotFound => {}
                    Err(info_error) => return Err(format!("无法检查项目路径: {info_error}")),
                    Ok(_) => return Err(format!("无法解析项目路径: {error}")),
                }
                suffix.push(
                    cursor
                        .file_name()
                        .ok_or("项目路径没有文件名")?
                        .to_os_string(),
                );
                cursor = cursor.parent().ok_or("项目路径没有父目录")?;
            }
            Err(error) => return Err(format!("无法解析项目路径: {error}")),
        }
    };
    for component in suffix.into_iter().rev() {
        resolved.push(component);
    }
    Ok(resolved)
}

fn reader_paths(
    project_root: &str,
    path: &str,
) -> Result<(PathBuf, PathBuf, PathBuf), EngineReadError> {
    if !Path::new(project_root).is_absolute() {
        return Err("项目读取根路径必须为绝对路径".into());
    }
    // Reads follow Python's non-strict root resolution. Missing/file roots fail at
    // directory IO, not resolution; keep the existing strict writer helper unchanged.
    let root = resolve_missing_suffix(Path::new(project_root))?;
    let supplied = Path::new(path);
    let relative = if supplied.is_absolute() {
        supplied
            .strip_prefix(Path::new(project_root))
            .or_else(|_| supplied.strip_prefix(&root))
            .map_err(|_| EngineReadError::outside("项目读取路径不在当前项目内"))?
    } else {
        supplied
    };
    let mut original = root.clone();
    for component in relative.components() {
        match component {
            Component::Normal(name) => original.push(name),
            Component::CurDir => {}
            Component::ParentDir => {
                if !original.pop() {
                    return Err(EngineReadError::outside("项目读取路径越过文件系统根"));
                }
            }
            _ => return Err("项目读取路径包含非规范片段".into()),
        }
    }
    let resolved = resolve_missing_suffix(&original)?;
    ensure_canonical_path_inside_project(&root, &resolved, &original, true)
        .map_err(EngineReadError::outside)?;
    Ok((root, original, resolved))
}

#[tauri::command]
pub fn resolve_engine_project_path(
    project_root: String,
    path: String,
) -> Result<ResolvedProjectPath, EngineReadError> {
    let (root, original, resolved) = reader_paths(&project_root, &path)?;
    Ok(ResolvedProjectPath {
        relative_path: relative_string(original.strip_prefix(&root).map_err(|_| "项目路径越界")?)?,
        resolved_relative_path: relative_string(
            resolved.strip_prefix(&root).map_err(|_| "项目目标越界")?,
        )?,
    })
}

fn optional_metadata(path: &Path, nofollow: bool) -> Result<Option<fs::Metadata>, String> {
    let result = if nofollow {
        fs::symlink_metadata(path)
    } else {
        fs::metadata(path)
    };
    match result {
        Ok(info) => Ok(Some(info)),
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(format!("无法读取项目元数据: {error}")),
    }
}

fn metadata_kind(info: Option<&fs::Metadata>) -> &'static str {
    match info {
        None => "missing",
        Some(info) if info.file_type().is_symlink() => "symlink",
        Some(info) if info.is_dir() => "directory",
        Some(info) if info.is_file() => "file",
        Some(_) => "other",
    }
}

fn is_reparse(info: &fs::Metadata) -> bool {
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        info.file_attributes() & 0x400 != 0
    }
    #[cfg(not(windows))]
    {
        info.file_type().is_symlink()
    }
}

#[tauri::command]
pub fn inspect_engine_project_path(
    project_root: String,
    path: String,
) -> Result<ProjectPathMetadata, EngineReadError> {
    let (_, original, resolved) = reader_paths(&project_root, &path)?;
    let entry = optional_metadata(&original, true)?;
    let target = optional_metadata(&resolved, false)?;
    let size_bytes = target.as_ref().map_or(0, fs::Metadata::len);
    if size_bytes > MAX_SAFE_INTEGER {
        return Err("项目文件大小超过 JavaScript 安全整数范围".into());
    }
    Ok(ProjectPathMetadata {
        entry_kind: metadata_kind(entry.as_ref()),
        target_kind: metadata_kind(target.as_ref()),
        is_reparse_point: entry.as_ref().is_some_and(is_reparse),
        size_bytes,
    })
}

fn collect_names(
    entries: impl Iterator<Item = io::Result<String>>,
    remaining: usize,
) -> RawProjectDirectory {
    let mut names = Vec::new();
    for entry in entries {
        match entry {
            Ok(name) => {
                names.push(name);
                if names.len() > remaining {
                    return RawProjectDirectory {
                        names,
                        exceeded: true,
                        terminal_error: None,
                    };
                }
            }
            Err(error) => {
                return RawProjectDirectory {
                    names,
                    exceeded: false,
                    terminal_error: Some(format!("无法完整读取项目目录: {error}")),
                }
            }
        }
    }
    RawProjectDirectory {
        names,
        exceeded: false,
        terminal_error: None,
    }
}

#[tauri::command]
pub fn read_engine_project_directory(
    project_root: String,
    path: String,
    remaining_entries: usize,
) -> Result<RawProjectDirectory, EngineReadError> {
    if remaining_entries > MAX_ENTRIES {
        return Err("项目目录读取预算无效".into());
    }
    let (_, _, resolved) = reader_paths(&project_root, &path)?;
    let entries = fs::read_dir(resolved).map_err(|error| format!("无法打开项目目录: {error}"))?;
    Ok(collect_names(
        entries.map(|entry| {
            entry?.file_name().into_string().map_err(|_| {
                io::Error::new(io::ErrorKind::InvalidData, "项目文件名无法无损转换为 UTF-8")
            })
        }),
        remaining_entries,
    ))
}

fn capped_bytes(reader: impl Read, max_bytes: usize) -> io::Result<Vec<u8>> {
    let mut bytes = Vec::with_capacity((max_bytes + 1).min(8192));
    reader
        .take((max_bytes + 1) as u64)
        .read_to_end(&mut bytes)?;
    Ok(bytes)
}

#[tauri::command]
pub fn read_engine_project_bytes(
    project_root: String,
    path: String,
    max_bytes: usize,
) -> Result<RawProjectBytes, EngineReadError> {
    if max_bytes > MAX_BYTES {
        return Err("项目文件读取预算无效".into());
    }
    let (root, original, resolved) = reader_paths(&project_root, &path)?;
    ensure_canonical_path_inside_project(&root, &resolved, &original, false)?;
    if !fs::metadata(&resolved)
        .map_err(|error| format!("无法检查项目文件: {error}"))?
        .is_file()
    {
        return Err("路径不是项目普通文件".into());
    }
    let file = fs::File::open(&resolved).map_err(|error| format!("无法打开项目文件: {error}"))?;
    if !file
        .metadata()
        .map_err(|error| format!("无法检查项目文件: {error}"))?
        .is_file()
    {
        return Err("路径不是项目普通文件".into());
    }
    let bytes =
        capped_bytes(file, max_bytes).map_err(|error| format!("无法读取项目文件: {error}"))?;
    Ok(RawProjectBytes {
        bytes_read: bytes.len(),
        exceeded: bytes.len() > max_bytes,
        base64: base64::engine::general_purpose::STANDARD.encode(bytes),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::Cell;

    fn root(temp: &tempfile::TempDir) -> String {
        temp.path().to_str().unwrap().to_string()
    }

    #[test]
    fn resolves_root_and_normal_missing_suffix_without_creating_paths() {
        let temp = tempfile::tempdir().unwrap();
        let result = resolve_engine_project_path(root(&temp), ".".into()).unwrap();
        assert_eq!(result.relative_path, ".");
        assert_eq!(result.resolved_relative_path, ".");
        for name in ["next.md", "new/nested/next.md"] {
            let result = resolve_engine_project_path(root(&temp), name.into()).unwrap();
            assert_eq!(result.relative_path, name);
            assert_eq!(result.resolved_relative_path, name);
            let info = inspect_engine_project_path(root(&temp), name.into()).unwrap();
            assert_eq!(info.entry_kind, "missing");
            assert_eq!(info.target_kind, "missing");
            assert!(!info.is_reparse_point);
        }
        assert_eq!(fs::read_dir(temp.path()).unwrap().count(), 0);
        let absolute = temp.path().join("absolute.md");
        assert_eq!(
            resolve_engine_project_path(root(&temp), absolute.to_str().unwrap().into())
                .unwrap()
                .relative_path,
            "absolute.md"
        );
    }

    #[test]
    fn missing_and_file_roots_resolve_but_cannot_be_enumerated() {
        let temp = tempfile::tempdir().unwrap();
        fs::write(temp.path().join("file.md"), b"synthetic").unwrap();
        for name in ["missing", "file.md"] {
            let project = temp.path().join(name).to_str().unwrap().to_string();
            let resolved = resolve_engine_project_path(project.clone(), ".".into()).unwrap();
            assert_eq!(resolved.relative_path, ".");
            assert_eq!(resolved.resolved_relative_path, ".");
            let failure = read_engine_project_directory(project, ".".into(), 20).unwrap_err();
            assert_eq!(failure.kind, "io");
        }
        assert!(!temp.path().join("missing").exists());
        assert_eq!(fs::read_dir(temp.path()).unwrap().count(), 1);
    }

    #[test]
    fn typed_outside_error_and_contained_parent_resolution_are_distinct() {
        let temp = tempfile::tempdir().unwrap();
        fs::create_dir(temp.path().join("sub")).unwrap();
        let failure = resolve_engine_project_path(root(&temp), "..".into()).unwrap_err();
        assert_eq!(failure.kind, "outside-project");
        assert_eq!(
            serde_json::to_value(&failure).unwrap()["kind"],
            "outside-project"
        );
        let inside = resolve_engine_project_path(root(&temp), "sub/..".into()).unwrap();
        assert_eq!(inside.relative_path, ".");
        assert_eq!(inside.resolved_relative_path, ".");
        assert!(resolve_engine_project_path("relative-root".into(), ".".into()).is_err());
    }

    #[test]
    fn rejects_outside_paths_and_invalid_budgets() {
        let temp = tempfile::tempdir().unwrap();
        let outside = tempfile::tempdir().unwrap();
        for name in [outside.path().to_str().unwrap(), "../outside.md"] {
            assert!(resolve_engine_project_path(root(&temp), name.into()).is_err());
        }
        assert!(read_engine_project_directory(root(&temp), ".".into(), MAX_ENTRIES + 1).is_err());
        assert!(read_engine_project_bytes(root(&temp), "file.md".into(), MAX_BYTES + 1).is_err());
        assert!(read_engine_project_bytes(root(&temp), ".".into(), 10).is_err());
        assert_eq!(fs::read_dir(temp.path()).unwrap().count(), 0);
    }

    #[test]
    fn raw_directory_retains_hidden_heavy_and_direct_names_without_stat() {
        let temp = tempfile::tempdir().unwrap();
        for name in [".git", "node_modules", ".storyforge", "正文"] {
            fs::create_dir(temp.path().join(name)).unwrap();
        }
        fs::write(temp.path().join("正文").join("chapter.md"), b"nested").unwrap();
        let complete = read_engine_project_directory(root(&temp), ".".into(), 4).unwrap();
        assert!(!complete.exceeded);
        assert!(complete.terminal_error.is_none());
        let mut names = complete.names;
        names.sort();
        assert_eq!(names, [".git", ".storyforge", "node_modules", "正文"]);
        for cap in [0, 1, 3] {
            let partial = read_engine_project_directory(root(&temp), ".".into(), cap).unwrap();
            assert_eq!(partial.names.len(), cap + 1);
            assert!(partial.exceeded);
            assert!(partial.terminal_error.is_none());
        }
    }

    #[test]
    fn collector_preserves_prefix_errors_and_stops_at_successful_sentinel() {
        let calls = Cell::new(0);
        let items = [
            Ok("first".into()),
            Ok("sentinel".into()),
            Err(io::Error::other("late failure")),
        ];
        let result = collect_names(items.into_iter().inspect(|_| calls.set(calls.get() + 1)), 1);
        assert_eq!(calls.get(), 2);
        assert!(result.exceeded);
        assert!(result.terminal_error.is_none());
        let result = collect_names(
            [
                Ok("first".into()),
                Err(io::Error::other("terminal failure")),
            ]
            .into_iter(),
            1,
        );
        assert_eq!(result.names, ["first"]);
        assert!(!result.exceeded);
        assert!(result.terminal_error.unwrap().contains("terminal failure"));
        let empty = collect_names(std::iter::empty(), 0);
        assert!(empty.names.is_empty());
        assert!(!empty.exceeded);
        let failed = collect_names(
            [Err(io::Error::other("open iteration failure"))].into_iter(),
            0,
        );
        assert!(failed.names.is_empty());
        assert!(!failed.exceeded);
        assert!(failed.terminal_error.is_some());
    }

    #[test]
    fn actual_bytes_include_at_most_one_probe_byte_and_never_decode() {
        let temp = tempfile::tempdir().unwrap();
        let bytes = [0xff, 0x00, 0xef, 0xbb, 0xbf, 0x0d, 0x0a];
        fs::write(temp.path().join("chapter.md"), bytes).unwrap();
        let info = inspect_engine_project_path(root(&temp), "chapter.md".into()).unwrap();
        assert_eq!(info.entry_kind, "file");
        assert_eq!(info.target_kind, "file");
        assert_eq!(info.size_bytes, bytes.len() as u64);
        for cap in [0, 1, 6, 7, 8] {
            let result = read_engine_project_bytes(root(&temp), "chapter.md".into(), cap).unwrap();
            assert_eq!(result.bytes_read, bytes.len().min(cap + 1));
            assert_eq!(result.exceeded, bytes.len() > cap);
            let decoded = base64::engine::general_purpose::STANDARD
                .decode(result.base64)
                .unwrap();
            assert_eq!(decoded, bytes[..bytes.len().min(cap + 1)]);
        }
        assert_eq!(fs::read(temp.path().join("chapter.md")).unwrap(), bytes);
    }

    #[test]
    fn capped_read_limits_actual_consumption_even_with_short_reads() {
        struct CountedReader<'a> {
            count: &'a Cell<usize>,
            max_request: &'a Cell<usize>,
        }
        impl Read for CountedReader<'_> {
            fn read(&mut self, buffer: &mut [u8]) -> io::Result<usize> {
                self.max_request
                    .set(self.max_request.get().max(buffer.len()));
                let n = buffer.len().min(2);
                buffer[..n].fill(0xff);
                self.count.set(self.count.get() + n);
                Ok(n)
            }
        }
        for cap in [0, 1, 7, 8193] {
            let count = Cell::new(0);
            let max_request = Cell::new(0);
            let bytes = capped_bytes(
                CountedReader {
                    count: &count,
                    max_request: &max_request,
                },
                cap,
            )
            .unwrap();
            assert_eq!(count.get(), cap + 1);
            assert_eq!(bytes.len(), cap + 1);
            assert!(max_request.get() <= cap + 1);
        }
    }

    #[test]
    fn full_read_cap_is_enforced_on_an_oversized_real_file() {
        let temp = tempfile::tempdir().unwrap();
        let bytes = vec![0xff; MAX_BYTES + 4096];
        fs::write(temp.path().join("large.md"), &bytes).unwrap();
        for cap in [16 * 1024, 512 * 1024, MAX_BYTES] {
            let result = read_engine_project_bytes(root(&temp), "large.md".into(), cap).unwrap();
            assert_eq!(result.bytes_read, cap + 1);
            assert!(result.exceeded);
            assert_eq!(
                base64::engine::general_purpose::STANDARD
                    .decode(result.base64)
                    .unwrap()
                    .len(),
                cap + 1
            );
        }
        assert_eq!(
            fs::metadata(temp.path().join("large.md")).unwrap().len(),
            bytes.len() as u64
        );
    }

    #[cfg(windows)]
    #[test]
    fn junctions_keep_original_identity_and_containment_uses_canonical_components() {
        use std::process::Command;
        let temp = tempfile::tempdir().unwrap();
        let outside = tempfile::tempdir().unwrap();
        fs::create_dir(temp.path().join("正文")).unwrap();
        fs::write(temp.path().join("正文").join("chapter.md"), b"hi").unwrap();
        for (name, target) in [
            ("alias", temp.path().join("正文")),
            ("escape", outside.path().to_path_buf()),
        ] {
            let link = temp.path().join(name);
            let status = Command::new("cmd")
                .args(["/c", "mklink", "/J"])
                .arg(&link)
                .arg(&target)
                .creation_flags(0x08000000)
                .output()
                .unwrap();
            assert!(
                status.status.success(),
                "junction fixture must succeed: {:?}",
                status.stderr
            );
        }
        let alias = resolve_engine_project_path(root(&temp), "alias/chapter.md".into()).unwrap();
        assert_eq!(alias.relative_path, "alias/chapter.md");
        assert_eq!(alias.resolved_relative_path, "正文/chapter.md");
        let info = inspect_engine_project_path(root(&temp), "alias".into()).unwrap();
        assert!(info.is_reparse_point);
        assert_eq!(info.target_kind, "directory");
        assert_eq!(
            read_engine_project_directory(root(&temp), "alias".into(), 2)
                .unwrap()
                .names,
            ["chapter.md"]
        );
        assert!(resolve_engine_project_path(root(&temp), "escape/missing/next.md".into()).is_err());
        let verbatim = fs::canonicalize(temp.path()).unwrap();
        let result = resolve_engine_project_path(
            verbatim.to_str().unwrap().into(),
            verbatim
                .join("正文")
                .join("chapter.md")
                .to_str()
                .unwrap()
                .into(),
        )
        .unwrap();
        assert_eq!(result.relative_path, "正文/chapter.md");
        assert_eq!(fs::read_dir(outside.path()).unwrap().count(), 0);
    }

    #[cfg(windows)]
    use std::os::windows::process::CommandExt;

    #[cfg(windows)]
    #[test]
    fn contained_file_alias_preserves_both_roles_and_external_alias_rejects() {
        use std::os::windows::fs::symlink_file;
        let temp = tempfile::tempdir().unwrap();
        let outside = tempfile::tempdir().unwrap();
        fs::write(temp.path().join("target.md"), b"inside").unwrap();
        fs::write(outside.path().join("target.md"), b"outside").unwrap();
        if let Err(error) =
            symlink_file(temp.path().join("target.md"), temp.path().join("alias.md"))
        {
            if error.raw_os_error() == Some(1314) {
                eprintln!(
                    "SKIP: file symlink requires privilege (1314); junction test is independent"
                );
                return;
            }
            panic!("file alias fixture failed: {error}");
        }
        symlink_file(
            outside.path().join("target.md"),
            temp.path().join("escape.md"),
        )
        .unwrap();
        let result = resolve_engine_project_path(root(&temp), "alias.md".into()).unwrap();
        assert_eq!(result.relative_path, "alias.md");
        assert_eq!(result.resolved_relative_path, "target.md");
        let info = inspect_engine_project_path(root(&temp), "alias.md".into()).unwrap();
        assert_eq!(info.entry_kind, "symlink");
        assert_eq!(info.target_kind, "file");
        assert!(info.is_reparse_point);
        assert!(read_engine_project_bytes(root(&temp), "escape.md".into(), 10).is_err());
        assert_eq!(
            fs::read(outside.path().join("target.md")).unwrap(),
            b"outside"
        );
    }
}
