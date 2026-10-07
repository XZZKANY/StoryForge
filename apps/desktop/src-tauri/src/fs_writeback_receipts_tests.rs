use super::*;
use std::sync::{Arc, Barrier};
use tempfile::TempDir;

fn fixture() -> (TempDir, String, WritebackRequest) {
    let temp = TempDir::new().unwrap();
    let root = temp.path().to_string_lossy().to_string();
    let target = temp.path().join("chapter.md");
    fs::write(&target, "before\r\n").unwrap();
    let request = WritebackRequest {
        operation_key: "patch-1:whole".into(),
        source: "immutable proposal".into(),
        path: target.to_string_lossy().to_string(),
        content: "after\n".into(),
    };
    (temp, root, request)
}
fn baseline() -> DiskBaseline {
    DiskBaseline::Content {
        content: "before\r\n".into(),
    }
}
fn apply(root: &str, request: &WritebackRequest) -> WritebackReceipt {
    write_file_with_receipt(root.into(), request.clone(), baseline(), Some(7)).unwrap()
}
#[test]
fn fresh_inspect_and_duplicate_return_persistent_receipt_without_applying_again() {
    let (_temp, root, request) = fixture();
    assert!(inspect_writeback_receipt(root.clone(), request.clone())
        .unwrap()
        .is_none());
    let first = apply(&root, &request);
    assert_eq!(first.state, "applied");
    assert!(first.receipt_persisted);
    // Simulate another process/reopen: no in-memory receipt cache survives or participates.
    fs::write(&request.path, "author kept writing").unwrap();
    let second = apply(&root, &request);
    assert_eq!(first.operation_id, second.operation_id);
    assert_eq!(second.current, "diverged");
    assert_eq!(
        fs::read_to_string(&request.path).unwrap(),
        "author kept writing"
    );
}
#[test]
fn interrupted_intent_never_replays_even_after_an_aba_to_before() {
    let (_temp, root, request) = fixture();
    let location = resolve(&root, &request).unwrap();
    let failed = apply_with(&root, &request, baseline(), Some(7), |_| {
        fs::write(&request.path, &request.content).unwrap();
        fs::create_dir(record_path(&location, "outcome")).unwrap();
        Ok(())
    })
    .unwrap();
    assert_eq!(failed.state, "applied");
    assert!(!failed.receipt_persisted);
    fs::remove_dir(record_path(&location, "outcome")).unwrap();
    let matching = inspect_writeback_receipt(root.clone(), request.clone())
        .unwrap()
        .unwrap();
    assert_eq!(matching.state, "outcome_unknown");
    assert_eq!(matching.current, "after");
    fs::write(&request.path, "before\r\n").unwrap();
    let unknown = apply(&root, &request);
    assert_eq!(unknown.state, "outcome_unknown");
    assert_eq!(unknown.current, "before");
    assert_eq!(fs::read_to_string(&request.path).unwrap(), "before\r\n");
}
#[test]
fn same_identity_different_payload_is_rejected_before_mutation() {
    let (_temp, root, mut request) = fixture();
    apply(&root, &request);
    request.content = "another after".into();
    assert!(
        write_file_with_receipt(root, request.clone(), baseline(), None)
            .unwrap_err()
            .contains("身份冲突")
    );
    assert_eq!(fs::read_to_string(request.path).unwrap(), "after\n");
}
#[test]
fn pre_dispatch_drift_is_definitely_not_written_and_has_no_claim() {
    let (_temp, root, request) = fixture();
    fs::write(&request.path, "external").unwrap();
    assert!(
        write_file_with_receipt(root.clone(), request.clone(), baseline(), Some(7))
            .unwrap_err()
            .contains("磁盘内容已变化")
    );
    assert!(inspect_writeback_receipt(root, request.clone())
        .unwrap()
        .is_none());
    assert_eq!(fs::read_to_string(request.path).unwrap(), "external");
}
#[test]
fn dispatch_rejection_has_distinct_persisted_not_written_outcome() {
    let (_temp, root, request) = fixture();
    let rejected = apply_with(&root, &request, baseline(), Some(7), |_| {
        Err("drift before rename".into())
    })
    .unwrap();
    assert_eq!(rejected.state, "not_written");
    assert!(rejected.receipt_persisted);
    assert_eq!(apply(&root, &request).state, "not_written");
    assert_eq!(fs::read_to_string(request.path).unwrap(), "before\r\n");
}
#[test]
fn concurrent_same_operation_has_one_dispatch_owner() {
    let (_temp, root, request) = fixture();
    let barrier = Arc::new(Barrier::new(2));
    let count = Arc::new(std::sync::atomic::AtomicUsize::new(0));
    let handles: Vec<_> = (0..2)
        .map(|_| {
            let (root, request, barrier, count) = (
                root.clone(),
                request.clone(),
                barrier.clone(),
                count.clone(),
            );
            std::thread::spawn(move || {
                barrier.wait();
                apply_with(&root, &request, baseline(), Some(7), |_| {
                    count.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
                    fs::write(&request.path, &request.content).unwrap();
                    Ok(())
                })
            })
        })
        .collect();
    for handle in handles {
        let _ = handle.join().unwrap();
    }
    assert_eq!(count.load(std::sync::atomic::Ordering::SeqCst), 1);
}
#[test]
fn external_paths_and_operation_path_injection_cannot_escape_project() {
    let (_temp, root, mut request) = fixture();
    let other = TempDir::new().unwrap();
    request.path = other.path().join("outside.md").to_string_lossy().into();
    assert!(write_file_with_receipt(
        root.clone(),
        request.clone(),
        DiskBaseline::Missing {},
        None
    )
    .is_err());
    assert!(!Path::new(&request.path).exists());
    request.path = Path::new(&root).join("chapter.md").to_string_lossy().into();
    request.operation_key = "../../outside/claim".into();
    let receipt = apply(&root, &request);
    assert_eq!(receipt.operation_id.len(), 64);
    assert!(receipt
        .operation_id
        .bytes()
        .all(|byte| byte.is_ascii_hexdigit()));
}
#[test]
fn malformed_or_unwritable_intent_never_dispatches() {
    let (_temp, root, request) = fixture();
    let location = resolve(&root, &request).unwrap();
    fs::create_dir_all(&location.directory).unwrap();
    fs::write(record_path(&location, "intent"), "{partial").unwrap();
    assert!(
        write_file_with_receipt(root, request.clone(), baseline(), Some(7))
            .unwrap_err()
            .contains("结果未知")
    );
    assert_eq!(fs::read_to_string(request.path).unwrap(), "before\r\n");
}
#[test]
fn missing_file_is_distinct_from_existing_empty_file() {
    let (_temp, root, mut request) = fixture();
    fs::remove_file(&request.path).unwrap();
    request.content.clear();
    let receipt = write_file_with_receipt(
        root.clone(),
        request.clone(),
        DiskBaseline::Missing {},
        Some(7),
    )
    .unwrap();
    assert!(receipt.created_file);
    assert_eq!(receipt.current, "after");
    assert_eq!(fs::read_to_string(request.path).unwrap(), "");
}
#[test]
fn child_process_receipt_probe() {
    let Ok(root) = std::env::var("STORYFORGE_RECEIPT_CHILD_ROOT") else {
        return;
    };
    let request = WritebackRequest {
        operation_key: "patch-1:whole".into(),
        source: "immutable proposal".into(),
        path: Path::new(&root).join("chapter.md").to_string_lossy().into(),
        content: "after\n".into(),
    };
    let receipt = apply(&root, &request);
    assert_eq!(receipt.state, "applied");
    assert_eq!(receipt.current, "diverged");
    assert_eq!(
        fs::read_to_string(request.path).unwrap(),
        "author kept writing"
    );
}
#[test]
fn new_process_reads_persistent_receipt_and_refuses_second_apply() {
    let (_temp, root, request) = fixture();
    apply(&root, &request);
    fs::write(&request.path, "author kept writing").unwrap();
    let output = std::process::Command::new(std::env::current_exe().unwrap())
        .args([
            "--exact",
            "fs_writeback_receipts::tests::child_process_receipt_probe",
            "--nocapture",
        ])
        .env("STORYFORGE_RECEIPT_CHILD_ROOT", &root)
        .output()
        .unwrap();
    assert!(
        output.status.success(),
        "{}\n{}",
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    );
    assert_eq!(
        fs::read_to_string(request.path).unwrap(),
        "author kept writing"
    );
}

