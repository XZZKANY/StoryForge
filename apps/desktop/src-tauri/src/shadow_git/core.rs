use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::{HashMap, HashSet};
use std::ffi::{OsStr, OsString};
use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::{Component, Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

const PROJECT_SCHEMA_VERSION: u32 = 1;
const MAX_UNTRACKED_FILE_BYTES: u64 = 2 * 1024 * 1024;
const GC_INTERVAL: Duration = Duration::from_secs(60 * 60);
const BASE_EXCLUDES: [&str; 5] = [
    "/.git/",
    "node_modules/",
    ".pnpm-store/",
    "/.storyforge/canon/derived/",
    ".*.tmp-*",
];

#[derive(Default)]
pub(crate) struct SharedState {
    locks: Mutex<HashMap<String, Arc<Mutex<()>>>>,
    last_gc: Mutex<HashMap<String, Instant>>,
}

impl SharedState {
    fn lock_for(&self, key: &str) -> Result<Arc<Mutex<()>>, String> {
        let mut locks = self
            .locks
            .lock()
            .map_err(|_| "影子 Git 锁状态已损坏".to_string())?;
        Ok(Arc::clone(
            locks
                .entry(key.to_string())
                .or_insert_with(|| Arc::new(Mutex::new(()))),
        ))
    }

    fn gc_is_due(&self, key: &str) -> Result<bool, String> {
        let mut last_gc = self
            .last_gc
            .lock()
            .map_err(|_| "影子 Git GC 状态已损坏".to_string())?;
        let now = Instant::now();
        let Some(previous) = last_gc.get(key) else {
            last_gc.insert(key.to_string(), now);
            return Ok(false);
        };
        if now.duration_since(*previous) < GC_INTERVAL {
            return Ok(false);
        }
        last_gc.insert(key.to_string(), now);
        Ok(true)
    }
}

#[derive(Debug, Clone)]
pub(crate) struct CoreSnapshot {
    pub(crate) tree_hash: String,
    pub(crate) git_version: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct CoreFileState {
    pub(crate) exists: bool,
    pub(crate) content: String,
}

#[derive(Clone)]
pub(crate) struct ShadowGitCore {
    git_executable: PathBuf,
    data_root: PathBuf,
    expected_version: Option<String>,
    shared: Arc<SharedState>,
}

#[derive(Debug, Clone)]
struct ShadowRepository {
    project_root: PathBuf,
    project_key: String,
    bucket: PathBuf,
    git_dir: PathBuf,
    marker_path: PathBuf,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ProjectMarker {
    schema_version: u32,
    canonical_project_root: String,
}

#[derive(Debug)]
struct GitOutput {
    code: i32,
    stdout: Vec<u8>,
    stderr: String,
}

impl ShadowGitCore {
    pub(crate) fn new(
        git_executable: PathBuf,
        data_root: PathBuf,
        expected_version: Option<String>,
        shared: Arc<SharedState>,
    ) -> Self {
        Self {
            git_executable,
            data_root,
            expected_version,
            shared,
        }
    }

    pub(crate) fn git_executable(&self) -> &Path {
        &self.git_executable
    }

    pub(crate) fn git_version(&self) -> Result<String, String> {
        if !self.git_executable.is_file() {
            return Err(format!(
                "内置 Git 运行时缺失: {}",
                self.git_executable.display()
            ));
        }
        let environment = self.data_root.join("shadow-git").join("runtime-env");
        let output = self.run_git(
            &environment,
            None,
            &[OsString::from("--version")],
            None,
            &[],
        )?;
        let output = self.require_success(output, "读取内置 Git 版本")?;
        let version = utf8_stdout(&output, "内置 Git 版本")?.trim().to_string();
        if let Some(expected) = &self.expected_version {
            let expected = format!("git version {expected}");
            if version != expected {
                return Err(format!(
                    "内置 Git 版本不匹配: 期望 {expected}，实际 {version}"
                ));
            }
        }
        Ok(version)
    }

    pub(crate) fn repository_path(&self, project_root: &str) -> Result<PathBuf, String> {
        Ok(self.repository_for(project_root)?.git_dir)
    }

    fn repository_for(&self, project_root: &str) -> Result<ShadowRepository, String> {
        let canonical = fs::canonicalize(project_root)
            .map_err(|error| format!("无法解析项目目录 {project_root}: {error}"))?;
        if !canonical.is_dir() {
            return Err(format!("项目根不是目录: {project_root}"));
        }
        let project_key = canonical_project_key(&canonical)?;
        let hash = sha256_hex(project_key.as_bytes());
        let bucket = self.data_root.join("shadow-git").join(hash);
        Ok(ShadowRepository {
            project_root: canonical,
            project_key,
            git_dir: bucket.join("repo"),
            marker_path: bucket.join("project.json"),
            bucket,
        })
    }

    fn verify_marker(&self, repo: &ShadowRepository) -> Result<bool, String> {
        if !repo.marker_path.exists() {
            return Ok(false);
        }
        let raw = fs::read_to_string(&repo.marker_path)
            .map_err(|error| format!("无法读取影子仓项目映射: {error}"))?;
        let marker: ProjectMarker =
            serde_json::from_str(&raw).map_err(|error| format!("影子仓项目映射已损坏: {error}"))?;
        if marker.schema_version != PROJECT_SCHEMA_VERSION {
            return Err(format!(
                "不支持的影子仓项目映射版本: {}",
                marker.schema_version
            ));
        }
        if marker.canonical_project_root != repo.project_key {
            return Err("影子仓项目路径哈希映射不一致，已拒绝访问".to_string());
        }
        Ok(true)
    }

    fn write_marker(&self, repo: &ShadowRepository) -> Result<(), String> {
        if self.verify_marker(repo)? {
            return Ok(());
        }
        let marker = ProjectMarker {
            schema_version: PROJECT_SCHEMA_VERSION,
            canonical_project_root: repo.project_key.clone(),
        };
        let content = serde_json::to_vec_pretty(&marker)
            .map_err(|error| format!("无法序列化影子仓项目映射: {error}"))?;
        write_atomic(&repo.marker_path, &content)
            .map_err(|error| format!("无法写入影子仓项目映射: {error}"))
    }

    fn ensure_repository(&self, repo: &ShadowRepository) -> Result<bool, String> {
        fs::create_dir_all(&repo.bucket).map_err(|error| format!("无法创建影子仓目录: {error}"))?;
        let initialized = self.verify_marker(repo)?;
        if initialized && !repo.git_dir.join("HEAD").is_file() {
            return Err("影子仓已损坏：项目映射存在但 Git HEAD 缺失".to_string());
        }

        if !initialized {
            fs::create_dir_all(&repo.git_dir)
                .map_err(|error| format!("无法创建影子 Git 目录: {error}"))?;
            let _ = fs::remove_file(repo.git_dir.join("index"));
            let _ = fs::remove_file(repo.git_dir.join("objects").join("info").join("alternates"));
            let init_args = [OsString::from("init")];
            let extra_env = [
                (
                    OsString::from("GIT_DIR"),
                    repo.git_dir.as_os_str().to_os_string(),
                ),
                (
                    OsString::from("GIT_WORK_TREE"),
                    repo.project_root.as_os_str().to_os_string(),
                ),
            ];
            let output = self.run_git(
                &repo.bucket,
                Some(&repo.project_root),
                &init_args,
                None,
                &extra_env,
            )?;
            self.require_success(output, "初始化影子 Git 仓库")?;
        }

        self.configure_repository(repo)?;
        self.write_excludes(repo, &[])?;
        if initialized {
            return Ok(false);
        }

        match self.seed_from_source_repository(repo) {
            Ok(seeded) => Ok(seeded),
            Err(error) => {
                eprintln!("影子 Git 复用作者仓对象/index 失败，将执行完整索引: {error}");
                let _ = fs::remove_file(repo.git_dir.join("index"));
                let _ =
                    fs::remove_file(repo.git_dir.join("objects").join("info").join("alternates"));
                Ok(false)
            }
        }
    }

    fn configure_repository(&self, repo: &ShadowRepository) -> Result<(), String> {
        let settings = [
            ("core.autocrlf", "false"),
            ("core.longpaths", "true"),
            ("core.symlinks", "true"),
            ("core.filemode", "false"),
            ("core.fsmonitor", "false"),
            ("feature.manyFiles", "true"),
            ("index.version", "4"),
            ("index.threads", "true"),
            ("core.untrackedCache", "true"),
        ];
        for (key, value) in settings {
            let args = [
                OsString::from("config"),
                OsString::from("--local"),
                OsString::from(key),
                OsString::from(value),
            ];
            let output = self.run_in_repository(repo, &args, None)?;
            self.require_success(output, "配置影子 Git 仓库")?;
        }
        Ok(())
    }

    fn seed_from_source_repository(&self, repo: &ShadowRepository) -> Result<bool, String> {
        let common = self.run_in_source(
            repo,
            &[
                OsString::from("rev-parse"),
                OsString::from("--path-format=absolute"),
                OsString::from("--git-common-dir"),
            ],
        )?;
        if common.code != 0 {
            return Ok(false);
        }
        let common_dir = PathBuf::from(utf8_stdout(&common, "作者 Git common-dir")?.trim());
        if !common_dir.is_dir() {
            return Ok(false);
        }
        let source_objects = common_dir.join("objects");
        if !source_objects.is_dir() {
            return Ok(false);
        }

        let mut alternates = vec![fs::canonicalize(&source_objects)
            .map_err(|error| format!("无法解析作者 Git objects: {error}"))?];
        let chained_path = source_objects.join("info").join("alternates");
        if let Ok(raw) = fs::read_to_string(chained_path) {
            for line in raw.lines().map(str::trim).filter(|line| !line.is_empty()) {
                let candidate = PathBuf::from(line);
                let candidate = if candidate.is_absolute() {
                    candidate
                } else {
                    source_objects.join(candidate)
                };
                if let Ok(canonical) = fs::canonicalize(candidate) {
                    if canonical.is_dir() && !alternates.contains(&canonical) {
                        alternates.push(canonical);
                    }
                }
            }
        }
        let mut alternates_text = String::new();
        for path in alternates {
            let value = path
                .to_str()
                .ok_or_else(|| "作者 Git objects 路径不是有效 Unicode".to_string())?;
            if value.contains(['\r', '\n']) {
                return Err("作者 Git objects 路径包含换行，无法安全复用".to_string());
            }
            alternates_text.push_str(value);
            alternates_text.push('\n');
        }
        let target = repo.git_dir.join("objects").join("info").join("alternates");
        if let Some(parent) = target.parent() {
            fs::create_dir_all(parent)
                .map_err(|error| format!("无法创建影子仓 alternates 目录: {error}"))?;
        }
        fs::write(&target, alternates_text)
            .map_err(|error| format!("无法写入影子仓 alternates: {error}"))?;

        if !self.source_repository_root_matches(repo)? {
            return Ok(false);
        }

        let index = self.run_in_source(
            repo,
            &[
                OsString::from("rev-parse"),
                OsString::from("--path-format=absolute"),
                OsString::from("--git-path"),
                OsString::from("index"),
            ],
        )?;
        if index.code != 0 {
            return Ok(false);
        }
        let source_index = PathBuf::from(utf8_stdout(&index, "作者 Git index")?.trim());
        if !source_index.is_file() {
            return Ok(false);
        }
        fs::copy(source_index, repo.git_dir.join("index"))
            .map_err(|error| format!("无法复制作者 Git index 种子: {error}"))?;
        Ok(true)
    }

    fn source_repository_root_matches(&self, repo: &ShadowRepository) -> Result<bool, String> {
        let output = self.run_in_source(
            repo,
            &[
                OsString::from("rev-parse"),
                OsString::from("--path-format=absolute"),
                OsString::from("--show-toplevel"),
            ],
        )?;
        if output.code != 0 {
            return Ok(false);
        }
        let top_level = PathBuf::from(utf8_stdout(&output, "作者 Git toplevel")?.trim());
        let Ok(top_level) = fs::canonicalize(top_level) else {
            return Ok(false);
        };
        Ok(top_level == repo.project_root)
    }

    fn run_in_source(
        &self,
        repo: &ShadowRepository,
        args: &[OsString],
    ) -> Result<GitOutput, String> {
        self.run_git(&repo.bucket, Some(&repo.project_root), args, None, &[])
    }

    fn run_in_repository(
        &self,
        repo: &ShadowRepository,
        args: &[OsString],
        stdin: Option<&[u8]>,
    ) -> Result<GitOutput, String> {
        let mut command = vec![
            OsString::from("-c"),
            OsString::from("core.autocrlf=false"),
            OsString::from("-c"),
            OsString::from("core.longpaths=true"),
            OsString::from("-c"),
            OsString::from("core.symlinks=true"),
            OsString::from("--git-dir"),
            repo.git_dir.as_os_str().to_os_string(),
            OsString::from("--work-tree"),
            repo.project_root.as_os_str().to_os_string(),
        ];
        command.extend_from_slice(args);
        self.run_git(&repo.bucket, Some(&repo.project_root), &command, stdin, &[])
    }

    fn run_git(
        &self,
        environment_root: &Path,
        cwd: Option<&Path>,
        args: &[OsString],
        stdin: Option<&[u8]>,
        extra_env: &[(OsString, OsString)],
    ) -> Result<GitOutput, String> {
        let home = environment_root.join("home");
        let xdg = environment_root.join("xdg");
        fs::create_dir_all(&home)
            .and_then(|_| fs::create_dir_all(&xdg))
            .map_err(|error| format!("无法创建隔离 Git 环境: {error}"))?;
        let global_config = environment_root.join("global.gitconfig");
        OpenOptions::new()
            .create(true)
            .append(true)
            .open(&global_config)
            .map_err(|error| format!("无法创建隔离 Git 配置: {error}"))?;

        let mut command = Command::new(&self.git_executable);
        command.args(args);
        if let Some(cwd) = cwd {
            command.current_dir(cwd);
        }
        command
            .env_remove("GIT_DIR")
            .env_remove("GIT_WORK_TREE")
            .env_remove("GIT_INDEX_FILE")
            .env_remove("GIT_OBJECT_DIRECTORY")
            .env_remove("GIT_ALTERNATE_OBJECT_DIRECTORIES")
            .env_remove("GIT_COMMON_DIR")
            .env_remove("GIT_CONFIG_COUNT")
            .env("GIT_CONFIG_NOSYSTEM", "1")
            .env("GIT_CONFIG_GLOBAL", &global_config)
            .env("GIT_TERMINAL_PROMPT", "0")
            .env("GCM_INTERACTIVE", "Never")
            .env("HOME", &home)
            .env("XDG_CONFIG_HOME", &xdg)
            .env("LC_ALL", "C")
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        if stdin.is_some() {
            command.stdin(Stdio::piped());
        } else {
            command.stdin(Stdio::null());
        }
        for (key, value) in extra_env {
            command.env(key, value);
        }
        configure_bundled_git_paths(&mut command, &self.git_executable);
        hide_child_window(&mut command);

        let mut child = command
            .spawn()
            .map_err(|error| format!("无法启动内置 Git: {error}"))?;
        if let Some(input) = stdin {
            let mut writer = child
                .stdin
                .take()
                .ok_or_else(|| "无法打开内置 Git stdin".to_string())?;
            writer
                .write_all(input)
                .map_err(|error| format!("无法写入内置 Git stdin: {error}"))?;
        }
        let output = child
            .wait_with_output()
            .map_err(|error| format!("等待内置 Git 失败: {error}"))?;
        Ok(GitOutput {
            code: output.status.code().unwrap_or(-1),
            stdout: output.stdout,
            stderr: String::from_utf8_lossy(&output.stderr).trim().to_string(),
        })
    }

    fn require_success<'a>(&self, output: GitOutput, operation: &str) -> Result<GitOutput, String> {
        if output.code == 0 {
            return Ok(output);
        }
        Err(format!(
            "{operation}失败（Git exit {}）: {}",
            output.code,
            if output.stderr.is_empty() {
                "无错误输出"
            } else {
                &output.stderr
            }
        ))
    }
}

fn utf8_stdout<'a>(output: &'a GitOutput, label: &str) -> Result<&'a str, String> {
    std::str::from_utf8(&output.stdout).map_err(|_| format!("{label}不是有效 UTF-8"))
}

