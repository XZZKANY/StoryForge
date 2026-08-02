use super::core::{SeedFailurePoint, ShadowGitCore, SharedState};
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
        assert!(
            path.is_file(),
            "STORYFORGE_TEST_GIT does not exist: {}",
            path.display()
        );
        return path;
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

#[cfg(windows)]
#[test]
fn bundled_git_accepts_verbatim_windows_resource_path() {
    let git = fs::canonicalize(system_git()).expect("canonicalize bundled Git path");
    assert!(
        git.to_string_lossy().starts_with(r"\\?\"),
        "Windows canonical path should use the verbatim prefix: {}",
        git.display()
    );
    let data = tempfile::tempdir().expect("create verbatim app data fixture");
    let project = tempfile::tempdir().expect("create verbatim project fixture");
    write(project.path(), "正文/第01章.md", "verbatim resource path");
    let core = ShadowGitCore::new(
        git,
        data.path().to_path_buf(),
        None,
        Arc::new(SharedState::default()),
    );

    core.create_snapshot(project.path().to_str().unwrap())
        .expect("snapshot with verbatim bundled Git path");
}

#[test]
fn repository_path_uses_stable_canonical_sha256_bucket() {
    let (data, project, core) = fixture();
    let canonical = fs::canonicalize(project.path()).expect("canonicalize project fixture");
    let mut project_key = canonical.to_string_lossy().replace('\\', "/");
    #[cfg(windows)]
    {
        project_key = project_key
            .strip_prefix("//?/")
            .unwrap_or(&project_key)
            .to_lowercase();
    }
    let project_key = project_key.trim_end_matches('/');
    let expected_bucket: String = Sha256::digest(project_key.as_bytes())
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect();

    let repository = core
        .repository_path(project.path().to_str().unwrap())
        .expect("resolve canonical shadow repository");
    assert_eq!(
        repository,
        data.path()
            .join("shadow-git")
            .join(&expected_bucket)
            .join("repo")
    );
    assert_eq!(expected_bucket.len(), 64);
    assert!(expected_bucket.bytes().all(|byte| byte.is_ascii_hexdigit()
        && (!byte.is_ascii_alphabetic() || byte.is_ascii_lowercase())));

    let alias = project.path().join(".");
    assert_eq!(
        core.repository_path(alias.to_str().unwrap()).unwrap(),
        repository,
        "canonical aliases must resolve to one stable project bucket"
    );
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
    write(project.path(), ".storyforge/cover.png", "cover-bytes");
    write(
        project.path(),
        ".storyforge/agent-instructions.md",
        "只写作者确认的事实",
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
    write(
        project.path(),
        ".storyforge/versions/正文/第01章.md/100.meta.json",
        r#"{"schemaVersion":2}"#,
    );
    write(
        project.path(),
        ".storyforge/serial-plan.json",
        r#"{"chapters":[]}"#,
    );
    write(project.path(), ".storyforge/notes/伏笔.md", "第三章回收");
    write(
        project.path(),
        ".storyforge/author-loop/run-1.jsonl",
        r#"{"kind":"writeback"}"#,
    );
    write(
        project.path(),
        ".storyforge/.book.json.tmp-123-1",
        "atomic-temp",
    );
    write(
        project.path(),
        ".storyforge/notes/node_modules/pkg/index.js",
        "dependency",
    );
    write(
        project.path(),
        ".storyforge/notes/.pnpm-store/cache.json",
        "dependency-cache",
    );
    write(project.path(), ".git/config", "must-not-enter-shadow-tree");
    write(project.path(), "正文/.第01章.md.tmp-123-1", "atomic-temp");
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
    for path in [
        ".storyforge/book.json",
        ".storyforge/cover.png",
        ".storyforge/agent-instructions.md",
        ".storyforge/canon/canon.json",
        ".storyforge/versions/正文/第01章.md/branches.json",
        ".storyforge/versions/正文/第01章.md/100.meta.json",
        ".storyforge/serial-plan.json",
        ".storyforge/notes/伏笔.md",
        ".storyforge/author-loop/run-1.jsonl",
    ] {
        assert!(
            read_state(&core, project.path(), &first.tree_hash, path).0,
            "作品状态必须进入 tree: {path}"
        );
    }
    for path in [
        ".storyforge/canon/derived/cache.json",
        ".storyforge/.book.json.tmp-123-1",
        ".storyforge/notes/node_modules/pkg/index.js",
        ".storyforge/notes/.pnpm-store/cache.json",
        ".git/config",
        "正文/.第01章.md.tmp-123-1",
        "node_modules/pkg/index.js",
        "large.bin",
    ] {
        assert!(
            !read_state(&core, project.path(), &first.tree_hash, path).0,
            "排除项不得进入 tree: {path}"
        );
    }

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
fn snapshots_empty_worktree_and_reads_windows_long_paths() {
    let (_data, project, core) = fixture();
    let empty = core
        .create_snapshot(project.path().to_str().unwrap())
        .expect("snapshot empty project");
    let identical = core
        .create_snapshot(project.path().to_str().unwrap())
        .expect("snapshot identical empty project");
    assert_eq!(empty.tree_hash, identical.tree_hash);

    let segment = "long-segment-".repeat(5);
    let relative = format!("正文/{segment}/{segment}/{segment}/{segment}/{segment}/第0001章.md");
    let absolute = project
        .path()
        .join(relative.replace('/', std::path::MAIN_SEPARATOR_STR));
    assert!(
        absolute.to_string_lossy().encode_utf16().count() > 260,
        "fixture must exceed the legacy Windows MAX_PATH boundary"
    );
    write(project.path(), &relative, "长路径正文\r\n");

    let snapshot = core
        .create_snapshot(project.path().to_str().unwrap())
        .expect("snapshot long path");
    assert_eq!(
        read_state(&core, project.path(), &snapshot.tree_hash, &relative),
        (true, "长路径正文\r\n".to_string())
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
fn managed_excludes_override_author_gitignore_negations() {
    let (_data, project, core) = fixture();
    write(
        project.path(),
        ".gitignore",
        concat!(
            "!node_modules/\n",
            "!node_modules/**\n",
            "!.pnpm-store/\n",
            "!.pnpm-store/**\n",
            "!.draft.md.tmp-123\n",
            "!.storyforge/canon/derived/\n",
            "!.storyforge/canon/derived/**\n",
            "!large.bin\n",
        ),
    );
    write(project.path(), "node_modules/pkg/index.js", "dependency");
    write(project.path(), ".pnpm-store/cache.json", "dependency-cache");
    write(project.path(), ".draft.md.tmp-123", "atomic-temp");
    write(
        project.path(),
        ".storyforge/canon/derived/cache.json",
        "derived",
    );
    write(project.path(), "large.bin", vec![b'x'; 2 * 1024 * 1024 + 1]);

    let snapshot = core
        .create_snapshot(project.path().to_str().unwrap())
        .expect("snapshot with author negations");

    for path in [
        "node_modules/pkg/index.js",
        ".pnpm-store/cache.json",
        ".draft.md.tmp-123",
        ".storyforge/canon/derived/cache.json",
        "large.bin",
    ] {
        assert!(
            !read_state(&core, project.path(), &snapshot.tree_hash, path).0,
            "StoryForge managed exclude must override author negation: {path}"
        );
    }
}

#[test]
fn ignored_storyforge_file_created_after_staging_is_rejected() {
    let (_data, project, core) = fixture();
    write(project.path(), ".gitignore", ".storyforge/\n");
    write(
        project.path(),
        ".storyforge/book.json",
        r#"{"title":"before"}"#,
    );
    let large_untracked = core
        .stage_worktree_for_test(project.path().to_str().unwrap())
        .expect("stage initial project state");

    write(
        project.path(),
        ".storyforge/versions/late.meta.json",
        r#"{"createdAfterStage":true}"#,
    );

    let error = core
        .verify_worktree_stable_for_test(project.path().to_str().unwrap(), &large_untracked)
        .expect_err("late ignored StoryForge state must invalidate the snapshot");
    assert!(error.contains("新增了文件"));
}

#[cfg(windows)]
#[test]
fn windows_managed_excludes_are_case_insensitive_without_hiding_same_named_files() {
    let (_data, project, core) = fixture();
    write(
        project.path(),
        ".gitignore",
        concat!(
            "!NODE_MODULES/\n",
            "!NODE_MODULES/**\n",
            "!.PNPM-STORE/\n",
            "!.PNPM-STORE/**\n",
            "!.StoryForge/\n",
            "!.StoryForge/**\n",
        ),
    );
    write(project.path(), "NODE_MODULES/pkg/index.js", "dependency");
    write(project.path(), ".PNPM-STORE/cache.json", "dependency-cache");
    write(
        project.path(),
        ".StoryForge/canon/DERIVED/cache.json",
        "derived",
    );
    write(project.path(), ".DRAFT.md.TMP-123", "atomic-temp");
    write(
        project.path(),
        "正文/node_modules",
        "ordinary manuscript file",
    );
    write(
        project.path(),
        ".StoryForge/cover.png",
        vec![b'x'; 2 * 1024 * 1024 + 1],
    );

    let snapshot = core
        .create_snapshot(project.path().to_str().unwrap())
        .expect("snapshot case-variant Windows project");

    for path in [
        "NODE_MODULES/pkg/index.js",
        ".PNPM-STORE/cache.json",
        ".StoryForge/canon/DERIVED/cache.json",
        ".DRAFT.md.TMP-123",
    ] {
        assert!(
            !read_state(&core, project.path(), &snapshot.tree_hash, path).0,
            "case-variant managed path must stay excluded: {path}"
        );
    }
    for path in ["正文/node_modules", ".StoryForge/cover.png"] {
        assert!(
            read_state(&core, project.path(), &snapshot.tree_hash, path).0,
            "ordinary file and author-owned StoryForge state must stay included: {path}"
        );
    }
}

#[test]
fn retains_tree_through_gc_and_filters_only_live_refs() {
    let (_data, project, core) = fixture();
    write(project.path(), "正文/第01章.md", "孤儿版本");
    let orphan = core
        .create_snapshot(project.path().to_str().unwrap())
        .expect("create orphan snapshot");
    write(project.path(), "正文/第01章.md", "保留我");
    let retained = core
        .create_snapshot(project.path().to_str().unwrap())
        .expect("create retained snapshot");
    core.retain_snapshot(
        project.path().to_str().unwrap(),
        &retained.tree_hash,
        "record_001",
    )
    .expect("retain snapshot");
    core.force_gc(project.path().to_str().unwrap(), "now")
        .expect("force gc");
    assert_eq!(
        read_state(&core, project.path(), &retained.tree_hash, "正文/第01章.md"),
        (true, "保留我".to_string())
    );
    assert!(
        core.read_file(
            project.path().to_str().unwrap(),
            &orphan.tree_hash,
            "正文/第01章.md"
        )
        .is_err(),
        "unretained tree must be pruned"
    );
    assert_eq!(
        core.filter_retained_hashes(
            project.path().to_str().unwrap(),
            std::slice::from_ref(&retained.tree_hash)
        )
        .unwrap(),
        vec![retained.tree_hash.clone()]
    );

    core.release_snapshot(project.path().to_str().unwrap(), "record_001")
        .expect("release snapshot");
    assert!(core
        .filter_retained_hashes(
            project.path().to_str().unwrap(),
            std::slice::from_ref(&retained.tree_hash)
        )
        .unwrap()
        .is_empty());
}

#[test]
fn existing_git_repository_is_read_only_and_materializes_borrowed_objects() {
    let (data, project, core) = fixture();
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
    assert!(
        !alternates.exists(),
        "completed snapshots must remove their author object-store dependency"
    );

    core.retain_snapshot(
        project.path().to_str().unwrap(),
        &snapshot.tree_hash,
        "source_independent",
    )
    .expect("retain source-backed snapshot");
    fs::rename(
        project.path().join(".git"),
        data.path().join("author-git-away"),
    )
    .expect("move author Git object store away");
    core.force_gc(project.path().to_str().unwrap(), "now")
        .expect("gc self-contained shadow repository");
    assert_eq!(
        read_state(&core, project.path(), &snapshot.tree_hash, "正文/第01章.md"),
        (true, "作者仓内容".to_string()),
        "retained shadow versions must not depend on the author's object store"
    );
}

#[test]
fn existing_git_repository_copies_source_index_seed_without_mutation() {
    let (_data, project, core) = fixture();
    write(project.path(), "正文/第01章.md", "作者仓 index 种子");
    run_git(project.path(), &["init"]);
    run_git(project.path(), &["add", "--", "."]);
    let author_git = project.path().join(".git");
    let source_index = fs::read(author_git.join("index")).expect("read source index");
    let before = directory_digest(&author_git);

    assert!(
        core.seed_source_repository_for_test(project.path().to_str().unwrap())
            .expect("seed shadow repository from author Git"),
        "compatible source index must be reported as seeded"
    );
    let alternates = core
        .repository_path(project.path().to_str().unwrap())
        .unwrap()
        .join("objects")
        .join("info")
        .join("alternates");
    let content = fs::read_to_string(alternates).expect("shadow alternates seed exists");
    assert!(content.replace('\\', "/").contains("/.git/objects"));
    let shadow_index = core
        .repository_path(project.path().to_str().unwrap())
        .unwrap()
        .join("index");
    assert_eq!(
        fs::read(shadow_index).expect("read copied shadow index"),
        source_index,
        "new shadow repository must copy the compatible author index before staging"
    );
    assert_eq!(
        directory_digest(&author_git),
        before,
        "index seeding must leave the author .git byte-identical"
    );
}

#[test]
fn alternates_or_index_seed_failures_fall_back_to_complete_snapshot() {
    for point in [
        SeedFailurePoint::AlternatesWrite,
        SeedFailurePoint::IndexCopy,
    ] {
        let (_data, project, mut core) = fixture();
        write(project.path(), "正文/第01章.md", "复用失败仍完整快照");
        run_git(project.path(), &["init"]);
        run_git(project.path(), &["add", "--", "."]);
        let author_git = project.path().join(".git");
        let before = directory_digest(&author_git);
        core.fail_seed_at_for_test(point);

        let snapshot = core
            .create_snapshot(project.path().to_str().unwrap())
            .unwrap_or_else(|error| panic!("{point:?} must fall back to a full snapshot: {error}"));

        assert_eq!(
            read_state(&core, project.path(), &snapshot.tree_hash, "正文/第01章.md"),
            (true, "复用失败仍完整快照".to_string())
        );
        assert_eq!(
            directory_digest(&author_git),
            before,
            "seed fallback must leave the author .git byte-identical"
        );
        assert!(
            !core
                .repository_path(project.path().to_str().unwrap())
                .unwrap()
                .join("objects")
                .join("info")
                .join("alternates")
                .exists(),
            "fallback snapshots must not retain a source-object dependency"
        );
    }
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

#[test]
#[ignore = "requires STORYFORGE_SHADOW_GIT_DOGFOOD_ROOT"]
fn dogfoods_real_storyforge_without_touching_author_git() {
    let project_root = std::env::var("STORYFORGE_SHADOW_GIT_DOGFOOD_ROOT")
        .expect("set STORYFORGE_SHADOW_GIT_DOGFOOD_ROOT");
    let project = fs::canonicalize(&project_root).expect("canonicalize dogfood project");
    let author_git = project.join(".git");
    assert!(
        author_git.is_dir(),
        "dogfood project must own a .git directory"
    );
    let context_path = project.join("CONTEXT.md");
    let expected_context = fs::read_to_string(&context_path).expect("read dogfood CONTEXT.md");
    let before = directory_digest(&author_git);
    let data = tempfile::tempdir().expect("create dogfood app-data root");
    let data_path = data.path().to_path_buf();
    let core = ShadowGitCore::new(
        system_git(),
        data_path.clone(),
        Some("2.55.0.windows.3".to_string()),
        Arc::new(SharedState::default()),
    );

    let snapshot = core
        .create_snapshot(project.to_str().unwrap())
        .expect("snapshot real StoryForge project");
    let repository = core
        .repository_path(project.to_str().unwrap())
        .expect("resolve dogfood shadow repository");
    assert!(repository.starts_with(&data_path));
    assert!(!repository.starts_with(&project));
    assert_eq!(
        read_state(&core, &project, &snapshot.tree_hash, "CONTEXT.md"),
        (true, expected_context)
    );
    core.retain_snapshot(
        project.to_str().unwrap(),
        &snapshot.tree_hash,
        "dogfood_storyforge",
    )
    .expect("retain dogfood tree");
    core.force_gc(project.to_str().unwrap(), "now")
        .expect("gc dogfood shadow repository");
    assert!(read_state(&core, &project, &snapshot.tree_hash, "CONTEXT.md").0);
    let after = directory_digest(&author_git);
    assert_eq!(before, after, "real author .git must remain byte-identical");
    eprintln!(
        "DOGFOOD tree={} git={} author_git_digest={} shadow_repo={}",
        snapshot.tree_hash,
        snapshot.git_version,
        after,
        repository.display()
    );

    drop(core);
    drop(data);
    assert!(
        !data_path.exists(),
        "temporary dogfood app-data must be removed"
    );
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