#[test]
fn audit_exclusive_create_preserves_existing_complete_or_partial_bytes() {
    let (_temp, root, request) = fixture();
    let receipt = apply(&root, &request);
    let path = Path::new(&root)
        .join(".storyforge/author-loop")
        .join(format!("{}.md", receipt.operation_id));
    create_writeback_audit(
        root.clone(),
        receipt.operation_id.clone(),
        "complete first payload".into(),
    )
    .unwrap();
    create_writeback_audit(
        root.clone(),
        receipt.operation_id.clone(),
        "conflicting retry".into(),
    )
    .unwrap();
    assert_eq!(fs::read_to_string(&path).unwrap(), "complete first payload");
    fs::write(&path, "partial envelope").unwrap();
    create_writeback_audit(
        root,
        receipt.operation_id,
        "repair must not overwrite corruption".into(),
    )
    .unwrap();
    assert_eq!(fs::read_to_string(&path).unwrap(), "partial envelope");
}

#[test]
fn concurrent_audit_writers_cannot_overwrite_each_other() {
    let (_temp, root, request) = fixture();
    let operation_id = apply(&root, &request).operation_id;
    let barrier = Arc::new(Barrier::new(2));
    let threads: Vec<_> = ["first", "second"]
        .into_iter()
        .map(|text| {
            let (root, operation_id, barrier) =
                (root.clone(), operation_id.clone(), barrier.clone());
            std::thread::spawn(move || {
                barrier.wait();
                create_writeback_audit(root, operation_id, text.into())
            })
        })
        .collect();
    for thread in threads {
        thread.join().unwrap().unwrap();
    }
    let path = Path::new(&root)
        .join(".storyforge/author-loop")
        .join(format!("{operation_id}.md"));
    let value = fs::read_to_string(path).unwrap();
    assert!(value == "first" || value == "second");
}

