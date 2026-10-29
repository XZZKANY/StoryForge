//! Versioned local config store. Only protected payloads reach the atomic writer.
//!
//! 多套模型配置存在同一个 v2 文件里：`profiles` / `activeProfileId` / `polishProfileId`
//! 是 0.2.1 不认识的字段，旧版读写时经 `extra` 原样保留；顶层 provider/baseUrl/model/apiKey
//! 始终镜像当前那套，旧版照旧能读能用。迁移与对账规则见 `profiles.rs`。
use crate::secret_protection::ProtectedKey;
use anyhow::{bail, Context, Result};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::BTreeMap;
use std::fs;
use std::io::{self, ErrorKind, Write};
use std::path::Path;
use std::sync::{Mutex, MutexGuard};

mod profiles;
pub use profiles::SaveLlmProfileRequest;
use profiles::StoredProfile;

// Serialize migration/save/read across Tauri commands and the startup worker.
static CONFIG_LOCK: Mutex<()> = Mutex::new(());

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct StoredLlmConfig {
    schema_version: u32,
    provider: String,
    base_url: String,
    model: String,
    api_key: Option<ProtectedKey>,
    // 0.2.1 的专用润色槽：只在第一次迁移时并入多套配置，之后新版不再读写它。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    polish: Option<StoredLlmSlot>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    profiles: Option<Vec<StoredProfile>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    active_profile_id: Option<String>,
    // None = 整章润色跟随当前那套。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    polish_profile_id: Option<String>,
    #[serde(flatten)]
    extra: BTreeMap<String, Value>,
}

impl Default for StoredLlmConfig {
    fn default() -> Self {
        Self {
            schema_version: 2,
            provider: String::new(),
            base_url: String::new(),
            model: String::new(),
            api_key: None,
            polish: None,
            profiles: None,
            active_profile_id: None,
            polish_profile_id: None,
            extra: BTreeMap::new(),
        }
    }
}

#[derive(Clone, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct StoredLlmSlot {
    provider: String,
    base_url: String,
    model: String,
    api_key: Option<ProtectedKey>,
    #[serde(flatten)]
    extra: BTreeMap<String, Value>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LlmProfileResponse {
    id: String,
    name: String,
    provider: String,
    base_url: String,
    model: String,
    has_api_key: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LlmProfilesResponse {
    profiles: Vec<LlmProfileResponse>,
    active_profile_id: Option<String>,
    polish_profile_id: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SavedLlmProfileResponse {
    #[serde(flatten)]
    config: LlmProfilesResponse,
    saved_profile_id: String,
}

impl From<&StoredLlmConfig> for LlmProfilesResponse {
    fn from(config: &StoredLlmConfig) -> Self {
        Self {
            profiles: config
                .profiles
                .iter()
                .flatten()
                .map(|profile| LlmProfileResponse {
                    id: profile.id.clone(),
                    name: profile.name.clone(),
                    provider: profile.provider.clone(),
                    base_url: profile.base_url.clone(),
                    model: profile.model.clone(),
                    has_api_key: profile.api_key.is_some(),
                })
                .collect(),
            active_profile_id: config.active_profile_id.clone(),
            polish_profile_id: config.polish_profile_id.clone(),
        }
    }
}

fn migrate_slot(slot: &mut Value, protect: &impl Fn(&str) -> Result<ProtectedKey>) -> Result<()> {
    let plaintext = slot
        .get("apiKey")
        .and_then(Value::as_str)
        .ok_or_else(|| anyhow::anyhow!("LLM 配置旧密钥格式无效"))?
        .trim();
    let protected = if plaintext.is_empty() {
        None
    } else {
        Some(protect(plaintext)?)
    };
    slot["apiKey"] =
        serde_json::to_value(protected).map_err(|_| anyhow::anyhow!("LLM 配置密钥编码失败"))?;
    Ok(())
}

fn validate_slot_shape(slot: &Value) -> Result<()> {
    if !slot.is_object() || slot.get("apiKey").is_none() {
        bail!("LLM 配置槽位格式无效");
    }
    Ok(())
}

// A v2 key is deliberately not decrypted here: the settings UI must still be
// able to replace/clear an unreadable key (e.g. copied from another machine).
// No plaintext is returned to UI; the Rust request boundary (engine_llm) fails closed.
fn load(path: &Path) -> Result<(StoredLlmConfig, bool)> {
    load_with_protector(path, &ProtectedKey::protect)
}

fn load_with_protector(
    path: &Path,
    protect: &impl Fn(&str) -> Result<ProtectedKey>,
) -> Result<(StoredLlmConfig, bool)> {
    let raw = match fs::read(path) {
        Ok(raw) => raw,
        // 文件不存在：读路径不为「落一份默认文件」写盘，第一次保存时才建。
        Err(error) if error.kind() == ErrorKind::NotFound => {
            let mut config = StoredLlmConfig::default();
            profiles::normalize(&mut config)?;
            return Ok((config, false));
        }
        Err(_) => bail!("无法读取 LLM 配置文件"),
    };
    let mut data: Value =
        serde_json::from_slice(&raw).map_err(|_| anyhow::anyhow!("LLM 配置文件格式无效"))?;
    let version = match data.get("schemaVersion") {
        None => 1,
        Some(value) => value
            .as_u64()
            .ok_or_else(|| anyhow::anyhow!("LLM 配置版本无效"))?,
    };
    if version != 1 && version != 2 {
        bail!("LLM 配置版本不支持");
    }
    validate_slot_shape(&data)?;
    if let Some(polish) = data.get("polish").filter(|value| !value.is_null()) {
        validate_slot_shape(polish)?;
    }
    if version == 1 {
        migrate_slot(&mut data, protect)?;
        if let Some(polish) = data.get_mut("polish").filter(|value| !value.is_null()) {
            migrate_slot(polish, protect)?;
        }
        data["schemaVersion"] = Value::from(2);
    }
    let mut config: StoredLlmConfig =
        serde_json::from_value(data).map_err(|_| anyhow::anyhow!("LLM 配置字段格式无效"))?;
    let normalized = profiles::normalize(&mut config)?;
    Ok((config, version == 1 || normalized))
}

#[cfg(windows)]
fn windows_error_name(code: i32) -> Option<&'static str> {
    Some(match code {
        5 => "ERROR_ACCESS_DENIED",
        17 => "ERROR_NOT_SAME_DEVICE",
        32 => "ERROR_SHARING_VIOLATION",
        33 => "ERROR_LOCK_VIOLATION",
        112 => "ERROR_DISK_FULL",
        _ => return None,
    })
}

#[cfg(not(windows))]
fn windows_error_name(_code: i32) -> Option<&'static str> {
    None
}

