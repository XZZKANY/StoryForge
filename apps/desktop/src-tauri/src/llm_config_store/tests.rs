use super::profiles::{MIGRATED_MAIN_NAME, MIGRATED_POLISH_NAME};
use super::*;
use serde_json::json;

const BASE: &str = "https://example.invalid/v1";

fn profile(id: Option<&str>, model: &str, key: Option<&str>) -> SaveLlmProfileRequest {
    serde_json::from_value(
        json!({"id": id, "name": "", "provider": "openai-compatible",
        "baseUrl": BASE, "model": model, "apiKey": key}),
    )
    .unwrap()
}

fn clear_key(id: &str, model: &str) -> SaveLlmProfileRequest {
    serde_json::from_value(
        json!({"id": id, "name": "", "provider": "openai-compatible",
        "baseUrl": BASE, "model": model, "clearApiKey": true}),
    )
    .unwrap()
}

fn with_models(id: Option<&str>, model: &str, models: &[&str]) -> SaveLlmProfileRequest {
    serde_json::from_value(
        json!({"id": id, "name": "", "provider": "openai-compatible",
        "baseUrl": BASE, "model": model, "models": models}),
    )
    .unwrap()
}

fn raw(path: &Path) -> Value {
    serde_json::from_slice(&fs::read(path).unwrap()).unwrap()
}

fn stored(path: &Path) -> StoredLlmConfig {
    load(path).unwrap().0
}

fn stored_profile<'a>(config: &'a StoredLlmConfig, id: &str) -> &'a StoredProfile {
    profiles::find(config, id).unwrap()
}

fn key_of(config: &StoredLlmConfig, id: &str) -> Option<String> {
    stored_profile(config, id)
        .api_key
        .as_ref()
        .map(|key| key.reveal().unwrap())
}

#[test]
fn missing_configuration_reads_empty_without_touching_disk() {
    let dir = tempfile::tempdir().unwrap();
    let config_dir = dir.path().join("com.storyforge.ide");
    let path = config_dir.join("llm-provider.json");
    let listed = list(&path).unwrap();
    assert!(listed.profiles.is_empty() && listed.active_profile_id.is_none());
    let slot = read_revealed_slot(&path, false).unwrap();
    assert!(slot.model.is_empty() && slot.api_key.is_none());
    assert!(!config_dir.exists(), "只读不建目录、不落默认文件");
    save_profile(&path, profile(None, "m", None)).unwrap();
    let value = raw(&path);
    assert_eq!(value["schemaVersion"], 2);
    assert!(value["apiKey"].is_null());
    assert_eq!(value["profiles"][0]["model"], "m");
}

/// 只许读、不许替换：读配置照常，原子替换（要删目标）失败。
#[cfg(windows)]
fn hold_read_only(path: &Path) -> fs::File {
    use std::os::windows::fs::OpenOptionsExt;
    const FILE_SHARE_READ: u32 = 1;
    fs::OpenOptions::new()
        .read(true)
        .share_mode(FILE_SHARE_READ)
        .open(path)
        .unwrap()
}

#[cfg(windows)]
#[test]
fn legacy_both_slots_migrate_atomically_and_idempotently() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("llm-provider.json");
    let mut legacy = json!({"provider":"openai-compatible","baseUrl":BASE,
        "model":"test-model","apiKey":"main-test-sentinel", "extraSetting":17});
    legacy["polish"] = json!({"provider":"gemini","baseUrl":"https://polish.invalid","model":"p",
        "apiKey":"polish-test-sentinel"});
    fs::write(&path, legacy.to_string()).unwrap();
    let listed = list(&path).unwrap();
    let bytes = fs::read(&path).unwrap();
    let data = raw(&path);
    assert_eq!(data["schemaVersion"], 2);
    assert_eq!(data["extraSetting"], 17);
    assert!(
        data.get("polish").is_none(),
        "旧润色槽并入多套配置后不再留在文件里"
    );
    assert!(data.get("polishProfileId").is_none(), "润色跟随当前那套");
    assert!(!String::from_utf8_lossy(&bytes).contains("test-sentinel"));
    assert_eq!(listed.active_profile_id.as_deref(), Some("p1"));
    let names: Vec<_> = listed.profiles.iter().map(|p| p.name.as_str()).collect();
    assert_eq!(names, [MIGRATED_MAIN_NAME, MIGRATED_POLISH_NAME]);
    let config = stored(&path);
    assert_eq!(key_of(&config, "p1").unwrap(), "main-test-sentinel");
    assert_eq!(key_of(&config, "p2").unwrap(), "polish-test-sentinel");
    assert_eq!(stored_profile(&config, "p2").provider, "gemini");
    // 顶层镜像当前那套：密文原样搬，不解密重加密。
    assert_eq!(data["apiKey"], data["profiles"][0]["apiKey"]);
    list(&path).unwrap();
    assert_eq!(fs::read(&path).unwrap(), bytes);
    assert_eq!(fs::read_dir(dir.path()).unwrap().count(), 1);
    let response = serde_json::to_string(&list(&path).unwrap()).unwrap();
    assert!(!response.contains("ciphertext") && !response.contains("test-sentinel"));
}

