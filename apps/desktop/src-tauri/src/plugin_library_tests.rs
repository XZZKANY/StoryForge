use super::*;
use std::io::Write;
use tempfile::TempDir;
use zip::unstable::write::FileOptionsExt;
use zip::write::SimpleFileOptions;
use zip::ZipWriter;

struct Fixture {
    _temp: TempDir,
    root: PathBuf,
    source: PathBuf,
}

fn fixture() -> Fixture {
    let temp = tempfile::tempdir().expect("create plugin library temp dir");
    let root = temp.path().join("plugins");
    let source = temp.path().join("source");
    fs::create_dir_all(&source).expect("create source dir");
    Fixture {
        _temp: temp,
        root,
        source,
    }
}

fn write(path: &Path, bytes: &[u8]) {
    fs::create_dir_all(path.parent().expect("parent")).expect("create parent");
    fs::write(path, bytes).expect("write fixture file");
}

fn staging_entries(root: &Path) -> usize {
    match fs::read_dir(root.join(STAGING_DIR)) {
        Ok(entries) => entries.count(),
        Err(error) if error.kind() == io::ErrorKind::NotFound => 0,
        Err(error) => panic!("read staging dir: {error}"),
    }
}

fn trash_entries(root: &Path) -> Vec<String> {
    let mut names: Vec<String> = match fs::read_dir(root.join(TRASH_DIR)) {
        Ok(entries) => entries
            .map(|entry| entry.unwrap().file_name().to_string_lossy().into_owned())
            .collect(),
        Err(error) if error.kind() == io::ErrorKind::NotFound => Vec::new(),
        Err(error) => panic!("read trash dir: {error}"),
    };
    names.sort();
    names
}

fn assert_trashed_as(entry: &str, name: &str) {
    let stamp = entry
        .strip_prefix(&format!("{name}-"))
        .unwrap_or_else(|| panic!("trash entry {entry} must start with {name}-"));
    assert!(
        !stamp.is_empty() && stamp.chars().all(|c| c.is_ascii_digit()),
        "trash entry {entry} must end with a millisecond stamp"
    );
}

fn paths(files: &[StagedFile]) -> Vec<&str> {
    files.iter().map(|file| file.path.as_str()).collect()
}

fn entry_limit(entries: usize) -> ScanLimits {
    ScanLimits {
        entries,
        ..ScanLimits::DEFAULT
    }
}

#[test]
fn plugin_name_accepts_chinese_and_ordinary_names() {
    let forty = "字".repeat(40);
    for name in [
        "写法",
        "番茄网文写法",
        "my-skill_v2",
        "写法 v1.2",
        "COM10",
        "console",
        "aux-tools",
        "LPT",
        forty.as_str(),
    ] {
        assert_eq!(
            validate_plugin_name(name),
            Ok(()),
            "{name:?} should be valid"
        );
    }
}

#[test]
fn plugin_name_rejects_each_rule_with_its_own_reason() {
    let forty_one = "字".repeat(41);
    for (name, reason) in [
        ("", "不能为空"),
        (forty_one.as_str(), "最多 40 个字"),
        (" 写法", "开头和结尾不能有空白"),
        ("写法 ", "开头和结尾不能有空白"),
        ("\u{3000}写法", "开头和结尾不能有空白"),
        ("\t写法", "开头和结尾不能有空白"),
        ("a<b", "「<」"),
        ("a>b", "「>」"),
        ("a:b", "「:」"),
        ("a\"b", "「\"」"),
        ("a/b", "「/」"),
        ("a\\b", "「\\」"),
        ("a|b", "「|」"),
        ("a?b", "「?」"),
        ("a*b", "「*」"),
        ("a\u{1}b", "控制字符"),
        ("a\u{1F}b", "控制字符"),
        ("a\u{7F}b", "控制字符"),
        (".hidden", "不能以「.」开头"),
        ("..", "不能以「.」开头"),
        ("写法.", "不能以「.」或空格结尾"),
        ("con", "保留名"),
        ("CON", "保留名"),
        ("Prn", "保留名"),
        ("aux", "保留名"),
        ("nul", "保留名"),
        ("Com1", "保留名"),
        ("COM9", "保留名"),
        ("lpt1", "保留名"),
        ("LPT9", "保留名"),
        ("con.txt", "保留名"),
        ("NUL.tar.gz", "保留名"),
    ] {
        let error = validate_plugin_name(name).expect_err(&format!("{name:?} must be rejected"));
        assert!(
            error.contains(reason),
            "{name:?}: expected reason containing {reason:?}, got {error:?}"
        );
    }
}

#[test]
fn stage_collects_text_files_and_reports_skipped_ones() {
    let fx = fixture();
    let exact = vec![b'a'; MAX_FILE_BYTES as usize];
    write(&fx.source.join("README.md"), "# 写法\n".as_bytes());
    write(
        &fx.source.join("skills").join("写法").join("SKILL.markdown"),
        "规则".as_bytes(),
    );
    write(&fx.source.join("notes.TXT"), b"notes");
    write(&fx.source.join("exact.md"), &exact);
    write(
        &fx.source.join(".codex-plugin").join("plugin.json"),
        b"{\"name\":\"x\"}",
    );
    write(&fx.source.join(".git").join("config.json"), b"{}");
    write(&fx.source.join(".hidden").join("a.md"), b"hidden");
    write(
        &fx.source.join("node_modules").join("pkg").join("index.md"),
        b"dep",
    );
    write(&fx.source.join("logo.png"), &[0x89, b'P', b'N', b'G']);
    write(&fx.source.join("run.exe"), b"MZ");
    write(
        &fx.source.join("big.md"),
        &vec![b'a'; MAX_FILE_BYTES as usize + 1],
    );
    write(&fx.source.join("latin1.txt"), &[0xFF, 0xFE, b'A']);

    let staged = stage_import(&fx.root, &fx.source).expect("stage import");

    assert_eq!(
        paths(&staged.files),
        vec![
            ".codex-plugin/plugin.json",
            "README.md",
            "exact.md",
            "notes.TXT",
            "skills/写法/SKILL.markdown",
        ]
    );
    let exact_entry = staged
        .files
        .iter()
        .find(|file| file.path == "exact.md")
        .unwrap();
    assert_eq!(exact_entry.bytes, MAX_FILE_BYTES);
    assert_eq!(
        staged.skipped,
        vec![
            SkippedFile {
                path: "big.md".into(),
                reason: REASON_TOO_LARGE.into()
            },
            SkippedFile {
                path: "latin1.txt".into(),
                reason: REASON_NOT_UTF8.into()
            },
            SkippedFile {
                path: "logo.png".into(),
                reason: REASON_NOT_TEXT.into()
            },
            SkippedFile {
                path: "run.exe".into(),
                reason: REASON_NOT_TEXT.into()
            },
        ]
    );
    assert!(staged
        .stage_id
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || c == '-'));
    let stage_root = PathBuf::from(&staged.stage_root);
    assert!(stage_root.is_absolute());
    assert_eq!(stage_root, fx.root.join(STAGING_DIR).join(&staged.stage_id));
    for file in &staged.files {
        let copied = file
            .path
            .split('/')
            .fold(stage_root.clone(), |path, part| path.join(part));
        let original = file
            .path
            .split('/')
            .fold(fx.source.clone(), |path, part| path.join(part));
        assert_eq!(fs::read(copied).unwrap(), fs::read(original).unwrap());
    }
    assert!(!stage_root.join(".git").exists());
    assert!(!stage_root.join(".hidden").exists());
    assert!(!stage_root.join("node_modules").exists());
    assert!(!stage_root.join("logo.png").exists());
    assert!(!stage_root.join("big.md").exists());
}

