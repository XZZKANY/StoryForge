use super::*;
use tempfile::TempDir;

fn write(root: &TempDir, target: &Path, expected: DiskBaseline) -> Result<(), String> {
    write_file_if_unchanged(
        root.path().to_string_lossy().into_owned(),
        target.to_string_lossy().into_owned(),
        "new manuscript".into(),
        expected,
    )
}

fn baseline(content: &str) -> DiskBaseline {
    DiskBaseline::Content {
        content: content.into(),
    }
}

#[test]
fn changed_disk_is_not_overwritten() {
    let root = TempDir::new().unwrap();
    let target = root.path().join("chapter.md");
    fs::write(&target, "external edit").unwrap();
    assert!(write(&root, &target, baseline("original"))
        .unwrap_err()
        .contains("磁盘内容已变化"));
    assert_eq!(fs::read_to_string(&target).unwrap(), "external edit");
    assert_eq!(fs::read_dir(root.path()).unwrap().count(), 1);
}

#[test]
fn deleted_disk_is_not_recreated() {
    let root = TempDir::new().unwrap();
    let target = root.path().join("chapter.md");
    assert!(write(&root, &target, baseline("original")).is_err());
    assert!(!target.exists());
}

#[test]
fn missing_baseline_cannot_overwrite_an_external_creation_even_when_empty() {
    for content in ["external creation", ""] {
        let root = TempDir::new().unwrap();
        let target = root.path().join("chapter.md");
        fs::write(&target, content).unwrap();
        assert!(write(&root, &target, DiskBaseline::Missing {}).is_err());
        assert_eq!(fs::read_to_string(&target).unwrap(), content);
    }
}

#[test]
fn existing_empty_file_is_a_valid_content_baseline() {
    let root = TempDir::new().unwrap();
    let target = root.path().join("chapter.md");
    fs::write(&target, "").unwrap();
    write(&root, &target, baseline("")).unwrap();
    assert_eq!(fs::read_to_string(&target).unwrap(), "new manuscript");
}

#[test]
fn matching_raw_content_and_missing_nested_path_can_be_written() {
    let root = TempDir::new().unwrap();
    let target = root.path().join("chapter.md");
    fs::write(&target, "line1\r\nline2").unwrap();
    write(&root, &target, baseline("line1\r\nline2")).unwrap();
    let new_target = root.path().join("new/second.md");
    write(&root, &new_target, DiskBaseline::Missing {}).unwrap();
    assert_eq!(fs::read_to_string(&new_target).unwrap(), "new manuscript");
    assert_eq!(fs::read_dir(root.path()).unwrap().count(), 2);
}

#[test]
fn eol_only_external_change_is_still_a_disk_change() {
    let root = TempDir::new().unwrap();
    let target = root.path().join("chapter.md");
    fs::write(&target, "line1\nline2").unwrap();
    assert!(write(&root, &target, baseline("line1\r\nline2")).is_err());
    assert_eq!(fs::read_to_string(&target).unwrap(), "line1\nline2");
}

#[test]
fn conditional_write_still_rejects_project_escape() {
    let root = TempDir::new().unwrap();
    let outside = TempDir::new().unwrap();
    let target = outside.path().join("outside.md");
    assert!(write(&root, &target, DiskBaseline::Missing {}).is_err());
    assert!(!target.exists());
}

#[test]
fn disk_baseline_contract_rejects_unknown_or_incomplete_variants() {
    for value in [
        r#"{"kind":"missing","content":""}"#,
        r#"{"kind":"content"}"#,
        r#"{"kind":"other"}"#,
    ] {
        assert!(serde_json::from_str::<DiskBaseline>(value).is_err());
    }
}

#[test]
fn changes_after_staging_reject_commit_and_cleanup_only_staged_file() {
    for change in ["modify", "delete", "create-empty"] {
        let root = TempDir::new().unwrap();
        let canonical_root = fs::canonicalize(root.path()).unwrap();
        let target = root.path().join("chapter.md");
        let expected = if change == "create-empty" {
            DiskBaseline::Missing {}
        } else {
            fs::write(&target, "original").unwrap();
            baseline("original")
        };
        check_disk_baseline(&target, &expected).unwrap();
        let staged = stage_atomic_write(&target, b"new manuscript").unwrap();
        match change {
            "modify" => fs::write(&target, "external").unwrap(),
            "delete" => fs::remove_file(&target).unwrap(),
            _ => fs::write(&target, "").unwrap(),
        }
        assert!(
            commit_staged_write_if_unchanged(&canonical_root, &target, &staged, &expected).is_err()
        );
        assert!(!staged.exists());
        if change == "delete" {
            assert!(!target.exists());
        } else {
            assert_eq!(
                fs::read_to_string(&target).unwrap(),
                if change == "modify" { "external" } else { "" }
            );
        }
    }
}

#[test]
fn failed_commit_preserves_target_and_cleans_staged_file() {
    let root = TempDir::new().unwrap();
    let canonical_root = fs::canonicalize(root.path()).unwrap();
    let target = root.path().join("chapter.md");
    fs::create_dir(&target).unwrap();
    let staged = stage_atomic_write(&target, b"new manuscript").unwrap();
    assert!(commit_staged_write_if_unchanged(
        &canonical_root,
        &target,
        &staged,
        &DiskBaseline::Missing {}
    )
    .is_err());
    assert!(target.is_dir());
    assert!(!staged.exists());
}

#[test]
fn rejected_commit_does_not_cleanup_through_a_retargeted_parent() {
    let project = TempDir::new().unwrap();
    let outside = TempDir::new().unwrap();
    let canonical_root = fs::canonicalize(project.path()).unwrap();
    let parent = project.path().join("chapters");
    fs::create_dir(&parent).unwrap();
    let target = parent.join("chapter.md");
    let staged = stage_atomic_write(&target, b"pending").unwrap();
    let moved = project.path().join("saved-chapters");
    fs::rename(&parent, &moved).unwrap();
    #[cfg(windows)]
    let linked = std::os::windows::fs::symlink_dir(outside.path(), &parent).or_else(|_| {
        // Windows developer-mode symlinks may be unavailable; a local junction
        // exercises the same canonical parent retarget without admin privileges.
        let output = std::process::Command::new("cmd")
            .args(["/D", "/C", "mklink", "/J"])
            .arg(&parent)
            .arg(outside.path())
            .output()?;
        if output.status.success() {
            eprintln!("retargeted-parent uses a junction fixture");
            Ok(())
        } else {
            Err(std::io::Error::other(
                String::from_utf8_lossy(&output.stderr).into_owned(),
            ))
        }
    });
    #[cfg(unix)]
    let linked = std::os::unix::fs::symlink(outside.path(), &parent);
    if let Err(error) = linked {
        eprintln!("SKIP retargeted-parent symlink fixture: {error}");
        return;
    }
    let sentinel = outside.path().join(staged.file_name().unwrap());
    fs::write(&sentinel, "external sentinel").unwrap();
    assert!(commit_staged_write_if_unchanged(
        &canonical_root,
        &target,
        &staged,
        &DiskBaseline::Missing {}
    )
    .is_err());
    assert_eq!(fs::read_to_string(&sentinel).unwrap(), "external sentinel");
    assert!(
        moved.join(staged.file_name().unwrap()).exists(),
        "unsafe cleanup leaves residue instead of deleting unrelated files"
    );
}