#[cfg(windows)]
#[test]
fn v2_polish_slot_ciphertext_moves_verbatim() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("llm-provider.json");
    let main = serde_json::to_value(ProtectedKey::protect("main-test-sentinel").unwrap()).unwrap();
    let polish =
        serde_json::to_value(ProtectedKey::protect("polish-test-sentinel").unwrap()).unwrap();
    let data = json!({"schemaVersion":2,"provider":"openai","baseUrl":BASE,"model":"m",
        "apiKey":main,"polish":{"provider":"anthropic","baseUrl":"https://p.invalid/v1",
        "model":"claude","apiKey":polish}});
    fs::write(&path, data.to_string()).unwrap();
    list(&path).unwrap();
    let after = raw(&path);
    assert_eq!(after["profiles"][0]["apiKey"], main);
    assert_eq!(after["profiles"][1]["apiKey"], polish);
    assert_eq!(after["profiles"][1]["name"], MIGRATED_POLISH_NAME);
}

#[cfg(windows)]
#[test]
fn legacy_polish_equal_to_main_or_incomplete_is_not_duplicated() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("llm-provider.json");
    // 同一个 key 存进两个槽：v1 迁移时各加密一次、密文不同，按明文判定为同一套。
    let slot = json!({"provider":"p","baseUrl":BASE,"model":"m","apiKey":"same-test-sentinel"});
    let mut data = slot.clone();
    data["polish"] = slot;
    fs::write(&path, data.to_string()).unwrap();
    assert_eq!(list(&path).unwrap().profiles.len(), 1);

    let incomplete = json!({"provider":"p","baseUrl":BASE,"model":"m","apiKey":"main-test-sentinel",
        "polish":{"provider":"anthropic","baseUrl":"https://p.invalid","model":"","apiKey":"x-test-sentinel"}});
    fs::write(&path, incomplete.to_string()).unwrap();
    let listed = list(&path).unwrap();
    assert_eq!(listed.profiles.len(), 1);
    assert!(!fs::read_to_string(&path).unwrap().contains("polish"));
}