#[test]
fn stage_allows_eight_directory_levels_but_rejects_nine_without_leaving_a_stage() {
    let fx = fixture();
    let eight = ["a", "b", "c", "d", "e", "f", "g", "h"]
        .iter()
        .fold(fx.source.clone(), |path, part| path.join(part));
    write(&eight.join("ok.md"), b"ok");
    let staged = stage_import(&fx.root, &fx.source).expect("eight levels are allowed");
    assert_eq!(paths(&staged.files), vec!["a/b/c/d/e/f/g/h/ok.md"]);

    write(&eight.join("i").join("deep.md"), b"deep");
    let error = stage_import(&fx.root, &fx.source).expect_err("nine levels must fail");
    assert!(error.contains("层级超过 8 层"), "{error}");
    assert_eq!(staging_entries(&fx.root), 0);
}

#[test]
fn stage_rejects_more_than_three_hundred_files_without_leaving_a_stage() {
    let fx = fixture();
    for index in 0..MAX_FILES {
        write(&fx.source.join(format!("{index:03}.md")), b"x");
    }
    let staged = stage_import(&fx.root, &fx.source).expect("300 files are allowed");
    assert_eq!(staged.files.len(), MAX_FILES);

    write(&fx.source.join("one-more.md"), b"x");
    let error = stage_import(&fx.root, &fx.source).expect_err("301 files must fail");
    assert!(error.contains("超过 300 个"), "{error}");
    assert_eq!(staging_entries(&fx.root), 0);
}

#[test]
fn stage_rejects_more_than_four_megabytes_without_leaving_a_stage() {
    let fx = fixture();
    let chunk = vec![b'a'; 500 * 1024];
    for index in 0..9 {
        write(&fx.source.join(format!("part-{index}.md")), &chunk);
    }
    let error = stage_import(&fx.root, &fx.source).expect_err("4.5 MB must fail");
    assert!(error.contains("合计超过 4 MB"), "{error}");
    assert_eq!(staging_entries(&fx.root), 0);
}

#[test]
fn stage_rejects_folders_without_importable_text() {
    let fx = fixture();
    let error = stage_import(&fx.root, &fx.source).expect_err("empty folder must fail");
    assert_eq!(error, "这个文件夹里没有可以导入的文本文件");

    write(&fx.source.join("logo.png"), b"png");
    write(&fx.source.join(".git").join("HEAD.md"), b"ref");
    let error = stage_import(&fx.root, &fx.source).expect_err("no text files must fail");
    assert_eq!(error, "这个文件夹里没有可以导入的文本文件");
    assert_eq!(staging_entries(&fx.root), 0);
}

#[test]
fn stage_rejects_bad_sources_and_sources_inside_the_library() {
    let fx = fixture();
    write(&fx.source.join("a.md"), b"a");
    write(&fx.root.join("已装").join("a.md"), b"a");

    assert_eq!(
        stage_import(&fx.root, Path::new("relative/source")).unwrap_err(),
        "要导入的文件夹或压缩包必须是完整路径"
    );
    for missing in ["missing", "missing.zip"] {
        assert_eq!(
            stage_import(&fx.root, &fx.source.join(missing)).unwrap_err(),
            "要导入的文件夹或压缩包不存在"
        );
    }
    assert_eq!(
        stage_import(&fx.root, &fx.source.join("a.md")).unwrap_err(),
        "只能导入文件夹或 .zip 文件"
    );
    for inside in [fx.root.clone(), fx.root.join("已装")] {
        let error = stage_import(&fx.root, &inside).expect_err("library source must fail");
        assert!(error.contains("插件库里面"), "{error}");
    }
    assert_eq!(staging_entries(&fx.root), 0);
}

#[test]
fn stage_rejects_a_folder_that_contains_the_library() {
    let fx = fixture();
    write(&fx.source.join("a.md"), b"a");
    let parent = fx.source.parent().unwrap();

    assert_eq!(
        stage_import(&fx.root, parent).unwrap_err(),
        "不能导入包含插件库的文件夹"
    );
    assert_eq!(staging_entries(&fx.root), 0);
}

#[test]
fn stage_counts_every_scanned_entry_and_rejects_past_the_limit() {
    let fx = fixture();
    write(&fx.source.join("a.md"), b"a");
    write(&fx.source.join("b.png"), b"png");
    write(&fx.source.join("sub").join("c.md"), b"c");
    // 被跳过的目录本身算一项，里面的东西不再遍历、不计数。
    for index in 0..10 {
        write(&fx.source.join(".git").join(format!("{index}.md")), b"x");
    }
    let staged =
        stage_import_with_limits(&fx.root, &fx.source, entry_limit(5)).expect("five entries fit");
    assert_eq!(paths(&staged.files), vec!["a.md", "sub/c.md"]);

    write(&fx.source.join("d.md"), b"d");
    let error = stage_import_with_limits(&fx.root, &fx.source, entry_limit(5))
        .expect_err("six entries must fail");
    assert_eq!(
        error,
        "文件夹里的东西太多（超过 5 项），请选插件自己的文件夹"
    );
    assert_eq!(staging_entries(&fx.root), 0);
    assert_eq!(MAX_SCAN_ENTRIES, 5000);
}

#[test]
fn starting_a_new_stage_clears_older_stages() {
    let fx = fixture();
    write(&fx.source.join("a.md"), b"a");
    let first = stage_import(&fx.root, &fx.source).expect("first stage");
    let second = stage_import(&fx.root, &fx.source).expect("second stage");

    assert_ne!(first.stage_id, second.stage_id);
    assert!(!Path::new(&first.stage_root).exists());
    assert!(Path::new(&second.stage_root).join("a.md").is_file());
    assert_eq!(staging_entries(&fx.root), 1);
}