#[test]
fn audit_path_injection_and_unwritable_record_are_rejected() {
    let (_temp, root, request) = fixture();
    for id in ["../chapter", "", "abc.md"] {
        assert!(create_writeback_audit(root.clone(), id.into(), "bad".into()).is_err());
    }
    let operation_id = apply(&root, &request).operation_id;
    let path = Path::new(&root)
        .join(".storyforge/author-loop")
        .join(format!("{operation_id}.md"));
    fs::create_dir_all(&path).unwrap();
    assert!(create_writeback_audit(root, operation_id, "bad".into()).is_err());
    assert!(path.is_dir());
}

#[test]
fn applied_but_unreadable_target_has_explicit_current_state() {
    let (_temp, root, request) = fixture();
    let receipt = apply_with(&root, &request, baseline(), None, |_| {
        fs::remove_file(&request.path).unwrap();
        fs::create_dir(&request.path).unwrap();
        Ok(())
    })
    .unwrap();
    assert_eq!(receipt.state, "applied");
    assert_eq!(receipt.current, "unreadable");
    let json = serde_json::to_value(receipt).unwrap();
    assert_eq!(json["current"], "unreadable");
    let recovered = inspect_writeback_receipt(root, request).unwrap().unwrap();
    assert_eq!(recovered.state, "applied");
    assert_eq!(recovered.current, "unreadable");
}