fn sha256_hex(content: &[u8]) -> String {
    let digest = Sha256::digest(content);
    digest.iter().map(|byte| format!("{byte:02x}")).collect()
}

fn canonical_project_key(path: &Path) -> Result<String, String> {
    let raw = path
        .to_str()
        .ok_or_else(|| "项目路径不是有效 Unicode".to_string())?
        .replace('\\', "/");
    #[cfg(windows)]
    let raw = raw.strip_prefix("//?/").unwrap_or(&raw).to_lowercase();
    Ok(raw.trim_end_matches('/').to_string())
}

fn write_atomic(path: &Path, content: &[u8]) -> std::io::Result<()> {
    let parent = path.parent().unwrap_or_else(|| Path::new("."));
    fs::create_dir_all(parent)?;
    let temporary = parent.join(format!(
        ".{}.tmp-{}",
        path.file_name()
            .and_then(OsStr::to_str)
            .unwrap_or("shadow-git"),
        std::process::id()
    ));
    {
        let mut file = fs::File::create(&temporary)?;
        file.write_all(content)?;
        file.sync_all()?;
    }
    if let Err(error) = fs::rename(&temporary, path) {
        let _ = fs::remove_file(&temporary);
        return Err(error);
    }
    Ok(())
}

fn configure_bundled_git_paths(command: &mut Command, git_executable: &Path) {
    #[cfg(windows)]
    {
        let Some(runtime) = git_executable.parent().and_then(Path::parent) else {
            return;
        };
        let path = std::env::join_paths([
            runtime.join("cmd"),
            runtime.join("mingw64").join("bin"),
            runtime.join("usr").join("bin"),
        ]);
        if let Ok(path) = path {
            command.env("PATH", path);
        }
        let exec_path = runtime.join("mingw64").join("libexec").join("git-core");
        if exec_path.is_dir() {
            command.env("GIT_EXEC_PATH", exec_path);
        }
        let templates = runtime
            .join("mingw64")
            .join("share")
            .join("git-core")
            .join("templates");
        if templates.is_dir() {
            command.env("GIT_TEMPLATE_DIR", templates);
        }
    }
}