// 只取系统错误码与系统给的说明：io 错误不含配置内容，Key / 密文带不出来。
fn system_reason(error: &io::Error) -> String {
    let text = error.to_string();
    let Some(code) = error.raw_os_error() else {
        return text;
    };
    let suffix = format!(" (os error {code})");
    let detail = text.strip_suffix(&suffix).unwrap_or(&text).trim();
    let name = windows_error_name(code);
    match (name, detail.is_empty()) {
        (Some(name), false) => format!("系统错误 {code}：{name}，{detail}"),
        (Some(name), true) => format!("系统错误 {code}：{name}"),
        (None, false) => format!("系统错误 {code}：{detail}"),
        (None, true) => format!("系统错误 {code}"),
    }
}

// 界面与引擎只显示最外层一句（`to_string`），所以底层原因要拼进这一句里，不能挂在 context 链上。
fn write_failure(step: &str, error: &io::Error) -> anyhow::Error {
    anyhow::anyhow!("{step}（{}）", system_reason(error))
}

fn write(path: &Path, config: &StoredLlmConfig) -> Result<()> {
    let parent = path.parent().context("LLM 配置目录无效")?;
    fs::create_dir_all(parent).map_err(|error| write_failure("无法创建 LLM 配置目录", &error))?;
    // Existing manuscript/shadow Git writers have private, domain-specific seams.
    // NamedTempFile provides exclusive staging + failure cleanup without changing them.
    let mut staged = tempfile::NamedTempFile::new_in(parent)
        .map_err(|error| write_failure("无法暂存 LLM 配置", &error))?;
    serde_json::to_writer_pretty(staged.as_file_mut(), config)
        .map_err(|error| write_failure("无法序列化 LLM 配置", &error.into()))?;
    staged
        .as_file_mut()
        .flush()
        .map_err(|error| write_failure("无法暂存 LLM 配置", &error))?;
    staged
        .as_file()
        .sync_all()
        .map_err(|error| write_failure("无法同步 LLM 配置", &error))?;
    // 不做「替换失败就复制覆盖」：那样不再原子，写到一半会留下坏文件。
    staged
        .persist(path)
        .map_err(|error| write_failure("无法原子替换 LLM 配置，原配置未更改", &error.error))?;
    Ok(())
}

fn lock() -> Result<MutexGuard<'static, ()>> {
    CONFIG_LOCK
        .lock()
        .map_err(|_| anyhow::anyhow!("LLM 配置锁不可用"))
}