#[test]
fn described_identity_matches_v1_disk_golden_without_admission() {
    let vectors: Vec<serde_json::Value> =
        serde_json::from_str(include_str!("../test-fixtures/writeback-receipt-v1.json")).unwrap();
    for vector in vectors {
        let temp = TempDir::new().unwrap();
        let root = temp.path().to_string_lossy().to_string();
        let target = temp.path().join(vector["relativePath"].as_str().unwrap());
        let before = vector["before"].as_str().unwrap();
        fs::write(&target, before).unwrap();
        let request = WritebackRequest {
            operation_key: vector["operationKey"].as_str().unwrap().into(),
            source: vector["source"].as_str().unwrap().into(),
            path: target.to_string_lossy().to_string(),
            content: vector["content"].as_str().unwrap().into(),
        };
        let described = describe_writeback_operation(root.clone(), request.clone()).unwrap();
        assert_eq!(
            serde_json::to_value(&described).unwrap(),
            vector["identity"]
        );
        assert!(!temp.path().join(".storyforge").exists());
        assert_eq!(fs::read(&target).unwrap(), before.as_bytes());
        let receipt = write_file_with_receipt(
            root.clone(),
            request.clone(),
            DiskBaseline::Content {
                content: before.into(),
            },
            Some(7),
        )
        .unwrap();
        assert_eq!(receipt.operation_id, described.operation_id);
        let location = resolve(&root, &request).unwrap();
        for suffix in ["intent", "outcome"] {
            let actual: serde_json::Value =
                serde_json::from_slice(&fs::read(record_path(&location, suffix)).unwrap()).unwrap();
            assert_eq!(actual, vector[suffix]);
        }
    }
}

#[test]
fn describe_reuses_identity_across_projects_but_binds_changed_content() {
    let (_a, root_a, request_a) = fixture();
    let (b, root_b, mut request_b) = fixture();
    let a = describe_writeback_operation(root_a.clone(), request_a.clone()).unwrap();
    let same = describe_writeback_operation(root_b.clone(), request_b.clone()).unwrap();
    assert_eq!(a.operation_id, same.operation_id);
    assert_eq!(a.fingerprint, same.fingerprint);
    request_b.content.push_str("changed");
    let changed = describe_writeback_operation(root_b.clone(), request_b.clone()).unwrap();
    assert_eq!(same.operation_id, changed.operation_id);
    assert_ne!(same.fingerprint, changed.fingerprint);
    request_b.path = Path::new(&root_a)
        .join("chapter.md")
        .to_string_lossy()
        .into();
    assert!(describe_writeback_operation(root_b, request_b).is_err());
    assert!(!b.path().join(".storyforge").exists());
}

/// D04：写回成功必须失效 canon 正文派生缓存；proposals.json（待决提案草稿）不在此列。
#[test]
fn applied_writeback_invalidates_canon_derived_presence_and_observation_caches() {
    let (_temp, root, request) = fixture();
    let derived = Path::new(&root)
        .join(".storyforge")
        .join("canon")
        .join("derived");
    fs::create_dir_all(&derived).unwrap();
    for name in CANON_DERIVED_INVALIDATION_NAMES {
        fs::write(derived.join(name), "stale derived snapshot").unwrap();
    }
    fs::write(derived.join("proposals.json"), "pending author proposals").unwrap();

    let receipt = apply(&root, &request);
    assert_eq!(receipt.state, "applied");
    assert!(receipt.detail.is_none(), "派生缓存失效不得给写回掺入错误");

    for name in CANON_DERIVED_INVALIDATION_NAMES {
        assert!(!derived.join(name).exists(), "{name} 应随正文写回失效");
    }
    assert_eq!(
        fs::read_to_string(derived.join("proposals.json")).unwrap(),
        "pending author proposals",
        "待决提案草稿不是正文派生，不得删除"
    );
}

/// 失效机制不得在写回失败（not_written）时触发：正文没变，缓存仍然有效。
#[test]
fn rejected_writeback_keeps_canon_derived_caches() {
    let (_temp, root, request) = fixture();
    let derived = Path::new(&root)
        .join(".storyforge")
        .join("canon")
        .join("derived");
    fs::create_dir_all(&derived).unwrap();
    fs::write(derived.join("presence.json"), "still valid presence").unwrap();

    let rejected = apply_with(&root, &request, baseline(), Some(7), |_| {
        Err("drift before rename".into())
    })
    .unwrap();
    assert_eq!(rejected.state, "not_written");
    assert_eq!(
        fs::read_to_string(derived.join("presence.json")).unwrap(),
        "still valid presence",
        "正文未落盘时不得失效派生缓存"
    );
}

/// 项目里没有 canon 目录时失效是 no-op，不创建任何东西、不报错。
#[test]
fn invalidation_is_noop_without_canon_directory() {
    let (_temp, root, request) = fixture();
    let receipt = apply(&root, &request);
    assert_eq!(receipt.state, "applied");
    assert!(!Path::new(&root).join(".storyforge").join("canon").exists());
}