#[cfg(windows)]
#[test]
fn save_keep_clear_and_recover_corrupted_key() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("llm-provider.json");
    let saved = save_profile(&path, profile(None, "m", Some("main-test-sentinel"))).unwrap();
    assert_eq!(saved.saved_profile_id, "p1");
    assert_eq!(saved.config.active_profile_id.as_deref(), Some("p1"));
    let before = fs::read(&path).unwrap();
    save_profile(&path, profile(Some("p1"), "m", Some("  "))).unwrap();
    assert_eq!(fs::read(&path).unwrap(), before);
    let mut data: Value = serde_json::from_slice(&before).unwrap();
    data["apiKey"]["ciphertext"] = json!("AAAA");
    data["profiles"][0]["apiKey"]["ciphertext"] = json!("AAAA");
    fs::write(&path, data.to_string()).unwrap();
    assert!(read_revealed_slot(&path, false).is_err());
    save_profile(
        &path,
        profile(Some("p1"), "m", Some("replacement-test-sentinel")),
    )
    .unwrap();
    assert_eq!(
        read_revealed_slot(&path, false).unwrap().api_key.as_deref(),
        Some("replacement-test-sentinel")
    );
    let cleared = save_profile(&path, clear_key("p1", "m")).unwrap();
    assert!(!cleared.config.profiles[0].has_api_key);
    assert!(stored(&path).api_key.is_none(), "顶层镜像跟着清掉");
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
        r#"{"schemaVersion":2,"provider":"p","baseUrl":"b","model":"m","apiKey":null,"profiles":[{"id":"p1","provider":"p","baseUrl":"b","model":"m","apiKey":"private-test-value"}]}"#,
        r#"{"schemaVersion":2,"provider":"p","baseUrl":"b","model":"m","apiKey":null,"profiles":[{"id":"p1","provider":"p","baseUrl":"b","model":"m","apiKey":null},{"id":"p1","provider":"q","baseUrl":"b","model":"m","apiKey":null}]}"#,
    ] {
        fs::write(&path, raw).unwrap();
        let error = list(&path).unwrap_err();
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
    let error = write(&target, &StoredLlmConfig::default())
        .unwrap_err()
        .to_string();
    assert!(error.starts_with("无法原子替换 LLM 配置，原配置未更改（系统错误 "));
    #[cfg(windows)]
    assert!(
        error.contains("系统错误 5：ERROR_ACCESS_DENIED，"),
        "{error}"
    );
    assert!(!error.contains("os error"), "系统错误码不重复两遍：{error}");
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
    assert!(list(&path).is_err());
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
    let error = write(&path, &StoredLlmConfig::default()).unwrap_err();
    assert!(error.to_string().contains("系统错误 "), "{error}");
    drop(lock);
    assert_eq!(fs::read_to_string(&path).unwrap(), "original-test-bytes");
    assert_eq!(fs::read_dir(dir.path()).unwrap().count(), 1);
}

#[cfg(windows)]
#[test]
fn second_slot_protection_failure_aborts_entire_migration() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("llm-provider.json");
    let slot = json!({"provider":"p", "baseUrl":BASE, "model":"m", "apiKey":"test-sentinel"});
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
    assert!(list_with_protector(&path, &protect).is_err());
    assert_eq!(calls.get(), 2);
    assert_eq!(fs::read_to_string(&path).unwrap(), raw);
    assert_eq!(fs::read_dir(dir.path()).unwrap().count(), 1);
}

#[cfg(windows)]
#[test]
fn single_legacy_slot_becomes_the_default_profile() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("llm-provider.json");
    fs::write(
        &path,
        r#"{"provider":"p","baseUrl":"b","model":"m","apiKey":"test-sentinel"}"#,
    )
    .unwrap();
    let response = list(&path).unwrap();
    assert_eq!(response.profiles.len(), 1);
    assert!(response.profiles[0].has_api_key);
    assert_eq!(response.profiles[0].name, MIGRATED_MAIN_NAME);
    assert_eq!(response.active_profile_id.as_deref(), Some("p1"));
    assert!(response.polish_profile_id.is_none());
    assert!(!fs::read_to_string(&path).unwrap().contains("test-sentinel"));
}

#[cfg(windows)]
#[test]
fn two_unreadable_keys_can_be_replaced_independently() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("llm-provider.json");
    let unreadable = |text: &str| json!({"scheme":"windows-dpapi-user-v1", "ciphertext":text});
    let data = json!({"schemaVersion":2,"provider":"openai-compatible","baseUrl":BASE,"model":"m",
        "apiKey":unreadable("AAAA"),"polish":{"provider":"openai-compatible","baseUrl":BASE,
        "model":"m","apiKey":unreadable("BBBB")}});
    fs::write(&path, data.to_string()).unwrap();
    assert_eq!(list(&path).unwrap().profiles.len(), 2);
    save_profile(
        &path,
        profile(Some("p1"), "m", Some("new-main-test-sentinel")),
    )
    .unwrap();
    save_profile(
        &path,
        profile(Some("p2"), "m", Some("new-polish-test-sentinel")),
    )
    .unwrap();
    let config = stored(&path);
    assert_eq!(key_of(&config, "p1").unwrap(), "new-main-test-sentinel");
    assert_eq!(key_of(&config, "p2").unwrap(), "new-polish-test-sentinel");
}