#[test]
fn commit_installs_and_moves_a_same_named_plugin_to_trash() {
    let fx = fixture();
    write(&fx.source.join("SKILL.md"), b"v1");
    let first = stage_import(&fx.root, &fx.source).expect("stage v1");
    let installed = commit_import(&fx.root, &first.stage_id, "写法").expect("commit v1");
    assert_eq!(PathBuf::from(&installed), fx.root.join("写法"));
    assert_eq!(
        fs::read(fx.root.join("写法").join("SKILL.md")).unwrap(),
        b"v1"
    );
    assert!(!Path::new(&first.stage_root).exists());
    assert!(trash_entries(&fx.root).is_empty());

    write(&fx.source.join("SKILL.md"), b"v2");
    let second = stage_import(&fx.root, &fx.source).expect("stage v2");
    commit_import(&fx.root, &second.stage_id, "写法").expect("commit v2");
    assert_eq!(
        fs::read(fx.root.join("写法").join("SKILL.md")).unwrap(),
        b"v2"
    );
    let trashed = trash_entries(&fx.root);
    assert_eq!(trashed.len(), 1);
    assert_trashed_as(&trashed[0], "写法");
    assert_eq!(
        fs::read(fx.root.join(TRASH_DIR).join(&trashed[0]).join("SKILL.md")).unwrap(),
        b"v1"
    );
    assert_eq!(staging_entries(&fx.root), 0);
}

#[test]
fn commit_rejects_bad_stage_ids_missing_stages_and_bad_names() {
    let fx = fixture();
    write(&fx.source.join("a.md"), b"a");
    let staged = stage_import(&fx.root, &fx.source).expect("stage");

    for stage_id in ["", "../x", "a/b", "a.b", "a b"] {
        assert_eq!(
            commit_import(&fx.root, stage_id, "写法"),
            Err("导入编号无效".to_string())
        );
    }
    assert!(commit_import(&fx.root, "1234-abcdef", "写法")
        .unwrap_err()
        .contains("暂存已经不在了"));
    assert!(commit_import(&fx.root, &staged.stage_id, "con")
        .unwrap_err()
        .contains("保留名"));
    assert!(Path::new(&staged.stage_root).join("a.md").is_file());
    assert!(!fx.root.join("con").exists());
}

#[test]
fn discard_removes_the_stage_and_tolerates_missing_ones() {
    let fx = fixture();
    write(&fx.source.join("a.md"), b"a");
    let staged = stage_import(&fx.root, &fx.source).expect("stage");

    discard_import(&fx.root, &staged.stage_id).expect("discard");
    assert!(!Path::new(&staged.stage_root).exists());
    discard_import(&fx.root, &staged.stage_id).expect("discarding twice is fine");
    assert_eq!(
        discard_import(&fx.root, "../plugins"),
        Err("导入编号无效".to_string())
    );
    assert!(fx.root.is_dir());
}

#[test]
fn remove_moves_the_plugin_to_trash() {
    let fx = fixture();
    ensure_library_root(&fx.root).unwrap();
    assert_eq!(
        remove_plugin(&fx.root, "写法"),
        Err("插件库里没有「写法」".to_string())
    );
    assert!(remove_plugin(&fx.root, "a/b")
        .unwrap_err()
        .contains("「/」"));

    write(&fx.source.join("a.md"), b"a");
    let staged = stage_import(&fx.root, &fx.source).expect("stage");
    commit_import(&fx.root, &staged.stage_id, "写法").expect("commit");
    remove_plugin(&fx.root, "写法").expect("remove");

    assert!(!fx.root.join("写法").exists());
    let trashed = trash_entries(&fx.root);
    assert_eq!(trashed.len(), 1);
    assert_trashed_as(&trashed[0], "写法");
    assert!(fx
        .root
        .join(TRASH_DIR)
        .join(&trashed[0])
        .join("a.md")
        .is_file());
}

#[test]
fn removing_the_same_name_twice_keeps_both_trash_entries() {
    let fx = fixture();
    write(&fx.root.join("写法").join("a.md"), b"first");
    remove_plugin(&fx.root, "写法").expect("first remove");
    write(&fx.root.join("写法").join("a.md"), b"second");
    remove_plugin(&fx.root, "写法").expect("second remove");

    let trashed = trash_entries(&fx.root);
    assert_eq!(trashed.len(), 2);
    for entry in &trashed {
        assert_trashed_as(entry, "写法");
    }
}

fn starter(root: &Path) -> PathBuf {
    root.join(STARTER_PLUGIN_NAME)
}

fn starter_file(root: &Path, path: &str) -> PathBuf {
    path.split('/')
        .fold(starter(root), |dir, part| dir.join(part))
}

fn files_under(dir: &Path) -> Vec<String> {
    let mut files: Vec<String> = WalkDir::new(dir)
        .into_iter()
        .map(|entry| entry.expect("walk plugin dir"))
        .filter(|entry| entry.file_type().is_file())
        .map(|entry| relative_posix(dir, entry.path()).expect("utf-8 path"))
        .collect();
    files.sort();
    files
}

#[test]
fn bundled_manifest_matches_the_folder_name_and_sync_version() {
    let (_, manifest) = STARTER_PLUGIN_FILES
        .iter()
        .find(|(path, _)| *path == "storyforge-plugin.json")
        .expect("bundled manifest");
    let manifest: serde_json::Value = serde_json::from_str(manifest).expect("manifest is JSON");
    assert_eq!(manifest["name"], STARTER_PLUGIN_NAME);
    assert_eq!(manifest["version"], STARTER_PLUGIN_VERSION);
    assert_eq!(validate_plugin_name(STARTER_PLUGIN_NAME), Ok(()));
}

#[test]
fn first_sync_writes_every_bundled_file_and_the_marker() {
    let fx = fixture();
    ensure_library_root(&fx.root).unwrap();
    sync_bundled_plugins(&fx.root).expect("sync");

    for (path, content) in STARTER_PLUGIN_FILES {
        assert_eq!(
            fs::read(starter_file(&fx.root, path)).unwrap(),
            content.as_bytes(),
            "{path}"
        );
    }
    assert_eq!(
        fs::read_to_string(starter(&fx.root).join(BUNDLED_MARKER)).unwrap(),
        STARTER_PLUGIN_VERSION
    );
    assert_eq!(
        files_under(&starter(&fx.root)),
        vec![
            BUNDLED_MARKER,
            "storyforge-plugin.json",
            "技能/审稿口径.md",
            "技能/立项流程.md",
        ]
    );
    assert!(trash_entries(&fx.root).is_empty());
}

