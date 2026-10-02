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