#[test]
fn failed_cache_invalidation_retries_without_replaying_body_and_persists_repair() {
    let (_temp, root, request) = fixture();
    let derived = Path::new(&root).join(".storyforge/canon/derived");
    fs::create_dir_all(derived.join("presence.json")).unwrap();
    fs::write(derived.join("observations.json"), "stale").unwrap();
    fs::write(derived.join("proposals.json"), "author draft").unwrap();
    let first = apply(&root, &request);
    assert_eq!(first.state, "applied");
    assert!(first.receipt_persisted);
    assert!(first.detail.unwrap().starts_with(CANON_INVALIDATION_WARNING));
    assert!(derived.join("observations.json").exists());
    // 失败原因仍在：只重试清理，任何正文 dispatch 都让测试失败。
    let failed_retry = apply_with(&root, &request, baseline(), Some(7), |_| {
        panic!("缓存修复不得再次写正文")
    })
    .unwrap();
    assert!(failed_retry.detail.unwrap().starts_with(CANON_INVALIDATION_WARNING));
    fs::remove_dir(derived.join("presence.json")).unwrap();
    fs::write(&request.path, "author continued").unwrap();
    let repaired = apply_with(&root, &request, baseline(), Some(7), |_| {
        panic!("缓存修复不得再次写正文")
    })
    .unwrap();
    assert_eq!(repaired.state, "applied");
    assert_eq!(repaired.current, "diverged");
    assert!(repaired.detail.is_none());
    assert!(!derived.join("observations.json").exists());
    assert_eq!(fs::read_to_string(&request.path).unwrap(), "author continued");
    assert_eq!(
        fs::read_to_string(derived.join("proposals.json")).unwrap(),
        "author draft"
    );
    assert!(inspect_writeback_receipt(root.clone(), request.clone())
        .unwrap()
        .unwrap()
        .detail
        .is_none());
    // 补记成功后再请求不会删除随后重建的新缓存。
    fs::write(derived.join("presence.json"), "fresh").unwrap();
    assert!(apply(&root, &request).detail.is_none());
    assert_eq!(
        fs::read_to_string(derived.join("presence.json")).unwrap(),
        "fresh"
    );
}

#[test]
fn cache_repair_command_rejects_missing_unknown_and_not_written_without_body_changes() {
    let (_temp, root, request) = fixture();
    assert!(repair_writeback_canon_cache(root.clone(), request.clone()).is_err());
    let location = resolve(&root, &request).unwrap();
    apply_with(&root, &request, baseline(), Some(7), |_| {
        Err("rejected".into())
    })
    .unwrap();
    assert!(repair_writeback_canon_cache(root.clone(), request.clone()).is_err());
    fs::remove_file(record_path(&location, "outcome")).unwrap();
    assert!(repair_writeback_canon_cache(root, request.clone()).is_err());
    assert_eq!(fs::read_to_string(request.path).unwrap(), "before\r\n");
}

#[test]
fn cache_repair_replaces_corrupt_maintenance_marker_but_never_changes_body_outcome() {
    let (_temp, root, request) = fixture();
    let derived = Path::new(&root).join(".storyforge/canon/derived");
    fs::create_dir_all(derived.join("presence.json")).unwrap();
    apply(&root, &request);
    let location = resolve(&root, &request).unwrap();
    let original = fs::read(record_path(&location, "outcome")).unwrap();
    fs::write(record_path(&location, "canon-invalidation"), "{partial").unwrap();
    assert!(inspect(&location).unwrap().unwrap().detail.is_some());
    let mismatched = Outcome {
        schema_version: 1,
        operation_id: location.operation_id.clone(),
        fingerprint: "wrong operation payload".into(),
        state: "invalidated".into(),
        detail: None,
    };
    fs::write(
        record_path(&location, "canon-invalidation"),
        serde_json::to_vec(&mismatched).unwrap(),
    ).unwrap();
    assert!(inspect(&location).unwrap().unwrap().detail.is_some());
    fs::remove_dir(derived.join("presence.json")).unwrap();
    let repaired = repair_writeback_canon_cache(root, request.clone()).unwrap();
    assert!(repaired.detail.is_none());
    assert!(inspect(&location).unwrap().unwrap().detail.is_none());
    assert_eq!(fs::read(record_path(&location, "outcome")).unwrap(), original);
    assert_eq!(fs::read_to_string(request.path).unwrap(), "after\n");
}