#[test]
fn sync_with_the_same_version_leaves_the_folder_alone() {
    let fx = fixture();
    ensure_library_root(&fx.root).unwrap();
    sync_bundled_plugins(&fx.root).expect("first sync");
    let edited = starter_file(&fx.root, "技能/立项流程.md");
    fs::write(&edited, "改过的内容").unwrap();

    sync_bundled_plugins(&fx.root).expect("second sync");
    assert_eq!(fs::read_to_string(&edited).unwrap(), "改过的内容");
    assert!(trash_entries(&fx.root).is_empty());
}

#[test]
fn sync_with_another_version_trashes_the_old_copy_and_rewrites() {
    let fx = fixture();
    ensure_library_root(&fx.root).unwrap();
    sync_bundled_plugins(&fx.root).expect("first sync");
    fs::write(starter_file(&fx.root, "技能/立项流程.md"), "旧版").unwrap();
    write(
        &starter_file(&fx.root, "技能/旧技能.md"),
        "旧版才有".as_bytes(),
    );
    fs::write(starter(&fx.root).join(BUNDLED_MARKER), "0.9.0").unwrap();

    sync_bundled_plugins(&fx.root).expect("upgrade");
    for (path, content) in STARTER_PLUGIN_FILES {
        assert_eq!(
            fs::read(starter_file(&fx.root, path)).unwrap(),
            content.as_bytes(),
            "{path}"
        );
    }
    assert!(!starter_file(&fx.root, "技能/旧技能.md").exists());
    assert_eq!(
        fs::read_to_string(starter(&fx.root).join(BUNDLED_MARKER)).unwrap(),
        STARTER_PLUGIN_VERSION
    );
    let trashed = trash_entries(&fx.root);
    assert_eq!(trashed.len(), 1);
    assert_trashed_as(&trashed[0], STARTER_PLUGIN_NAME);
    let old = fx.root.join(TRASH_DIR).join(&trashed[0]);
    assert_eq!(
        fs::read_to_string(old.join("技能").join("立项流程.md")).unwrap(),
        "旧版"
    );
    assert_eq!(
        fs::read_to_string(old.join(BUNDLED_MARKER)).unwrap(),
        "0.9.0"
    );
}

#[test]
fn sync_never_touches_a_same_named_entry_without_the_marker() {
    let fx = fixture();
    write(
        &starter_file(&fx.root, "技能/自己的.md"),
        "作者自己装的".as_bytes(),
    );
    sync_bundled_plugins(&fx.root).expect("sync");
    assert_eq!(files_under(&starter(&fx.root)), vec!["技能/自己的.md"]);
    assert!(trash_entries(&fx.root).is_empty());

    let plain = fixture();
    write(&starter(&plain.root), b"not a folder");
    sync_bundled_plugins(&plain.root).expect("sync beside a plain file");
    assert_eq!(fs::read(starter(&plain.root)).unwrap(), b"not a folder");
    assert!(trash_entries(&plain.root).is_empty());
}

#[test]
fn a_failed_bundled_write_leaves_no_half_written_folder() {
    let fx = fixture();
    ensure_library_root(&fx.root).unwrap();
    let target = starter(&fx.root);
    let error = write_bundled_plugin(&target, &[("a.md", "a"), ("a.md/b.md", "b")], "1.0.0")
        .expect_err("a file cannot be a parent folder");
    assert!(error.contains("「a.md/b.md」"), "{error}");
    assert!(!target.exists());

    let missing_root = fixture();
    assert!(sync_bundled_plugins(&missing_root.root)
        .unwrap_err()
        .contains("无法创建自带插件"));
}

#[test]
fn removing_a_bundled_plugin_is_refused() {
    let fx = fixture();
    ensure_library_root(&fx.root).unwrap();
    sync_bundled_plugins(&fx.root).expect("sync");

    assert_eq!(
        remove_plugin(&fx.root, STARTER_PLUGIN_NAME),
        Err(
            "「起书基础包」是 StoryForge 自带的插件，不能移除；不想用就在作品的「上下文 → 插件」里取消勾选"
                .to_string()
        )
    );
    assert!(starter(&fx.root).join(BUNDLED_MARKER).is_file());
    assert!(trash_entries(&fx.root).is_empty());
}

#[test]
fn importing_over_the_bundled_plugin_drops_the_marker_and_sync_keeps_the_import() {
    let fx = fixture();
    ensure_library_root(&fx.root).unwrap();
    sync_bundled_plugins(&fx.root).expect("sync");
    write(
        &fx.source.join("技能").join("立项流程.md"),
        "作者的版本".as_bytes(),
    );
    let staged = stage_import(&fx.root, &fx.source).expect("stage");
    commit_import(&fx.root, &staged.stage_id, STARTER_PLUGIN_NAME).expect("commit");

    assert_eq!(files_under(&starter(&fx.root)), vec!["技能/立项流程.md"]);
    let trashed = trash_entries(&fx.root);
    assert_eq!(trashed.len(), 1);
    assert_trashed_as(&trashed[0], STARTER_PLUGIN_NAME);
    assert!(fx
        .root
        .join(TRASH_DIR)
        .join(&trashed[0])
        .join(BUNDLED_MARKER)
        .is_file());

    sync_bundled_plugins(&fx.root).expect("sync after import");
    assert_eq!(
        fs::read_to_string(starter_file(&fx.root, "技能/立项流程.md")).unwrap(),
        "作者的版本"
    );
    assert_eq!(files_under(&starter(&fx.root)), vec!["技能/立项流程.md"]);
    assert_eq!(trash_entries(&fx.root).len(), 1);
}

#[cfg(windows)]
#[test]
fn junctions_inside_the_source_are_not_followed() {
    let fx = fixture();
    let outside = fx.source.parent().unwrap().join("outside");
    write(&outside.join("secret.md"), b"secret");
    write(&fx.source.join("a.md"), b"a");
    let link = fx.source.join("linked");
    let status = std::process::Command::new("cmd")
        .args(["/C", "mklink", "/J"])
        .arg(&link)
        .arg(&outside)
        .stdout(std::process::Stdio::null())
        .status()
        .expect("run mklink");
    assert!(status.success(), "mklink /J must succeed");
    assert!(link.join("secret.md").is_file());

    let staged = stage_import(&fx.root, &fx.source).expect("stage");
    assert_eq!(paths(&staged.files), vec!["a.md"]);
    assert_eq!(
        staged.skipped,
        vec![SkippedFile {
            path: "linked".into(),
            reason: REASON_LINK.into()
        }]
    );
    assert!(!Path::new(&staged.stage_root).join("linked").exists());
}

