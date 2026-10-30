use super::*;
use tempfile::TempDir;

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

    assert!(stage_import(&fx.root, Path::new("relative/source"))
        .unwrap_err()
        .contains("完整路径"));
    assert!(stage_import(&fx.root, &fx.source.join("missing"))
        .unwrap_err()
        .contains("不存在"));
    assert!(stage_import(&fx.root, &fx.source.join("a.md"))
        .unwrap_err()
        .contains("不是文件夹"));
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
    let staged = stage_import_with_scan_limit(&fx.root, &fx.source, 5).expect("five entries fit");
    assert_eq!(paths(&staged.files), vec!["a.md", "sub/c.md"]);

    write(&fx.source.join("d.md"), b"d");
    let error =
        stage_import_with_scan_limit(&fx.root, &fx.source, 5).expect_err("six entries must fail");
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
