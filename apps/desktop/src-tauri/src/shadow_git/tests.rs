use super::core::{ShadowGitCore, SharedState};
use sha2::{Digest, Sha256};
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::Arc;
use tempfile::TempDir;
use walkdir::WalkDir;

fn system_git() -> PathBuf {
    if let Ok(explicit) = std::env::var("STORYFORGE_TEST_GIT") {
        let path = PathBuf::from(explicit);
        if path.is_file() {
            return path;
        }
    }
    let locator = if cfg!(windows) { "where.exe" } else { "which" };
    let output = Command::new(locator)
        .arg(if cfg!(windows) { "git.exe" } else { "git" })
        .output()
        .expect("locate git for tests");
    assert!(
        output.status.success(),
        "Git is required for shadow_git tests"
    );
    let first = String::from_utf8(output.stdout)
        .expect("git locator output is UTF-8")
        .lines()
        .next()
        .expect("git locator returned a path")
        .trim()
        .to_string();
    let path = PathBuf::from(first);
    assert!(
        path.is_file(),
        "located Git does not exist: {}",
        path.display()
    );
    path
}

fn fixture() -> (TempDir, TempDir, ShadowGitCore) {
    let data = tempfile::tempdir().expect("create app data fixture");
    let project = tempfile::tempdir().expect("create project fixture");
    let core = ShadowGitCore::new(
        system_git(),
        data.path().to_path_buf(),
        None,
        Arc::new(SharedState::default()),
    );
    (data, project, core)
}

fn write(project: &Path, relative: &str, content: impl AsRef<[u8]>) {
    let path = project.join(relative.replace('/', std::path::MAIN_SEPARATOR_STR));
    fs::create_dir_all(path.parent().expect("fixture path has parent"))
        .expect("create fixture parent");
    fs::write(path, content).expect("write fixture");
}

fn read_state(core: &ShadowGitCore, project: &Path, tree: &str, relative: &str) -> (bool, String) {
    let state = core
        .read_file(project.to_str().unwrap(), tree, relative)
        .expect("read tree state");
    (state.exists, state.content)
}

#[test]
fn snapshots_non_git_worktree_and_preserves_story_state() {
    let (_data, project, core) = fixture();
    write(project.path(), "正文/第01章.md", "第一版\r\n");
    write(
        project.path(),
        ".storyforge/book.json",
        r#"{"title":"测试"}"#,
    );
    write(
        project.path(),
        ".storyforge/canon/canon.json",
        r#"{"hero":"林岚"}"#,
    );
    write(
        project.path(),
        ".storyforge/canon/derived/cache.json",
        "derived",
    );
    write(
        project.path(),
        ".storyforge/versions/正文/第01章.md/branches.json",
        r#"{"activeBranchId":"main"}"#,
    );
    write(project.path(), "node_modules/pkg/index.js", "dependency");
    write(project.path(), "large.bin", vec![b'x'; 2 * 1024 * 1024 + 1]);

    let first = core
        .create_snapshot(project.path().to_str().unwrap())
        .expect("create first snapshot");
    let identical = core
        .create_snapshot(project.path().to_str().unwrap())
        .expect("create identical snapshot");
    assert_eq!(first.tree_hash, identical.tree_hash);
    assert_eq!(
        read_state(&core, project.path(), &first.tree_hash, "正文/第01章.md"),
        (true, "第一版\r\n".to_string())
    );
    assert!(
        read_state(
            &core,
            project.path(),
            &first.tree_hash,
            ".storyforge/book.json"
        )
        .0
    );
    assert!(
        read_state(
            &core,
            project.path(),
            &first.tree_hash,
            ".storyforge/canon/canon.json"
        )
        .0
    );
    assert!(
        read_state(
            &core,
            project.path(),
            &first.tree_hash,
            ".storyforge/versions/正文/第01章.md/branches.json"
        )
        .0
    );
    assert!(
        !read_state(
            &core,
            project.path(),
            &first.tree_hash,
            ".storyforge/canon/derived/cache.json"
        )
        .0
    );
    assert!(
        !read_state(
            &core,
            project.path(),
            &first.tree_hash,
            "node_modules/pkg/index.js"
        )
        .0
    );
    assert!(!read_state(&core, project.path(), &first.tree_hash, "large.bin").0);

    write(project.path(), "正文/第01章.md", "第二版\n");
    let modified = core
        .create_snapshot(project.path().to_str().unwrap())
        .expect("create modified snapshot");
    assert_ne!(first.tree_hash, modified.tree_hash);
    fs::remove_file(project.path().join("正文").join("第01章.md")).unwrap();
    let deleted = core
        .create_snapshot(project.path().to_str().unwrap())
        .expect("create deleted snapshot");
    assert_eq!(
        read_state(&core, project.path(), &modified.tree_hash, "正文/第01章.md"),
        (true, "第二版\n".to_string())
    );
    assert_eq!(
        read_state(&core, project.path(), &deleted.tree_hash, "正文/第01章.md"),
        (false, String::new())
    );
}