#[cfg(windows)]
fn hide_child_window(command: &mut Command) {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    command.creation_flags(CREATE_NO_WINDOW);
}

#[cfg(not(windows))]
fn hide_child_window(_command: &mut Command) {}

fn validate_relative_file_path(file_path: &str) -> Result<String, String> {
    if file_path.is_empty()
        || file_path.contains(['\0', '\r', '\n', ':'])
        || file_path.starts_with(['/', '\\'])
    {
        return Err("版本文件路径必须是安全的项目相对路径".to_string());
    }
    let normalized = file_path.replace('\\', "/");
    let path = Path::new(&normalized);
    if path
        .components()
        .any(|component| !matches!(component, Component::Normal(_)))
    {
        return Err("版本文件路径不能包含绝对路径或 ..".to_string());
    }
    Ok(normalized)
}

fn is_valid_tree_hash(hash: &str) -> bool {
    matches!(hash.len(), 40 | 64)
        && hash
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
}

fn validate_tree_hash(hash: &str) -> Result<(), String> {
    if is_valid_tree_hash(hash) {
        Ok(())
    } else {
        Err("tree hash 必须是 40 或 64 位小写十六进制".to_string())
    }
}

fn validate_record_id(record_id: &str) -> Result<(), String> {
    if record_id.is_empty()
        || record_id.len() > 128
        || !record_id
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_'))
    {
        return Err("版本 record id 只能包含 ASCII 字母、数字、-、_，且长度为 1-128".to_string());
    }
    Ok(())
}