enum ZipEntry<'a> {
    File(&'a str, &'a [u8]),
    Dir(&'a str),
    Link(&'a str, &'a str),
    Encrypted(&'a str, &'a [u8]),
}

fn zip_bytes(entries: &[ZipEntry]) -> Vec<u8> {
    let mut writer = ZipWriter::new(Cursor::new(Vec::new()));
    let options = SimpleFileOptions::default();
    for entry in entries {
        match entry {
            ZipEntry::File(name, bytes) => {
                writer.start_file(*name, options).expect("start zip file");
                writer.write_all(bytes).expect("write zip file");
            }
            ZipEntry::Dir(name) => writer.add_directory(*name, options).expect("add zip dir"),
            ZipEntry::Link(name, target) => writer
                .add_symlink(*name, *target, options)
                .expect("add zip link"),
            ZipEntry::Encrypted(name, bytes) => {
                let encrypted = FileOptionsExt::with_deprecated_encryption(options, b"secret")
                    .expect("zip encryption options");
                writer.start_file(*name, encrypted).expect("start zip file");
                writer.write_all(bytes).expect("write zip file");
            }
        }
    }
    writer.finish().expect("finish zip").into_inner()
}

fn zip_path(fx: &Fixture) -> PathBuf {
    fx.source.parent().unwrap().join("plugin.zip")
}

fn rel(base: &Path, path: &str) -> PathBuf {
    path.split('/')
        .fold(base.to_path_buf(), |path, part| path.join(part))
}

fn staged_contents(staged: &StagedImport) -> Vec<(String, Vec<u8>)> {
    staged
        .files
        .iter()
        .map(|file| {
            let bytes =
                fs::read(rel(Path::new(&staged.stage_root), &file.path)).expect("read staged file");
            (file.path.clone(), bytes)
        })
        .collect()
}

fn skipped(entries: &[(&str, &str)]) -> Vec<SkippedFile> {
    entries
        .iter()
        .map(|(path, reason)| SkippedFile {
            path: path.to_string(),
            reason: reason.to_string(),
        })
        .collect()
}

// 同长度原地替换：本地头与中央目录里各出现一次。
fn replace_name(bytes: &mut [u8], from: &[u8], to: &[u8]) {
    assert_eq!(from.len(), to.len());
    let positions: Vec<usize> = bytes
        .windows(from.len())
        .enumerate()
        .filter(|(_, window)| *window == from)
        .map(|(at, _)| at)
        .collect();
    assert_eq!(
        positions.len(),
        2,
        "name must appear in local and central headers"
    );
    for at in positions {
        bytes[at..at + to.len()].copy_from_slice(to);
    }
}

// 改条目在本地头（名字前 30 字节）与中央目录（名字前 46 字节）里的压缩方式字段。
fn patch_compression_method(bytes: &mut [u8], name: &[u8], method: u16) {
    let mut patched = 0;
    for at in 0..bytes.len().saturating_sub(name.len()) {
        if &bytes[at..at + name.len()] != name {
            continue;
        }
        if at >= 30 && bytes[at - 30..at - 26] == *b"PK\x03\x04" {
            bytes[at - 30 + 8..at - 30 + 10].copy_from_slice(&method.to_le_bytes());
            patched += 1;
        } else if at >= 46 && bytes[at - 46..at - 42] == *b"PK\x01\x02" {
            bytes[at - 46 + 10..at - 46 + 12].copy_from_slice(&method.to_le_bytes());
            patched += 1;
        }
    }
    assert_eq!(patched, 2, "both headers of {name:?} must be patched");
}

// 弄坏条目的本地头签名：中央目录照常，只要有人打开这个条目就会读失败。
fn break_local_header(bytes: &mut [u8], name: &[u8]) {
    let mut broken = 0;
    for at in 30..bytes.len().saturating_sub(name.len()) {
        if &bytes[at..at + name.len()] == name && bytes[at - 30..at - 26] == *b"PK\x03\x04" {
            bytes[at - 30..at - 26].copy_from_slice(b"XXXX");
            broken += 1;
        }
    }
    assert_eq!(broken, 1, "local header of {name:?} must be broken once");
}

#[test]
fn zip_import_stages_the_same_files_as_folder_import() {
    let fx = fixture();
    let exact = vec![b'a'; MAX_FILE_BYTES as usize];
    let big = vec![b'a'; MAX_FILE_BYTES as usize + 1];
    let tree: [(&str, &[u8]); 13] = [
        ("README.md", "# 写法\n".as_bytes()),
        ("技能/x.md", "技能正文".as_bytes()),
        ("skills/写法/SKILL.markdown", "规则".as_bytes()),
        ("notes.TXT", b"notes"),
        ("exact.md", &exact),
        (".codex-plugin/plugin.json", b"{\"name\":\"x\"}"),
        (".git/config.json", b"{}"),
        (".hidden/a.md", b"hidden"),
        ("node_modules/pkg/index.md", b"dep"),
        ("logo.png", &[0x89, b'P', b'N', b'G']),
        ("run.exe", b"MZ"),
        ("big.md", &big),
        ("latin1.txt", &[0xFF, 0xFE, b'A']),
    ];
    for (path, bytes) in &tree {
        write(&rel(&fx.source, path), bytes);
    }
    let mut entries: Vec<ZipEntry> = tree
        .iter()
        .map(|(path, bytes)| ZipEntry::File(path, bytes))
        .collect();
    entries.push(ZipEntry::File("__MACOSX/._README.md", b"\x00\x05\x16\x07"));
    entries.push(ZipEntry::File("__MACOSX/技能/._x.md", b"mac"));
    let archive = zip_path(&fx);
    write(&archive, &zip_bytes(&entries));

    let from_folder = stage_import(&fx.root, &fx.source).expect("stage folder");
    let folder_contents = staged_contents(&from_folder);
    let from_zip = stage_import(&fx.root, &archive).expect("stage zip");

    assert!(paths(&from_zip.files).contains(&"技能/x.md"));
    assert_eq!(from_zip.files, from_folder.files);
    assert_eq!(from_zip.skipped, from_folder.skipped);
    assert_eq!(staged_contents(&from_zip), folder_contents);
    let on_disk = files_under(Path::new(&from_zip.stage_root));
    assert_eq!(on_disk, paths(&from_zip.files));
    assert_eq!(staging_entries(&fx.root), 1);
}