#[test]
fn force_includes_storyforge_even_when_author_gitignore_excludes_it() {
    let (_data, project, core) = fixture();
    write(project.path(), ".gitignore", ".storyforge/\nignored.txt\n");
    write(project.path(), ".storyforge/book.json", "book");
    write(project.path(), ".storyforge/canon/derived/cache", "cache");
    write(project.path(), "ignored.txt", "ignored");
    let snapshot = core
        .create_snapshot(project.path().to_str().unwrap())
        .expect("create snapshot");

    assert!(
        read_state(
            &core,
            project.path(),
            &snapshot.tree_hash,
            ".storyforge/book.json"
        )
        .0
    );
    assert!(
        !read_state(
            &core,
            project.path(),
            &snapshot.tree_hash,
            ".storyforge/canon/derived/cache"
        )
        .0
    );
    assert!(!read_state(&core, project.path(), &snapshot.tree_hash, "ignored.txt").0);
}

#[test]
fn retains_tree_through_gc_and_filters_only_live_refs() {
    let (_data, project, core) = fixture();
    write(project.path(), "正文/第01章.md", "保留我");
    let snapshot = core
        .create_snapshot(project.path().to_str().unwrap())
        .expect("create snapshot");
    core.retain_snapshot(
        project.path().to_str().unwrap(),
        &snapshot.tree_hash,
        "record_001",
    )
    .expect("retain snapshot");
    core.force_gc(project.path().to_str().unwrap(), "now")
        .expect("force gc");
    assert_eq!(
        read_state(&core, project.path(), &snapshot.tree_hash, "正文/第01章.md"),
        (true, "保留我".to_string())
    );
    assert_eq!(
        core.filter_retained_hashes(
            project.path().to_str().unwrap(),
            std::slice::from_ref(&snapshot.tree_hash)
        )
        .unwrap(),
        vec![snapshot.tree_hash.clone()]
    );

    core.release_snapshot(project.path().to_str().unwrap(), "record_001")
        .expect("release snapshot");
    assert!(core
        .filter_retained_hashes(
            project.path().to_str().unwrap(),
            std::slice::from_ref(&snapshot.tree_hash)
        )
        .unwrap()
        .is_empty());
}

#[test]
fn existing_git_repository_is_read_only_and_seeds_alternates() {
    let (_data, project, core) = fixture();
    write(project.path(), "正文/第01章.md", "作者仓内容");
    run_git(project.path(), &["init"]);
    run_git(project.path(), &["add", "--", "."]);
    let before = directory_digest(&project.path().join(".git"));

    let snapshot = core
        .create_snapshot(project.path().to_str().unwrap())
        .expect("create snapshot from Git worktree");
    let after = directory_digest(&project.path().join(".git"));
    assert_eq!(before, after, "author .git must remain byte-identical");
    assert_eq!(
        read_state(&core, project.path(), &snapshot.tree_hash, "正文/第01章.md"),
        (true, "作者仓内容".to_string())
    );

    let alternates = core
        .repository_path(project.path().to_str().unwrap())
        .unwrap()
        .join("objects")
        .join("info")
        .join("alternates");
    let content = fs::read_to_string(alternates).expect("shadow alternates exists");
    assert!(content.replace('\\', "/").contains("/.git/objects"));
}