impl ShadowGitCore {
    pub(crate) fn create_snapshot(&self, project_root: &str) -> Result<CoreSnapshot, String> {
        let git_version = self.git_version()?;
        let repo = self.repository_for(project_root)?;
        let lock = self.shared.lock_for(&repo.project_key)?;
        let _guard = lock
            .lock()
            .map_err(|_| "影子 Git 项目锁已损坏".to_string())?;
        let seeded_index = self.ensure_repository(&repo)?;

        if let Err(error) = self.stage_worktree(&repo) {
            if !seeded_index {
                return Err(error);
            }
            eprintln!("影子 Git index 种子不兼容，将重建完整 index: {error}");
            fs::remove_file(repo.git_dir.join("index")).map_err(|remove_error| {
                format!("无法移除不兼容的影子 Git index: {remove_error}")
            })?;
            self.stage_worktree(&repo)?;
        }

        self.verify_worktree_stable(&repo)?;
        let output = self.run_in_repository(&repo, &[OsString::from("write-tree")], None)?;
        let output = self.require_success(output, "创建影子 Git tree")?;
        let tree_hash = utf8_stdout(&output, "影子 Git tree hash")?
            .trim()
            .to_string();
        validate_tree_hash(&tree_hash)?;
        self.write_marker(&repo)?;
        Ok(CoreSnapshot {
            tree_hash,
            git_version,
        })
    }

