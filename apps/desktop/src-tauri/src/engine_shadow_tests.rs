use super::*;
use serde_json::json;

fn lines(dir: &Path, log: ShadowLog) -> Vec<String> {
    std::fs::read_to_string(dir.join(log.file_name()))
        .unwrap()
        .lines()
        .map(str::to_owned)
        .collect()
}

#[test]
fn appends_one_compact_line_per_record_to_its_own_file() {
    let dir = tempfile::tempdir().unwrap();
    let nested = dir.path().join("data");
    assert!(append(
        &nested,
        ShadowLog::Checks,
        &json!({"outcome": "match", "n": 1})
    )
    .unwrap());
    assert!(append(&nested, ShadowLog::Checks, &json!({"note": "a\nb"})).unwrap());
    assert!(append(&nested, ShadowLog::Diffs, &json!({"outcome": "diff"})).unwrap());
    assert_eq!(
        lines(&nested, ShadowLog::Checks),
        vec![r#"{"n":1,"outcome":"match"}"#, r#"{"note":"a\nb"}"#]
    );
    assert_eq!(
        lines(&nested, ShadowLog::Diffs),
        vec![r#"{"outcome":"diff"}"#]
    );
}

#[test]
fn rejects_non_objects_and_oversized_records() {
    let dir = tempfile::tempdir().unwrap();
    assert!(append(dir.path(), ShadowLog::Diffs, &json!(["x"])).is_err());
    let big = "x".repeat(MAX_RECORD_BYTES);
    assert!(append(dir.path(), ShadowLog::Diffs, &json!({ "big": big })).is_err());
    assert!(!dir.path().join(SHADOW_DIFFS_FILE).exists());
}

#[test]
fn stops_at_the_file_cap_and_keeps_earlier_lines() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join(SHADOW_CHECKS_FILE);
    std::fs::write(&path, vec![b'.'; (MAX_FILE_BYTES - 10) as usize]).unwrap();
    assert!(append(dir.path(), ShadowLog::Checks, &json!({"a": 1})).unwrap());
    assert!(!append(dir.path(), ShadowLog::Checks, &json!({"b": 2})).unwrap());
    assert_eq!(
        std::fs::metadata(&path).unwrap().len(),
        MAX_FILE_BYTES - 10 + 8
    );
}

#[test]
fn log_names_are_the_only_accepted_values() {
    assert_eq!(
        serde_json::from_value::<ShadowLog>(json!("diffs")).unwrap(),
        ShadowLog::Diffs
    );
    assert_eq!(
        serde_json::from_value::<ShadowLog>(json!("checks")).unwrap(),
        ShadowLog::Checks
    );
    assert!(serde_json::from_value::<ShadowLog>(json!("../evil")).is_err());
}