#[test]
fn zip_with_a_single_top_folder_is_unwrapped() {
    let fx = fixture();
    let archive = zip_path(&fx);
    write(
        &archive,
        &zip_bytes(&[
            ZipEntry::Dir("my-plugin/"),
            ZipEntry::File("my-plugin/storyforge-plugin.json", b"{\"name\":\"p\"}"),
            ZipEntry::Dir("my-plugin/技能/"),
            ZipEntry::File("my-plugin/技能/x.md", "技能".as_bytes()),
            ZipEntry::File("my-plugin/.git/HEAD.md", b"ref"),
            ZipEntry::File("my-plugin/logo.png", b"png"),
            ZipEntry::File("__MACOSX/my-plugin/._x.md", b"mac"),
            ZipEntry::File("__MACOSX/._my-plugin", b"mac"),
        ]),
    );

    let staged = stage_import(&fx.root, &archive).expect("stage zip");
    assert_eq!(
        paths(&staged.files),
        vec!["storyforge-plugin.json", "技能/x.md"]
    );
    assert_eq!(staged.skipped, skipped(&[("logo.png", REASON_NOT_TEXT)]));
    commit_import(&fx.root, &staged.stage_id, "插件").expect("commit");
    assert!(fx
        .root
        .join("插件")
        .join("storyforge-plugin.json")
        .is_file());
    assert!(fx.root.join("插件").join("技能").join("x.md").is_file());

    for (entries, expected) in [
        (
            vec![
                ZipEntry::File("a/x.md", b"x"),
                ZipEntry::File("b/y.md", b"y"),
            ],
            vec!["a/x.md", "b/y.md"],
        ),
        (
            vec![
                ZipEntry::File("my-plugin/x.md", b"x"),
                ZipEntry::File("README.md", b"r"),
            ],
            vec!["README.md", "my-plugin/x.md"],
        ),
        (
            vec![
                ZipEntry::File("my-plugin/x.md", b"x"),
                ZipEntry::File(".git/config.json", b"{}"),
            ],
            vec!["x.md"],
        ),
    ] {
        write(&archive, &zip_bytes(&entries));
        let staged = stage_import(&fx.root, &archive).expect("stage zip");
        assert_eq!(paths(&staged.files), expected);
    }
}

#[test]
fn zip_whose_only_top_folder_is_a_plugin_layout_dir_is_not_unwrapped() {
    let fx = fixture();
    let archive = zip_path(&fx);
    for (entries, expected) in [
        (vec![ZipEntry::File("技能/x.md", b"x")], vec!["技能/x.md"]),
        (
            vec![
                ZipEntry::Dir("写法/"),
                ZipEntry::File("写法/a.md", b"a"),
                ZipEntry::File("写法/b.md", b"b"),
            ],
            vec!["写法/a.md", "写法/b.md"],
        ),
        (
            vec![ZipEntry::File("SKILLS/s/SKILL.md", b"s")],
            vec!["SKILLS/s/SKILL.md"],
        ),
        (
            vec![ZipEntry::File(".codex-plugin/plugin.json", b"{}")],
            vec![".codex-plugin/plugin.json"],
        ),
        (
            vec![
                ZipEntry::File("__MACOSX/技能/._x.md", b"mac"),
                ZipEntry::File("技能/x.md", b"x"),
            ],
            vec!["技能/x.md"],
        ),
        (
            vec![ZipEntry::File("my-plugin/技能/x.md", b"x")],
            vec!["技能/x.md"],
        ),
    ] {
        write(&archive, &zip_bytes(&entries));
        let staged = stage_import(&fx.root, &archive).expect("stage zip");
        assert_eq!(paths(&staged.files), expected);
    }
}

#[test]
fn zip_entries_declared_too_large_are_skipped_without_unpacking() {
    let fx = fixture();
    let archive = zip_path(&fx);
    let huge = vec![b'a'; MAX_FILE_BYTES as usize + 1];
    let mut bytes = zip_bytes(&[
        ZipEntry::File("ok.md", b"ok"),
        ZipEntry::File("huge.md", &huge),
    ]);
    break_local_header(&mut bytes, b"huge.md");
    write(&archive, &bytes);

    let staged = stage_import(&fx.root, &archive).expect("huge.md must never be opened");
    assert_eq!(paths(&staged.files), vec!["ok.md"]);
    assert_eq!(staged.skipped, skipped(&[("huge.md", REASON_TOO_LARGE)]));

    // 对照：本地头同样坏掉、声明大小不超限的条目会被打开，于是整体报错。
    let mut bytes = zip_bytes(&[
        ZipEntry::File("ok.md", b"ok"),
        ZipEntry::File("small.md", b"small"),
    ]);
    break_local_header(&mut bytes, b"small.md");
    write(&archive, &bytes);
    let error = stage_import(&fx.root, &archive).expect_err("an opened broken entry must fail");
    assert!(error.contains("读取压缩包里的「small.md」失败"), "{error}");
    assert_eq!(staging_entries(&fx.root), 0);
}

#[test]
fn zip_unpacked_bytes_are_capped_including_contents_that_get_skipped() {
    let fx = fixture();
    let archive = zip_path(&fx);
    let limits = ScanLimits {
        unpacked_bytes: 1000,
        ..ScanLimits::DEFAULT
    };
    let valid = vec![b'a'; 500];
    let not_utf8 = vec![0xFF; 500];
    write(
        &archive,
        &zip_bytes(&[
            ZipEntry::File("a.md", &valid),
            ZipEntry::File("bad.md", &not_utf8),
        ]),
    );
    let staged = stage_import_with_limits(&fx.root, &archive, limits).expect("exactly at the cap");
    assert_eq!(paths(&staged.files), vec!["a.md"]);
    assert_eq!(staged.skipped, skipped(&[("bad.md", REASON_NOT_UTF8)]));

    // 收下的只有 501 字节，超限只能来自被跳过的 bad.md 也计了数。
    write(
        &archive,
        &zip_bytes(&[
            ZipEntry::File("a.md", &valid),
            ZipEntry::File("bad.md", &not_utf8),
            ZipEntry::File("c.md", b"c"),
        ]),
    );
    assert_eq!(
        stage_import_with_limits(&fx.root, &archive, limits).unwrap_err(),
        "压缩包解压后的内容太多，没有导入"
    );
    assert_eq!(staging_entries(&fx.root), 0);
    assert_eq!(MAX_UNPACKED_BYTES, 32 * 1024 * 1024);
}

