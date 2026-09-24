use super::*;
use serde_json::json;

fn request(key: Option<&str>, clear: bool) -> SaveLlmConfigRequest {
    serde_json::from_value(
        json!({"provider":"openai-compatible","baseUrl":"https://example.invalid/v1",
        "model":"test-model","apiKey":key,"clearApiKey":clear}),
    )
    .unwrap()
}

#[test]
fn missing_configuration_is_initialized_without_secrets() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("llm-provider.json");
    prepare(&path).unwrap();
    let value: serde_json::Value = serde_json::from_slice(&fs::read(path).unwrap()).unwrap();
    assert_eq!(value["schemaVersion"], 2);
    assert!(value["apiKey"].is_null());
}

#[cfg(windows)]
#[test]
fn legacy_both_slots_migrate_atomically_and_idempotently() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("llm-provider.json");
    let mut legacy = json!({"provider":"openai-compatible","baseUrl":"https://example.invalid/v1",
        "model":"test-model","apiKey":"main-test-sentinel", "extraSetting":17});
    legacy["polish"] = json!({"provider":"gemini","baseUrl":"https://polish.invalid","model":"p",
        "apiKey":"polish-test-sentinel"});
    fs::write(&path, legacy.to_string()).unwrap();
    prepare(&path).unwrap();
    let bytes = fs::read(&path).unwrap();
    let data: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
    assert_eq!(data["schemaVersion"], 2);
    assert_eq!(data["extraSetting"], 17);
    assert!(!String::from_utf8_lossy(&bytes).contains("test-sentinel"));
    let config = load(&path).unwrap().0;
    assert_eq!(
        config.api_key.as_ref().unwrap().reveal().unwrap(),
        "main-test-sentinel"
    );
    assert_eq!(
        config
            .polish
            .as_ref()
            .unwrap()
            .api_key
            .as_ref()
            .unwrap()
            .reveal()
            .unwrap(),
        "polish-test-sentinel"
    );
    prepare(&path).unwrap();
    assert_eq!(fs::read(&path).unwrap(), bytes);
    assert_eq!(fs::read_dir(dir.path()).unwrap().count(), 1);
    let response = serde_json::to_string(&read(&path).unwrap()).unwrap();
    assert!(!response.contains("ciphertext") && !response.contains("test-sentinel"));
}

#[cfg(windows)]
#[test]
fn save_keep_clear_and_recover_corrupted_key() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("llm-provider.json");
    save(&path, request(Some("main-test-sentinel"), false)).unwrap();
    let before = fs::read(&path).unwrap();
    save(&path, request(Some("  "), false)).unwrap();
    assert_eq!(fs::read(&path).unwrap(), before);
    let mut data: serde_json::Value = serde_json::from_slice(&before).unwrap();
    data["apiKey"]["ciphertext"] = json!("AAAA");
    fs::write(&path, data.to_string()).unwrap();
    assert!(load(&path).unwrap().0.api_key.unwrap().reveal().is_err());
    save(&path, request(Some("replacement-test-sentinel"), false)).unwrap();
    assert_eq!(
        load(&path).unwrap().0.api_key.unwrap().reveal().unwrap(),
        "replacement-test-sentinel"
    );
    save(&path, request(None, true)).unwrap();
    assert!(!read(&path).unwrap().has_api_key);
    assert!(load(&path).unwrap().0.api_key.is_none());
}

#[test]
fn invalid_versions_and_plaintext_v2_do_not_mutate_or_echo() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("llm-provider.json");
    for raw in [
        r#"{"schemaVersion":99}"#,
        r#"{"schemaVersion":"2"}"#,
        r#"{"schemaVersion":null}"#,
        r#"{"schemaVersion":2,"provider":"p","baseUrl":"b","model":"m","apiKey":"private-test-value"}"#,
    ] {
        fs::write(&path, raw).unwrap();
        let error = prepare(&path).unwrap_err();
        assert!(!format!("{error:#}").contains("private-test-value"));
        assert_eq!(fs::read_to_string(&path).unwrap(), raw);
    }
}

#[test]
fn failed_atomic_replace_preserves_target_and_cleans_staging() {
    let dir = tempfile::tempdir().unwrap();
    let target = dir.path().join("target");
    fs::create_dir(&target).unwrap();
    fs::write(target.join("untouched"), "keep").unwrap();
    assert!(write(&target, &StoredLlmConfig::default()).is_err());
    assert_eq!(
        fs::read_to_string(target.join("untouched")).unwrap(),
        "keep"
    );
    assert_eq!(fs::read_dir(dir.path()).unwrap().count(), 1);
}

#[cfg(windows)]
#[test]
fn malformed_second_legacy_slot_leaves_original_bytes_untouched() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("llm-provider.json");
    let raw = r#"{"provider":"p","baseUrl":"b","model":"m","apiKey":"main-test-sentinel","polish":{"provider":"p","baseUrl":"b","model":"m","apiKey":42}}"#;
    fs::write(&path, raw).unwrap();
    assert!(prepare(&path).is_err());
    assert_eq!(fs::read_to_string(&path).unwrap(), raw);
    assert_eq!(fs::read_dir(dir.path()).unwrap().count(), 1);
}