    fn stage_worktree(&self, repo: &ShadowRepository) -> Result<(), String> {
        self.write_excludes(repo, &[])?;
        let large_untracked = self.find_large_untracked_files(repo)?;
        self.write_excludes(repo, &large_untracked)?;

        let add = [
            OsString::from("add"),
            OsString::from("--all"),
            OsString::from("--sparse"),
            OsString::from("--"),
            OsString::from("."),
        ];
        let output = self.run_in_repository(repo, &add, None)?;
        self.require_success(output, "索引项目工作树")?;

        let storyforge = repo.project_root.join(".storyforge");
        if storyforge.exists() {
            let force_storyforge = [
                OsString::from("add"),
                OsString::from("-f"),
                OsString::from("--all"),
                OsString::from("--sparse"),
                OsString::from("--"),
                OsString::from(".storyforge"),
            ];
            let output = self.run_in_repository(repo, &force_storyforge, None)?;
            self.require_success(output, "索引作品级 .storyforge 状态")?;
        }

        self.drop_ignored_cached_paths(repo)?;
        Ok(())
    }

    fn source_info_excludes(&self, repo: &ShadowRepository) -> String {
        if self.source_repository_root_matches(repo) != Ok(true) {
            return String::new();
        }
        let output = self.run_in_source(
            repo,
            &[
                OsString::from("rev-parse"),
                OsString::from("--path-format=absolute"),
                OsString::from("--git-path"),
                OsString::from("info/exclude"),
            ],
        );
        let Ok(output) = output else {
            return String::new();
        };
        if output.code != 0 {
            return String::new();
        }
        let Ok(path) = utf8_stdout(&output, "作者 Git exclude") else {
            return String::new();
        };
        fs::read_to_string(path.trim()).unwrap_or_default()
    }