#[test]
fn zip_entries_that_escape_or_are_illegal_on_windows_are_skipped() {
    let fx = fixture();
    let archive = zip_path(&fx);
    let unsafe_names = [
        "../evil.md",
        "/abs.md",
        "C:/x.md",
        "a\\..\\..\\b.md",
        "sub/../inner.md",
        "//server/share/unc.md",
        "a//empty.md",
        "./dot.md",
        "x:stream.md",
        "con.md",
        "dir./trail.md",
        "bad\u{7}.md",
        "nul\u{0}.md",
        "a?.md",
    ];
    let mut entries = vec![ZipEntry::File("ok.md", b"ok")];
    entries.extend(
        unsafe_names
            .iter()
            .map(|name| ZipEntry::File(name, b"escaped")),
    );
    write(&archive, &zip_bytes(&entries));

    let staged = stage_import(&fx.root, &archive).expect("stage zip");

    assert_eq!(paths(&staged.files), vec!["ok.md"]);
    let mut expected: Vec<String> = unsafe_names
        .iter()
        .map(|name| name.replace('\\', "/"))
        .collect();
    expected.sort();
    assert_eq!(
        staged
            .skipped
            .iter()
            .map(|file| file.path.clone())
            .collect::<Vec<_>>(),
        expected
    );
    assert!(staged
        .skipped
        .iter()
        .all(|file| file.reason == REASON_UNSAFE_PATH));
    let temp = fx.source.parent().unwrap();
    assert_eq!(
        files_under(temp),
        vec![
            "plugin.zip".to_string(),
            format!("plugins/{STAGING_DIR}/{}/ok.md", staged.stage_id),
        ]
    );
}

#[test]
fn zip_links_encrypted_entries_odd_compression_and_legacy_names_are_skipped() {
    let fx = fixture();
    let archive = zip_path(&fx);
    let mut bytes = zip_bytes(&[
        ZipEntry::File("ok.md", b"ok"),
        ZipEntry::Link("link.md", "../outside.md"),
        ZipEntry::Encrypted("secret.md", b"secret"),
        ZipEntry::File("bz.md", b"bzip2 pretender"),
        ZipEntry::File("@@@@.md", b"gbk name"),
        ZipEntry::File("bomb.md", &vec![b'a'; 4 * 1024 * 1024]),
    ]);
    patch_compression_method(&mut bytes, b"bz.md", 12);
    // 「技能」的 GBK 编码，不是合法 UTF-8，也没有 UTF-8 标志位。
    let gbk_name = [0xBC, 0xBC, 0xC4, 0xDC, b'.', b'm', b'd'];
    replace_name(&mut bytes, b"@@@@.md", &gbk_name);
    assert!(
        bytes.len() < 64 * 1024,
        "the bomb must stay small inside the zip"
    );
    write(&archive, &bytes);

    let staged = stage_import(&fx.root, &archive).expect("stage zip");

    assert_eq!(paths(&staged.files), vec!["ok.md"]);
    let shown_gbk = String::from_utf8_lossy(&gbk_name).into_owned();
    assert_eq!(
        staged.skipped,
        skipped(&[
            ("bomb.md", REASON_TOO_LARGE),
            ("bz.md", REASON_UNSUPPORTED_COMPRESSION),
            ("link.md", REASON_LINK),
            ("secret.md", REASON_ENCRYPTED),
            (shown_gbk.as_str(), REASON_ZIP_NAME_NOT_UTF8),
        ])
    );
    assert_eq!(
        files_under(Path::new(&staged.stage_root)),
        vec!["ok.md".to_string()]
    );
}

#[test]
fn zip_skips_later_files_whose_names_clash_ignoring_case() {
    let fx = fixture();
    let archive = zip_path(&fx);
    write(
        &archive,
        &zip_bytes(&[
            ZipEntry::File("Notes.md", b"first"),
            ZipEntry::File("notes.md", b"second"),
            ZipEntry::File("Sub/a.md", b"a"),
            ZipEntry::File("sub/A.md", b"b"),
            ZipEntry::File("guide.md", b"guide"),
            ZipEntry::File("Guide.MD/x.md", b"under a file"),
            ZipEntry::File("dir.md/x.md", b"dir first"),
            ZipEntry::File("DIR.md", b"file over a dir"),
            ZipEntry::File("Bad.md", &[0xFF]),
            ZipEntry::File("bad.md", b"valid after a skipped one"),
        ]),
    );

    let staged = stage_import(&fx.root, &archive).expect("stage zip");

    assert_eq!(
        paths(&staged.files),
        vec!["Notes.md", "Sub/a.md", "bad.md", "dir.md/x.md", "guide.md"]
    );
    assert_eq!(
        staged.skipped,
        skipped(&[
            ("Bad.md", REASON_NOT_UTF8),
            ("DIR.md", REASON_DUPLICATE),
            ("Guide.MD/x.md", REASON_DUPLICATE),
            ("notes.md", REASON_DUPLICATE),
            ("sub/A.md", REASON_DUPLICATE),
        ])
    );
    assert_eq!(
        fs::read(Path::new(&staged.stage_root).join("Notes.md")).unwrap(),
        b"first"
    );
}