// 读取即收口：旧版配置迁移、旧版改过顶层后的对账都在这里原子写回（加密失败则原文件不动）。
// 写回只是顺手收口：失败时原文件不动，本次照用内存里规范化好的配置，下次读取再试；
// 读配置（含模型调用前取 Key）不能因为写不了盘而失败。作者主动保存走 `mutate`，失败照实报错。
fn read_normalized(
    path: &Path,
    protect: &impl Fn(&str) -> Result<ProtectedKey>,
) -> Result<StoredLlmConfig> {
    let (config, needs_write) = load_with_protector(path, protect)?;
    if needs_write {
        if let Err(error) = write(path, &config) {
            eprintln!("[llm-config] 读取时写回规范化配置失败，本次照用内存里的配置：{error}");
        }
    }
    Ok(config)
}

/// 列出多套配置（不含密钥，只给有没有存）。
pub fn list(path: &Path) -> Result<LlmProfilesResponse> {
    list_with_protector(path, &ProtectedKey::protect)
}

fn list_with_protector(
    path: &Path,
    protect: &impl Fn(&str) -> Result<ProtectedKey>,
) -> Result<LlmProfilesResponse> {
    let _guard = lock()?;
    Ok((&read_normalized(path, protect)?).into())
}

fn mutate<T>(
    path: &Path,
    change: impl FnOnce(&mut StoredLlmConfig) -> Result<T>,
) -> Result<(StoredLlmConfig, T)> {
    let _guard = lock()?;
    let (mut config, _) = load(path)?;
    let output = change(&mut config)?;
    write(path, &config)?;
    Ok((config, output))
}

/// 新建（不带 id）或更新一套；Key 留空 = 保持原样，`clearApiKey` = 清除。
pub fn save_profile(
    path: &Path,
    payload: SaveLlmProfileRequest,
) -> Result<SavedLlmProfileResponse> {
    let (config, saved_profile_id) = mutate(path, |config| profiles::upsert(config, payload))?;
    Ok(SavedLlmProfileResponse {
        config: (&config).into(),
        saved_profile_id,
    })
}

/// 删除一套；当前那套与最后一套不能删。
pub fn delete_profile(path: &Path, id: &str) -> Result<LlmProfilesResponse> {
    Ok((&mutate(path, |config| profiles::remove(config, id))?.0).into())
}

/// 切换当前那套；下一次模型调用即生效（出网每次重读本文件）。
pub fn activate_profile(path: &Path, id: &str) -> Result<LlmProfilesResponse> {
    Ok((&mutate(path, |config| profiles::activate(config, id))?.0).into())
}

/// 整章润色用哪套：None = 跟随当前那套。
pub fn set_polish_profile(path: &Path, id: Option<&str>) -> Result<LlmProfilesResponse> {
    Ok((&mutate(path, |config| profiles::set_polish(config, id))?.0).into())
}

// Deliberately no Debug/Serialize: the revealed key must stay inside Rust egress.
pub struct RevealedSlot {
    pub provider: String,
    pub base_url: String,
    pub model: String,
    pub api_key: Option<String>,
}

fn reveal(
    provider: &str,
    base_url: &str,
    model: &str,
    api_key: Option<&ProtectedKey>,
) -> Result<RevealedSlot> {
    Ok(RevealedSlot {
        provider: provider.trim().into(),
        base_url: base_url.trim().into(),
        model: model.trim().into(),
        api_key: api_key
            .map(|key| key.reveal().map(|value| value.trim().to_string()))
            .transpose()?,
    })
}

/// Engine egress only. main = 当前那套；polish = 指定的那套，没指定或已不存在时也用当前那套。
pub fn read_revealed_slot(path: &Path, polish: bool) -> Result<RevealedSlot> {
    let _guard = lock()?;
    let config = read_normalized(path, &ProtectedKey::protect)?;
    match profiles::resolve(&config, polish) {
        Some(profile) => reveal(
            &profile.provider,
            &profile.base_url,
            &profile.model,
            profile.api_key.as_ref(),
        ),
        // 一套都还没存：顶层也是空的，引擎据此报「还没配置」。
        None => reveal(
            &config.provider,
            &config.base_url,
            &config.model,
            config.api_key.as_ref(),
        ),
    }
}

/// 设置页「获取模型」借用某套已存的 Key（只在 Rust 里用，不回给界面）。
pub fn read_revealed_profile(path: &Path, id: &str) -> Result<RevealedSlot> {
    let _guard = lock()?;
    let config = read_normalized(path, &ProtectedKey::protect)?;
    let profile = profiles::find(&config, id)?;
    reveal(
        &profile.provider,
        &profile.base_url,
        &profile.model,
        profile.api_key.as_ref(),
    )
}

#[cfg(test)]
mod tests;