    fn write_excludes(
        &self,
        repo: &ShadowRepository,
        large_untracked: &[String],
    ) -> Result<(), String> {
        let path = repo.git_dir.join("info").join("exclude");
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent)
                .map_err(|error| format!("无法创建影子 Git exclude 目录: {error}"))?;
        }
        let mut content = self.source_info_excludes(repo);
        if !content.is_empty() && !content.ends_with('\n') {
            content.push('\n');
        }
        content.push_str("# StoryForge managed excludes\n");
        for pattern in BASE_EXCLUDES {
            content.push_str(pattern);
            content.push('\n');
        }
        for path in large_untracked {
            content.push('/');
            content.push_str(&escape_gitignore_literal(path)?);
            content.push('\n');
        }
        fs::write(path, content).map_err(|error| format!("无法写入影子 Git exclude: {error}"))
    }

    fn find_large_untracked_files(&self, repo: &ShadowRepository) -> Result<Vec<String>, String> {
        let args = [
            OsString::from("ls-files"),
            OsString::from("--others"),
            OsString::from("--exclude-standard"),
            OsString::from("-z"),
            OsString::from("--"),
            OsString::from("."),
        ];
        let output = self.run_in_repository(repo, &args, None)?;
        let output = self.require_success(output, "枚举影子 Git 未跟踪文件")?;
        let mut large = Vec::new();
        for path in nul_paths(&output.stdout, "未跟踪文件列表")? {
            let normalized = validate_relative_file_path(&path)?;
            if normalized == ".storyforge" || normalized.starts_with(".storyforge/") {
                continue;
            }
            let candidate = repo.project_root.join(path_from_git(&normalized));
            if let Ok(metadata) = fs::metadata(candidate) {
                if metadata.is_file() && metadata.len() > MAX_UNTRACKED_FILE_BYTES {
                    large.push(normalized);
                }
            }
        }
        large.sort();
        Ok(large)
    }

    fn drop_ignored_cached_paths(&self, repo: &ShadowRepository) -> Result<(), String> {
        let args = [
            OsString::from("ls-files"),
            OsString::from("--cached"),
            OsString::from("--ignored"),
            OsString::from("--exclude-standard"),
            OsString::from("-z"),
        ];
        let output = self.run_in_repository(repo, &args, None)?;
        let output = self.require_success(output, "枚举影子 Git 已忽略索引项")?;
        let paths = nul_paths(&output.stdout, "已忽略索引项")?
            .into_iter()
            .filter(|path| {
                let normalized = path.replace('\\', "/");
                !normalized.starts_with(".storyforge/")
                    || normalized.starts_with(".storyforge/canon/derived/")
            })
            .collect::<Vec<_>>();
        if paths.is_empty() {
            return Ok(());
        }
        let pathspecs = literal_pathspec_input(&paths)?;
        let args = [
            OsString::from("rm"),
            OsString::from("--cached"),
            OsString::from("-f"),
            OsString::from("--ignore-unmatch"),
            OsString::from("--pathspec-from-file=-"),
            OsString::from("--pathspec-file-nul"),
        ];
        let output = self.run_in_repository(repo, &args, Some(&pathspecs))?;
        self.require_success(output, "移除影子 Git 已忽略索引项")?;
        Ok(())
    }

    fn verify_worktree_stable(&self, repo: &ShadowRepository) -> Result<(), String> {
        let diff = [
            OsString::from("diff-files"),
            OsString::from("--quiet"),
            OsString::from("--"),
            OsString::from("."),
        ];
        let output = self.run_in_repository(repo, &diff, None)?;
        if output.code == 1 {
            return Err("创建快照期间项目文件发生变化，请重试写回".to_string());
        }
        self.require_success(output, "校验影子 Git 工作树稳定性")?;

        let untracked = [
            OsString::from("ls-files"),
            OsString::from("--others"),
            OsString::from("--exclude-standard"),
            OsString::from("-z"),
            OsString::from("--"),
            OsString::from("."),
        ];
        let output = self.run_in_repository(repo, &untracked, None)?;
        let output = self.require_success(output, "校验影子 Git 新增文件")?;
        let remaining = nul_paths(&output.stdout, "快照后新增文件列表")?;
        if !remaining.is_empty() {
            return Err("创建快照期间项目新增了文件，请重试写回".to_string());
        }
        Ok(())
    }

    fn require_existing_repository(&self, repo: &ShadowRepository) -> Result<(), String> {
        if !self.verify_marker(repo)? || !repo.git_dir.join("HEAD").is_file() {
            return Err("当前项目尚未建立可读取的影子 Git 快照".to_string());
        }
        Ok(())
    }

    pub(crate) fn retain_snapshot(
        &self,
        project_root: &str,
        tree_hash: &str,
        record_id: &str,
    ) -> Result<(), String> {
        validate_tree_hash(tree_hash)?;
        validate_record_id(record_id)?;
        self.git_version()?;
        let repo = self.repository_for(project_root)?;
        let lock = self.shared.lock_for(&repo.project_key)?;
        let _guard = lock
            .lock()
            .map_err(|_| "影子 Git 项目锁已损坏".to_string())?;
        self.require_existing_repository(&repo)?;
        self.require_tree(&repo, tree_hash)?;

        let reference = format!("refs/storyforge/versions/{record_id}");
        let args = [
            OsString::from("update-ref"),
            OsString::from(reference),
            OsString::from(tree_hash),
        ];
        let output = self.run_in_repository(&repo, &args, None)?;
        self.require_success(output, "保留影子 Git 作品版本")?;

        if self.shared.gc_is_due(&repo.project_key)? {
            if let Err(error) = self.run_gc(&repo, "7.days") {
                eprintln!("影子 Git GC 失败，当前版本 ref 已保留: {error}");
            }
        }
        Ok(())
    }

    pub(crate) fn release_snapshot(
        &self,
        project_root: &str,
        record_id: &str,
    ) -> Result<(), String> {
        validate_record_id(record_id)?;
        self.git_version()?;
        let repo = self.repository_for(project_root)?;
        let lock = self.shared.lock_for(&repo.project_key)?;
        let _guard = lock
            .lock()
            .map_err(|_| "影子 Git 项目锁已损坏".to_string())?;
        self.require_existing_repository(&repo)?;
        let reference = format!("refs/storyforge/versions/{record_id}");
        let args = [
            OsString::from("update-ref"),
            OsString::from("-d"),
            OsString::from(reference),
        ];
        let output = self.run_in_repository(&repo, &args, None)?;
        self.require_success(output, "释放影子 Git 作品版本")?;
        Ok(())
    }

    pub(crate) fn filter_retained_hashes(
        &self,
        project_root: &str,
        hashes: &[String],
    ) -> Result<Vec<String>, String> {
        for hash in hashes {
            validate_tree_hash(hash)?;
        }
        if hashes.is_empty() {
            return Ok(Vec::new());
        }
        self.git_version()?;
        let repo = self.repository_for(project_root)?;
        let lock = self.shared.lock_for(&repo.project_key)?;
        let _guard = lock
            .lock()
            .map_err(|_| "影子 Git 项目锁已损坏".to_string())?;
        self.require_existing_repository(&repo)?;

        let args = [
            OsString::from("for-each-ref"),
            OsString::from("--format=%(objectname)"),
            OsString::from("refs/storyforge/versions/"),
        ];
        let output = self.run_in_repository(&repo, &args, None)?;
        let output = self.require_success(output, "读取影子 Git 作品版本 refs")?;
        let retained = utf8_stdout(&output, "影子 Git 作品版本 refs")?
            .lines()
            .map(str::trim)
            .filter(|line| is_valid_tree_hash(line))
            .collect::<HashSet<_>>();
        let mut valid = Vec::new();
        let mut seen = HashSet::new();
        for hash in hashes {
            if retained.contains(hash.as_str()) && seen.insert(hash.as_str()) {
                self.require_tree(&repo, hash)?;
                valid.push(hash.clone());
            }
        }
        Ok(valid)
    }

    pub(crate) fn read_file(
        &self,
        project_root: &str,
        tree_hash: &str,
        file_path: &str,
    ) -> Result<CoreFileState, String> {
        validate_tree_hash(tree_hash)?;
        let file_path = validate_relative_file_path(file_path)?;
        self.git_version()?;
        let repo = self.repository_for(project_root)?;
        let lock = self.shared.lock_for(&repo.project_key)?;
        let _guard = lock
            .lock()
            .map_err(|_| "影子 Git 项目锁已损坏".to_string())?;
        self.require_existing_repository(&repo)?;
        self.require_tree(&repo, tree_hash)?;

        let literal_pathspec = format!(":(top,literal){file_path}");
        let args = [
            OsString::from("ls-tree"),
            OsString::from("-z"),
            OsString::from("--full-tree"),
            OsString::from(tree_hash),
            OsString::from("--"),
            OsString::from(literal_pathspec),
        ];
        let output = self.run_in_repository(&repo, &args, None)?;
        let output = self.require_success(output, "定位影子 Git 版本文件")?;
        if output.stdout.is_empty() {
            return Ok(CoreFileState {
                exists: false,
                content: String::new(),
            });
        }
        let entry = output
            .stdout
            .split(|byte| *byte == 0)
            .next()
            .ok_or_else(|| "影子 Git ls-tree 返回空记录".to_string())?;
        let entry = std::str::from_utf8(entry)
            .map_err(|_| "影子 Git ls-tree 路径不是有效 UTF-8".to_string())?;
        let (header, returned_path) = entry
            .split_once('\t')
            .ok_or_else(|| "影子 Git ls-tree 返回格式无效".to_string())?;
        if returned_path != file_path {
            return Err("影子 Git ls-tree 返回了非目标路径".to_string());
        }
        let mut fields = header.split_whitespace();
        let _mode = fields.next();
        let object_type = fields.next();
        let object_hash = fields.next();
        if object_type != Some("blob") {
            return Err("目标版本路径不是普通文件".to_string());
        }
        let object_hash = object_hash.ok_or_else(|| "影子 Git blob hash 缺失".to_string())?;
        validate_tree_hash(object_hash)?;
        let args = [
            OsString::from("cat-file"),
            OsString::from("blob"),
            OsString::from(object_hash),
        ];
        let output = self.run_in_repository(&repo, &args, None)?;
        let output = self.require_success(output, "读取影子 Git 版本文件")?;
        let content = String::from_utf8(output.stdout)
            .map_err(|_| "版本文件不是 UTF-8 文本，无法在编辑器中恢复".to_string())?;
        Ok(CoreFileState {
            exists: true,
            content,
        })
    }

    fn require_tree(&self, repo: &ShadowRepository, tree_hash: &str) -> Result<(), String> {
        let args = [
            OsString::from("cat-file"),
            OsString::from("-t"),
            OsString::from(tree_hash),
        ];
        let output = self.run_in_repository(repo, &args, None)?;
        let output = self.require_success(output, "校验影子 Git tree")?;
        if utf8_stdout(&output, "影子 Git 对象类型")?.trim() != "tree" {
            return Err("指定的影子 Git 对象不是 tree".to_string());
        }
        Ok(())
    }

    fn run_gc(&self, repo: &ShadowRepository, prune: &str) -> Result<(), String> {
        let args = [
            OsString::from("gc"),
            OsString::from(format!("--prune={prune}")),
        ];
        let output = self.run_in_repository(repo, &args, None)?;
        self.require_success(output, "清理影子 Git 孤儿对象")?;
        Ok(())
    }

    #[cfg(test)]
    pub(crate) fn force_gc(&self, project_root: &str, prune: &str) -> Result<(), String> {
        let repo = self.repository_for(project_root)?;
        let lock = self.shared.lock_for(&repo.project_key)?;
        let _guard = lock
            .lock()
            .map_err(|_| "影子 Git 项目锁已损坏".to_string())?;
        self.require_existing_repository(&repo)?;
        self.run_gc(&repo, prune)
    }
}