#[test]
fn zip_limits_reject_the_whole_archive_without_leaving_a_stage() {
    let fx = fixture();
    let archive = zip_path(&fx);
    let reject = |entries: &[ZipEntry], expected: &str| {
        write(&archive, &zip_bytes(entries));
        let error = stage_import(&fx.root, &archive).expect_err(expected);
        assert!(error.contains(expected), "{error}");
        assert_eq!(staging_entries(&fx.root), 0);
    };

    let names: Vec<String> = (0..=MAX_FILES)
        .map(|index| format!("{index:03}.md"))
        .collect();
    let mut many: Vec<ZipEntry> = names
        .iter()
        .map(|name| ZipEntry::File(name, b"x"))
        .collect();
    reject(&many, "超过 300 个");
    many.pop();
    write(&archive, &zip_bytes(&many));
    assert_eq!(
        stage_import(&fx.root, &archive)
            .expect("300 files are allowed")
            .files
            .len(),
        MAX_FILES
    );

    let chunk = vec![b'a'; 500 * 1024];
    let parts: Vec<String> = (0..9).map(|index| format!("part-{index}.md")).collect();
    let heavy: Vec<ZipEntry> = parts
        .iter()
        .map(|name| ZipEntry::File(name, &chunk))
        .collect();
    reject(&heavy, "合计超过 4 MB");

    let deep_ok = [
        ZipEntry::File("root.md", b"r"),
        ZipEntry::File("a/b/c/d/e/f/g/h/ok.md", b"ok"),
    ];
    write(&archive, &zip_bytes(&deep_ok));
    assert_eq!(
        paths(
            &stage_import(&fx.root, &archive)
                .expect("eight levels")
                .files
        ),
        vec!["a/b/c/d/e/f/g/h/ok.md", "root.md"]
    );
    write(
        &archive,
        &zip_bytes(&[ZipEntry::File("top/a/b/c/d/e/f/g/h/ok.md", b"ok")]),
    );
    assert_eq!(
        paths(
            &stage_import(&fx.root, &archive)
                .expect("unwrapped eight levels")
                .files
        ),
        vec!["a/b/c/d/e/f/g/h/ok.md"]
    );
    reject(
        &[
            ZipEntry::File("root.md", b"r"),
            ZipEntry::File("a/b/c/d/e/f/g/h/i/deep.md", b"deep"),
        ],
        "层级超过 8 层（a/b/c/d/e/f/g/h/i）",
    );
    reject(
        &[
            ZipEntry::File("root.md", b"r"),
            ZipEntry::Dir("a/b/c/d/e/f/g/h/i/"),
        ],
        "层级超过 8 层",
    );

    reject(
        &[ZipEntry::File("logo.png", b"png")],
        "这个压缩包里没有可以导入的文本文件",
    );
    reject(&[], "这个压缩包里没有可以导入的文本文件");

    let mut twice = zip_bytes(&[ZipEntry::File("a.md", b"a"), ZipEntry::File("b.md", b"b")]);
    replace_name(&mut twice, b"b.md", b"a.md");
    write(&archive, &twice);
    let error = stage_import(&fx.root, &archive).expect_err("duplicate names must fail");
    assert!(error.contains("重名的条目"), "{error}");

    write(&archive, b"not a zip at all");
    let error = stage_import(&fx.root, &archive).expect_err("garbage must fail");
    assert!(error.contains("打不开这个压缩包"), "{error}");

    let huge = fs::File::create(&archive).unwrap();
    huge.set_len(MAX_ZIP_BYTES + 1).unwrap();
    drop(huge);
    assert_eq!(
        stage_import(&fx.root, &archive).unwrap_err(),
        "压缩包超过 32 MB，没有导入"
    );
    assert_eq!(staging_entries(&fx.root), 0);
}

#[test]
fn zip_entry_count_is_checked_before_reading_entries() {
    let fx = fixture();
    let archive = zip_path(&fx);
    let five = [
        ZipEntry::File("a.md", b"a"),
        ZipEntry::File("b.png", b"png"),
        ZipEntry::Dir("sub/"),
        ZipEntry::File("sub/c.md", b"c"),
        ZipEntry::File("__MACOSX/._a.md", b"mac"),
    ];
    write(&archive, &zip_bytes(&five));
    let staged =
        stage_import_with_limits(&fx.root, &archive, entry_limit(5)).expect("five entries fit");
    assert_eq!(paths(&staged.files), vec!["a.md", "sub/c.md"]);

    let mut six: Vec<ZipEntry> = five.into_iter().collect();
    six.push(ZipEntry::File("d.md", b"d"));
    write(&archive, &zip_bytes(&six));
    assert_eq!(
        stage_import_with_limits(&fx.root, &archive, entry_limit(5)).unwrap_err(),
        "压缩包里的条目太多（超过 5 项），请只打包插件自己的文件夹"
    );
    assert_eq!(staging_entries(&fx.root), 0);
}

#[test]
fn zip_sources_must_be_zip_files_outside_the_library() {
    let fx = fixture();
    let upper = fx.source.parent().unwrap().join("PLUGIN.ZIP");
    write(&upper, &zip_bytes(&[ZipEntry::File("a.md", b"a")]));
    assert_eq!(
        paths(
            &stage_import(&fx.root, &upper)
                .expect("upper-case extension")
                .files
        ),
        vec!["a.md"]
    );

    write(&fx.source.join("plugin.rar"), b"rar");
    assert_eq!(
        stage_import(&fx.root, &fx.source.join("plugin.rar")).unwrap_err(),
        "只能导入文件夹或 .zip 文件"
    );

    let folder_named_zip = fx.source.join("folder.zip");
    write(&folder_named_zip.join("b.md"), b"b");
    assert_eq!(
        paths(
            &stage_import(&fx.root, &folder_named_zip)
                .expect("a folder named .zip")
                .files
        ),
        vec!["b.md"]
    );

    let inside = fx.root.join("x.zip");
    write(&inside, &zip_bytes(&[ZipEntry::File("a.md", b"a")]));
    assert_eq!(
        stage_import(&fx.root, &inside).unwrap_err(),
        "不能从插件库里面导入插件"
    );
}

// 与文件夹导入同一条路：同名覆盖、新的没有标记、之后的同步（plugin_library_dir 里调用）不会盖回。
#[test]
fn zip_import_over_the_bundled_plugin_drops_the_marker_and_sync_keeps_the_import() {
    let fx = fixture();
    ensure_library_root(&fx.root).unwrap();
    sync_bundled_plugins(&fx.root).expect("sync");
    let archive = zip_path(&fx);
    write(
        &archive,
        &zip_bytes(&[
            ZipEntry::File("起书基础包/技能/立项流程.md", "作者的版本".as_bytes()),
            // 压缩包里带的标记不是文本文件，进不了暂存，导入的插件冒充不了自带插件。
            ZipEntry::File(
                "起书基础包/.storyforge-bundled",
                STARTER_PLUGIN_VERSION.as_bytes(),
            ),
        ]),
    );
    let staged = stage_import(&fx.root, &archive).expect("stage zip");
    assert_eq!(paths(&staged.files), vec!["技能/立项流程.md"]);
    assert_eq!(
        staged.skipped,
        skipped(&[(BUNDLED_MARKER, REASON_NOT_TEXT)])
    );
    commit_import(&fx.root, &staged.stage_id, STARTER_PLUGIN_NAME).expect("commit");

    assert_eq!(files_under(&starter(&fx.root)), vec!["技能/立项流程.md"]);
    let trashed = trash_entries(&fx.root);
    assert_eq!(trashed.len(), 1);
    assert_trashed_as(&trashed[0], STARTER_PLUGIN_NAME);
    assert!(fx
        .root
        .join(TRASH_DIR)
        .join(&trashed[0])
        .join(BUNDLED_MARKER)
        .is_file());

    sync_bundled_plugins(&fx.root).expect("sync after import");
    assert_eq!(
        fs::read_to_string(starter_file(&fx.root, "技能/立项流程.md")).unwrap(),
        "作者的版本"
    );
    assert_eq!(files_under(&starter(&fx.root)), vec!["技能/立项流程.md"]);
    assert_eq!(trash_entries(&fx.root).len(), 1);

    remove_plugin(&fx.root, STARTER_PLUGIN_NAME).expect("an imported copy can be removed");
    assert!(!starter(&fx.root).exists());
    assert_eq!(trash_entries(&fx.root).len(), 2);
}