#[cfg(windows)]
#[test]
fn locked_destination_keeps_original_and_cleans_encrypted_staging() {
    use std::os::windows::fs::OpenOptionsExt;
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("llm-provider.json");
    fs::write(&path, "original-test-bytes").unwrap();
    let lock = fs::OpenOptions::new()
        .read(true)
        .share_mode(0)
        .open(&path)
        .unwrap();
    assert!(write(&path, &StoredLlmConfig::default()).is_err());
    drop(lock);
    assert_eq!(fs::read_to_string(&path).unwrap(), "original-test-bytes");
    assert_eq!(fs::read_dir(dir.path()).unwrap().count(), 1);
}

#[cfg(windows)]
#[test]
fn rust_saved_keys_are_resolved_live_by_python() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("llm-provider.json");
    let mut payload = request(Some("main-test-sentinel"), false);
    payload.polish = Some(
        serde_json::from_value(json!({"provider":"gemini",
        "baseUrl":"https://polish.invalid/v1","model":"polish-test-model",
        "apiKey":"polish-test-sentinel"}))
        .unwrap(),
    );
    save(&path, payload).unwrap();
    let api = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../api");
    let output = std::process::Command::new(api.join(".venv/Scripts/python.exe"))
        .current_dir(&api)
        .args(["-m", "tests.llm_config_interop_probe"])
        .arg(&path)
        .output()
        .expect("native interop requires the API .venv Python");
    assert!(
        output.status.success(),
        "Python native interop failed: {}",
        String::from_utf8_lossy(&output.stderr)
    );
    assert_eq!(
        String::from_utf8_lossy(&output.stdout).trim(),
        "DPAPI_INTEROP_OK"
    );
}

#[cfg(windows)]
#[test]
fn polish_save_and_clear_never_modify_main_key() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("llm-provider.json");
    save(&path, request(Some("main-test-sentinel"), false)).unwrap();
    let original = load(&path).unwrap().0.api_key.unwrap().reveal().unwrap();
    let mut payload = request(None, false);
    payload.polish = Some(
        serde_json::from_value(
            json!({"provider":"gemini", "baseUrl":"https://polish.invalid",
        "model":"polish", "apiKey":"polish-test-sentinel"}),
        )
        .unwrap(),
    );
    save(&path, payload).unwrap();
    let mut clear = request(None, false);
    clear.polish = Some(
        serde_json::from_value(
            json!({"provider":"gemini", "baseUrl":"https://polish.invalid",
        "model":"polish", "clearApiKey":true}),
        )
        .unwrap(),
    );
    save(&path, clear).unwrap();
    let stored = load(&path).unwrap().0;
    assert_eq!(stored.api_key.unwrap().reveal().unwrap(), original);
    assert!(stored.polish.unwrap().api_key.is_none());
}

#[cfg(windows)]
#[test]
fn second_slot_protection_failure_aborts_entire_migration() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("llm-provider.json");
    let slot = json!({"provider":"p", "baseUrl":"https://example.invalid", "model":"m", "apiKey":"test-sentinel"});
    let mut data = slot.clone();
    data["polish"] = slot;
    let raw = data.to_string();
    fs::write(&path, &raw).unwrap();
    let calls = std::cell::Cell::new(0);
    let protect = |key: &str| -> Result<ProtectedKey> {
        calls.set(calls.get() + 1);
        if calls.get() == 2 {
            bail!("injected protection failure");
        }
        ProtectedKey::protect(key)
    };
    assert!(prepare_with_protector(&path, &protect).is_err());
    assert_eq!(calls.get(), 2);
    assert_eq!(fs::read_to_string(&path).unwrap(), raw);
    assert_eq!(fs::read_dir(dir.path()).unwrap().count(), 1);
}

#[cfg(windows)]
#[test]
fn single_legacy_slot_preserves_optional_polish_absence() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("llm-provider.json");
    fs::write(
        &path,
        r#"{"provider":"p","baseUrl":"b","model":"m","apiKey":"test-sentinel"}"#,
    )
    .unwrap();
    let response = read(&path).unwrap();
    assert!(response.has_api_key);
    assert!(response.polish.is_none());
    assert!(!fs::read_to_string(&path).unwrap().contains("test-sentinel"));
}

#[cfg(windows)]
#[test]
fn two_unreadable_keys_can_be_replaced_independently() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("llm-provider.json");
    let slot = json!({"provider":"p", "baseUrl":"b", "model":"m",
        "apiKey":{"scheme":"windows-dpapi-user-v1", "ciphertext":"AAAA"}});
    let mut data = slot.clone();
    data["schemaVersion"] = json!(2);
    data["polish"] = slot;
    fs::write(&path, data.to_string()).unwrap();
    assert!(read(&path).unwrap().polish.is_some());
    save(&path, request(Some("new-main-test-sentinel"), false)).unwrap();
    let mut payload = request(None, false);
    payload.polish = Some(
        serde_json::from_value(json!({"provider":"p", "baseUrl":"b", "model":"m",
        "apiKey":"new-polish-test-sentinel"}))
        .unwrap(),
    );
    save(&path, payload).unwrap();
    let stored = load(&path).unwrap().0;
    assert_eq!(
        stored.api_key.unwrap().reveal().unwrap(),
        "new-main-test-sentinel"
    );
    assert_eq!(
        stored.polish.unwrap().api_key.unwrap().reveal().unwrap(),
        "new-polish-test-sentinel"
    );
}