#[cfg(windows)]
#[test]
fn second_profile_keys_never_touch_the_current_one() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("llm-provider.json");
    save_profile(&path, profile(None, "main", Some("main-test-sentinel"))).unwrap();
    let top_before = raw(&path)["apiKey"].clone();
    let second = save_profile(&path, profile(None, "kimi", Some("kimi-test-sentinel"))).unwrap();
    assert_eq!(second.saved_profile_id, "p2");
    assert_eq!(second.config.active_profile_id.as_deref(), Some("p1"));
    save_profile(&path, clear_key("p2", "kimi")).unwrap();
    let data = raw(&path);
    assert_eq!(data["apiKey"], top_before);
    assert_eq!(data["model"], "main");
    let config = stored(&path);
    assert_eq!(key_of(&config, "p1").unwrap(), "main-test-sentinel");
    assert!(key_of(&config, "p2").is_none());
}

#[cfg(windows)]
#[test]
fn activate_mirrors_top_level_and_revealed_slots_follow() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("llm-provider.json");
    save_profile(&path, profile(None, "claude", Some("claude-test-sentinel"))).unwrap();
    save_profile(&path, profile(None, "kimi", Some("kimi-test-sentinel"))).unwrap();
    let listed = activate_profile(&path, "p2", None).unwrap();
    assert_eq!(listed.active_profile_id.as_deref(), Some("p2"));
    let data = raw(&path);
    assert_eq!(data["model"], "kimi");
    assert_eq!(data["apiKey"], data["profiles"][1]["apiKey"]);
    let main = read_revealed_slot(&path, false).unwrap();
    assert_eq!(main.model, "kimi");
    assert_eq!(main.api_key.as_deref(), Some("kimi-test-sentinel"));
    // 润色没指定：跟着当前那套走，不再是「未配置」。
    let polish = read_revealed_slot(&path, true).unwrap();
    assert_eq!(
        (polish.model.as_str(), polish.api_key.as_deref()),
        ("kimi", Some("kimi-test-sentinel"))
    );
    set_polish_profile(&path, Some("p1")).unwrap();
    assert_eq!(read_revealed_slot(&path, true).unwrap().model, "claude");
    assert_eq!(read_revealed_slot(&path, false).unwrap().model, "kimi");
    assert!(activate_profile(&path, "missing", None).is_err());
    assert!(set_polish_profile(&path, Some("missing")).is_err());
    let cleared = set_polish_profile(&path, None).unwrap();
    assert!(cleared.polish_profile_id.is_none());
    assert_eq!(read_revealed_slot(&path, true).unwrap().model, "kimi");
}

#[cfg(windows)]
#[test]
fn polish_profile_with_unreadable_key_fails_closed_without_echo() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("llm-provider.json");
    save_profile(&path, profile(None, "main", Some("main-test-sentinel"))).unwrap();
    save_profile(&path, profile(None, "polish", Some("polish-test-sentinel"))).unwrap();
    set_polish_profile(&path, Some("p2")).unwrap();
    let mut data = raw(&path);
    data["profiles"][1]["apiKey"]["ciphertext"] = json!("AAAA");
    fs::write(&path, data.to_string()).unwrap();
    let error = read_revealed_slot(&path, true).err().unwrap();
    assert!(!format!("{error:#}").contains("AAAA"));
    assert!(read_revealed_slot(&path, false).is_ok());
}

#[cfg(windows)]
#[test]
fn delete_keeps_current_and_last_and_resets_polish_choice() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("llm-provider.json");
    save_profile(&path, profile(None, "main", Some("main-test-sentinel"))).unwrap();
    assert!(delete_profile(&path, "p1").is_err(), "最后一套不能删");
    save_profile(&path, profile(None, "second", None)).unwrap();
    assert!(delete_profile(&path, "p1").is_err(), "正在用的不能删");
    set_polish_profile(&path, Some("p2")).unwrap();
    let after = delete_profile(&path, "p2").unwrap();
    assert_eq!(after.profiles.len(), 1);
    assert!(
        after.polish_profile_id.is_none(),
        "删掉指定的润色那套后回到跟随当前"
    );
    assert!(delete_profile(&path, "missing").is_err());
    assert_eq!(stored(&path).model, "main");
}