#[test]
fn incompatible_source_index_falls_back_without_touching_author_git() {
    let (_data, project, core) = fixture();
    write(project.path(), "正文/第01章.md", "损坏 index 也要完整快照");
    run_git(project.path(), &["init"]);
    run_git(project.path(), &["add", "--", "."]);
    fs::write(project.path().join(".git").join("index"), b"broken-index")
        .expect("corrupt source index fixture");
    let before = directory_digest(&project.path().join(".git"));

    let snapshot = core
        .create_snapshot(project.path().to_str().unwrap())
        .expect("fall back from incompatible source index");

    assert_eq!(
        before,
        directory_digest(&project.path().join(".git")),
        "fallback must not repair or rewrite the author index"
    );
    assert_eq!(
        read_state(&core, project.path(), &snapshot.tree_hash, "正文/第01章.md"),
        (true, "损坏 index 也要完整快照".to_string())
    );
}

#[test]
fn concurrent_snapshots_share_one_index_lock() {
    let (_data, project, core) = fixture();
    write(project.path(), "正文/第01章.md", "并发不损坏");
    let project_path = project.path().to_string_lossy().to_string();
    let handles = (0..4)
        .map(|_| {
            let core = core.clone();
            let project_path = project_path.clone();
            std::thread::spawn(move || core.create_snapshot(&project_path).unwrap().tree_hash)
        })
        .collect::<Vec<_>>();
    let hashes = handles
        .into_iter()
        .map(|handle| handle.join().expect("snapshot thread"))
        .collect::<Vec<_>>();
    assert!(hashes.windows(2).all(|pair| pair[0] == pair[1]));
}

#[test]
fn rejects_missing_runtime_bad_hash_bad_path_and_bad_record_id() {
    let (data, project, _core) = fixture();
    let missing = ShadowGitCore::new(
        data.path().join("missing-git.exe"),
        data.path().to_path_buf(),
        None,
        Arc::new(SharedState::default()),
    );
    assert!(missing
        .create_snapshot(project.path().to_str().unwrap())
        .unwrap_err()
        .contains("运行时缺失"));

    let (_, _, core) = fixture();
    assert!(core
        .read_file(project.path().to_str().unwrap(), "HEAD", "正文/a.md")
        .unwrap_err()
        .contains("tree hash"));
    let fake_hash = "a".repeat(40);
    assert!(core
        .read_file(project.path().to_str().unwrap(), &fake_hash, "../secret.md")
        .unwrap_err()
        .contains(".."));
    assert!(core
        .retain_snapshot(
            project.path().to_str().unwrap(),
            &fake_hash,
            "../../bad-ref"
        )
        .unwrap_err()
        .contains("record id"));
}

fn run_git(cwd: &Path, args: &[&str]) {
    let status = Command::new(system_git())
        .current_dir(cwd)
        .args(args)
        .env("GIT_CONFIG_NOSYSTEM", "1")
        .status()
        .expect("run fixture git");
    assert!(status.success(), "fixture git failed: {args:?}");
}

fn directory_digest(root: &Path) -> String {
    let mut files = WalkDir::new(root)
        .follow_links(false)
        .into_iter()
        .filter_map(Result::ok)
        .filter(|entry| entry.file_type().is_file())
        .map(|entry| entry.path().to_path_buf())
        .collect::<Vec<_>>();
    files.sort();
    let mut hash = Sha256::new();
    for path in files {
        hash.update(
            path.strip_prefix(root)
                .unwrap()
                .to_string_lossy()
                .as_bytes(),
        );
        hash.update([0]);
        hash.update(fs::read(path).expect("read digest fixture"));
        hash.update([0]);
    }
    format!("{:x}", hash.finalize())
}