#[test]
fn concurrent_cache_only_repairs_settle_without_touching_body_or_original_outcome() {
    let (_temp, root, request) = fixture();
    let derived = Path::new(&root).join(".storyforge/canon/derived");
    fs::create_dir_all(derived.join("presence.json")).unwrap();
    apply(&root, &request);
    fs::remove_dir(derived.join("presence.json")).unwrap();
    fs::write(derived.join("presence.json"), "stale").unwrap();
    let location = resolve(&root, &request).unwrap();
    let original = fs::read(record_path(&location, "outcome")).unwrap();
    let barrier = Arc::new(Barrier::new(2));
    let handles: Vec<_> = (0..2)
        .map(|_| {
            let (root, request, barrier) = (root.clone(), request.clone(), barrier.clone());
            std::thread::spawn(move || {
                barrier.wait();
                repair_writeback_canon_cache(root, request).unwrap()
            })
        })
        .collect();
    for handle in handles {
        let receipt = handle.join().unwrap();
        assert_eq!(receipt.state, "applied");
        assert!(receipt.detail.is_none());
    }
    assert_eq!(fs::read(record_path(&location, "outcome")).unwrap(), original);
    assert_eq!(fs::read_to_string(request.path).unwrap(), "after\n");
}

#[cfg(windows)]
#[test]
fn cache_repair_keeps_warning_when_cache_is_locked() {
    use std::os::windows::fs::OpenOptionsExt;
    let (_temp, root, request) = fixture();
    let derived = Path::new(&root).join(".storyforge/canon/derived");
    fs::create_dir_all(derived.join("presence.json")).unwrap();
    apply(&root, &request);
    fs::remove_dir(derived.join("presence.json")).unwrap();
    let cache = derived.join("presence.json");
    fs::write(&cache, "still present").unwrap();
    let locked = fs::OpenOptions::new().read(true).share_mode(0).open(&cache).unwrap();
    let location = resolve(&root, &request).unwrap();
    let original = fs::read(record_path(&location, "outcome")).unwrap();
    let receipt = repair_writeback_canon_cache(root, request.clone()).unwrap();
    drop(locked);
    assert!(receipt.detail.unwrap().starts_with(CANON_INVALIDATION_WARNING));
    assert_eq!(fs::read_to_string(&cache).unwrap(), "still present");
    assert!(!record_path(&location, "canon-invalidation").exists());
    assert_eq!(fs::read(record_path(&location, "outcome")).unwrap(), original);
    assert_eq!(fs::read_to_string(request.path).unwrap(), "after\n");
}

#[cfg(windows)]
#[test]
fn cache_invalidation_rejects_external_junction_without_deleting_outside_cache() {
    let (_temp, root, request) = fixture();
    let outside = TempDir::new().unwrap();
    let outside_cache = outside.path().join("presence.json");
    fs::write(&outside_cache, "outside cache").unwrap();
    let canon = Path::new(&root).join(".storyforge").join("canon");
    fs::create_dir_all(&canon).unwrap();
    let linked = std::process::Command::new("cmd.exe")
        .args(["/d", "/c", "mklink", "/J"])
        .arg(canon.join("derived"))
        .arg(outside.path())
        .output()
        .unwrap();
    assert!(linked.status.success(), "{:?}", linked);
    let receipt = apply(&root, &request);
    assert_eq!(receipt.state, "applied");
    assert!(receipt.detail.unwrap().starts_with(CANON_INVALIDATION_WARNING));
    let receipt = repair_writeback_canon_cache(root, request.clone()).unwrap();
    assert!(receipt.detail.unwrap().starts_with(CANON_INVALIDATION_WARNING));
    assert_eq!(fs::read_to_string(outside_cache).unwrap(), "outside cache");
    assert_eq!(fs::read_to_string(request.path).unwrap(), "after\n");
}