#[cfg(windows)]
#[test]
fn old_version_edit_of_top_level_is_written_back_into_current_profile() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("llm-provider.json");
    save_profile(&path, profile(None, "claude", Some("claude-test-sentinel"))).unwrap();
    save_profile(&path, profile(None, "kimi", Some("kimi-test-sentinel"))).unwrap();
    // 0.2.1 只认顶层：它改模型、换 key 后存盘，多套配置字段经 extra 原样留着。
    let mut data = raw(&path);
    data["model"] = json!("claude-edited-by-old-exe");
    data["apiKey"] =
        serde_json::to_value(ProtectedKey::protect("old-exe-test-sentinel").unwrap()).unwrap();
    fs::write(&path, data.to_string()).unwrap();
    let listed = list(&path).unwrap();
    assert_eq!(listed.active_profile_id.as_deref(), Some("p1"));
    let config = stored(&path);
    assert_eq!(
        stored_profile(&config, "p1").model,
        "claude-edited-by-old-exe"
    );
    assert_eq!(key_of(&config, "p1").unwrap(), "old-exe-test-sentinel");
    assert_eq!(stored_profile(&config, "p2").model, "kimi");
    assert_eq!(key_of(&config, "p2").unwrap(), "kimi-test-sentinel");
    let written = raw(&path);
    assert_eq!(written["profiles"][0]["model"], "claude-edited-by-old-exe");
}

#[cfg(windows)]
#[test]
fn dangling_active_id_is_repaired_from_the_top_level() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("llm-provider.json");
    save_profile(&path, profile(None, "claude", Some("claude-test-sentinel"))).unwrap();
    save_profile(&path, profile(None, "kimi", Some("kimi-test-sentinel"))).unwrap();
    activate_profile(&path, "p2", None).unwrap();
    let mut data = raw(&path);
    data["activeProfileId"] = json!("gone");
    data["polishProfileId"] = json!("gone-too");
    fs::write(&path, data.to_string()).unwrap();
    let listed = list(&path).unwrap();
    assert_eq!(listed.active_profile_id.as_deref(), Some("p2"));
    assert!(listed.polish_profile_id.is_none());
    assert_eq!(listed.profiles.len(), 2);
}

/// 0.2.1 的配置结构（逐字段照抄）：它读写新版文件时，多套配置字段必须原样留下。
#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct OldExeConfig {
    schema_version: u32,
    provider: String,
    base_url: String,
    model: String,
    api_key: Option<ProtectedKey>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    polish: Option<StoredLlmSlot>,
    #[serde(flatten)]
    extra: BTreeMap<String, Value>,
}

#[cfg(windows)]
#[test]
fn old_version_round_trip_keeps_profiles() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("llm-provider.json");
    save_profile(&path, profile(None, "claude", Some("claude-test-sentinel"))).unwrap();
    save_profile(&path, profile(None, "kimi", Some("kimi-test-sentinel"))).unwrap();
    set_polish_profile(&path, Some("p2")).unwrap();
    let before = list(&path).unwrap();
    let mut old: OldExeConfig = serde_json::from_slice(&fs::read(&path).unwrap()).unwrap();
    assert_eq!(old.schema_version, 2);
    assert_eq!(old.model, "claude");
    assert!(old.polish.is_none());
    old.base_url = "https://old-exe.invalid/v1".into();
    fs::write(&path, serde_json::to_vec_pretty(&old).unwrap()).unwrap();
    let after = list(&path).unwrap();
    assert_eq!(after.profiles.len(), 2);
    assert_eq!(after.polish_profile_id, before.polish_profile_id);
    assert_eq!(after.profiles[0].base_url, "https://old-exe.invalid/v1");
    assert_eq!(after.profiles[1].base_url, BASE);
}

#[cfg(windows)]
#[test]
fn not_same_device_reason_is_readable() {
    let reason = system_reason(&io::Error::from_raw_os_error(17));
    assert!(
        reason.starts_with("系统错误 17：ERROR_NOT_SAME_DEVICE，"),
        "{reason}"
    );
    assert!(!reason.contains("os error"), "{reason}");
}