fn nul_paths(content: &[u8], label: &str) -> Result<Vec<String>, String> {
    content
        .split(|byte| *byte == 0)
        .filter(|item| !item.is_empty())
        .map(|item| {
            std::str::from_utf8(item)
                .map(str::to_string)
                .map_err(|_| format!("{label}包含非 UTF-8 路径"))
        })
        .collect()
}

fn literal_pathspec_input(paths: &[String]) -> Result<Vec<u8>, String> {
    let mut result = Vec::new();
    for path in paths {
        let normalized = validate_relative_file_path(path)?;
        result.extend_from_slice(b":(top,literal)");
        result.extend_from_slice(normalized.as_bytes());
        result.push(0);
    }
    Ok(result)
}

fn escape_gitignore_literal(path: &str) -> Result<String, String> {
    if path.contains(['\0', '\r', '\n']) {
        return Err("大文件路径包含无法写入 Git exclude 的字符".to_string());
    }
    let mut escaped = String::new();
    for (index, character) in path.chars().enumerate() {
        if matches!(character, '\\' | '*' | '?' | '[' | ']')
            || (index == 0 && matches!(character, '!' | '#'))
        {
            escaped.push('\\');
        }
        escaped.push(character);
    }
    if escaped.ends_with(' ') {
        escaped.insert(escaped.len() - 1, '\\');
    }
    Ok(escaped)
}

fn path_from_git(path: &str) -> PathBuf {
    path.split('/').collect()
}