#[cfg(windows)]
#[test]
fn v1_migration_write_back_failure_still_reads_and_save_reports_reason() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("llm-provider.json");
    let mut legacy = json!({"provider":"openai-compatible","baseUrl":BASE,
        "model":"test-model","apiKey":"main-test-sentinel"});
    legacy["polish"] = json!({"provider":"gemini","baseUrl":"https://polish.invalid","model":"p",
        "apiKey":"polish-test-sentinel"});
    let original = legacy.to_string();
    fs::write(&path, &original).unwrap();
    let lock = hold_read_only(&path);

    let listed = list(&path).unwrap();
    assert_eq!(listed.profiles.len(), 2);
    assert_eq!(listed.active_profile_id.as_deref(), Some("p1"));
    let main = read_revealed_slot(&path, false).unwrap();
    assert_eq!(
        (main.model.as_str(), main.api_key.as_deref()),
        ("test-model", Some("main-test-sentinel"))
    );
    assert_eq!(
        read_revealed_profile(&path, "p2")
            .unwrap()
            .api_key
            .as_deref(),
        Some("polish-test-sentinel")
    );

    let error = save_profile(&path, profile(Some("p1"), "m", Some("new-test-sentinel")))
        .err()
        .unwrap()
        .to_string();
    assert!(
        error.starts_with("无法原子替换 LLM 配置，原配置未更改（系统错误 "),
        "{error}"
    );
    assert!(!error.contains("test-sentinel") && !error.contains("ciphertext"));
    assert_eq!(fs::read_to_string(&path).unwrap(), original);
    assert_eq!(fs::read_dir(dir.path()).unwrap().count(), 1, "不留暂存文件");

    drop(lock);
    list(&path).unwrap();
    assert_eq!(raw(&path)["schemaVersion"], 2, "能写了，下次读取照常收口");
}

#[cfg(windows)]
#[test]
fn reconcile_write_back_failure_still_serves_the_old_version_edit() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("llm-provider.json");
    save_profile(&path, profile(None, "claude", Some("claude-test-sentinel"))).unwrap();
    save_profile(&path, profile(None, "kimi", Some("kimi-test-sentinel"))).unwrap();
    let mut data = raw(&path);
    data["model"] = json!("claude-edited-by-old-exe");
    data["apiKey"] =
        serde_json::to_value(ProtectedKey::protect("old-exe-test-sentinel").unwrap()).unwrap();
    let edited = data.to_string();
    fs::write(&path, &edited).unwrap();
    let lock = hold_read_only(&path);

    let main = read_revealed_slot(&path, false).unwrap();
    assert_eq!(
        (main.model.as_str(), main.api_key.as_deref()),
        ("claude-edited-by-old-exe", Some("old-exe-test-sentinel"))
    );
    let listed = list(&path).unwrap();
    assert_eq!(listed.profiles[0].model, "claude-edited-by-old-exe");
    assert_eq!(listed.profiles[1].model, "kimi");
    assert_eq!(fs::read_to_string(&path).unwrap(), edited);
    assert_eq!(fs::read_dir(dir.path()).unwrap().count(), 1, "不留暂存文件");
    drop(lock);
}

#[test]
fn ticked_models_switch_the_current_one_and_survive_saves_without_a_list() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("llm-provider.json");
    save_profile(&path, with_models(None, "b", &[" a ", "b", "", "a", "c"])).unwrap();
    assert_eq!(list(&path).unwrap().profiles[0].models, ["a", "b", "c"]);

    let listed = activate_profile(&path, "p1", Some(" c ")).unwrap();
    assert_eq!(listed.profiles[0].model, "c");
    assert_eq!(raw(&path)["model"], "c", "顶层照旧镜像当前那套");
    assert_eq!(read_revealed_slot(&path, false).unwrap().model, "c");

    let refused = activate_profile(&path, "p1", Some("not-ticked")).err().unwrap();
    assert!(refused.to_string().contains("不在这套配置勾选的列表里"));
    assert_eq!(list(&path).unwrap().profiles[0].model, "c");

    // 移除 Key 之类不带列表的保存：勾的那些原样留着；换了个没勾的当前模型就补进列表最前。
    save_profile(&path, clear_key("p1", "d")).unwrap();
    let after = list(&path).unwrap();
    assert_eq!(after.profiles[0].model, "d");
    assert_eq!(after.profiles[0].models, ["d", "a", "b", "c"]);
}

#[test]
fn files_without_a_model_list_show_the_current_model() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("llm-provider.json");
    save_profile(&path, profile(None, "m", None)).unwrap();
    let mut data = raw(&path);
    data["profiles"][0].as_object_mut().unwrap().remove("models");
    fs::write(&path, data.to_string()).unwrap();
    let listed = list(&path).unwrap();
    assert_eq!(listed.profiles[0].models, ["m"]);
    activate_profile(&path, "p1", Some("m")).unwrap();
    assert!(activate_profile(&path, "p1", Some("other")).is_err());
}
