//! Versioned local config store. Only protected payloads reach the atomic writer.
use crate::secret_protection::ProtectedKey;
use anyhow::{bail, Context, Result};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::BTreeMap;
use std::fs;
use std::io::{ErrorKind, Write};
use std::path::Path;
use std::sync::Mutex;

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
    #[serde(default, skip_serializing_if = "Option::is_none")]
    polish: Option<StoredLlmSlot>,
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

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveLlmConfigRequest {
    provider: String,
    base_url: String,
    model: String,
    api_key: Option<String>,
    clear_api_key: Option<bool>,
    polish: Option<SaveLlmSlotRequest>,
}

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveLlmSlotRequest {
    provider: String,
    base_url: String,
    model: String,
    api_key: Option<String>,
    clear_api_key: Option<bool>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LlmConfigResponse {
    provider: String,
    base_url: String,
    model: String,
    has_api_key: bool,
    polish: Option<LlmSlotResponse>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LlmSlotResponse {
    provider: String,
    base_url: String,
    model: String,
    has_api_key: bool,
}

impl From<StoredLlmConfig> for LlmConfigResponse {
    fn from(config: StoredLlmConfig) -> Self {
        Self {
            provider: config.provider,
            base_url: config.base_url,
            model: config.model,
            has_api_key: config.api_key.is_some(),
            polish: config.polish.map(Into::into),
        }
    }
}

impl From<StoredLlmSlot> for LlmSlotResponse {
    fn from(config: StoredLlmSlot) -> Self {
        Self {
            provider: config.provider,
            base_url: config.base_url,
            model: config.model,
            has_api_key: config.api_key.is_some(),
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
// No plaintext is returned to UI; the Python request boundary fails closed.
fn load(path: &Path) -> Result<(StoredLlmConfig, bool)> {
    load_with_protector(path, &ProtectedKey::protect)
}

fn load_with_protector(
    path: &Path,
    protect: &impl Fn(&str) -> Result<ProtectedKey>,
) -> Result<(StoredLlmConfig, bool)> {
    let raw = match fs::read(path) {
        Ok(raw) => raw,
        Err(error) if error.kind() == ErrorKind::NotFound => {
            return Ok((StoredLlmConfig::default(), true))
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
    let config =
        serde_json::from_value(data).map_err(|_| anyhow::anyhow!("LLM 配置字段格式无效"))?;
    Ok((config, version == 1))
}

fn write(path: &Path, config: &StoredLlmConfig) -> Result<()> {
    let parent = path.parent().context("LLM 配置目录无效")?;
    fs::create_dir_all(parent).context("无法创建 LLM 配置目录")?;
    // Existing manuscript/shadow Git writers have private, domain-specific seams.
    // NamedTempFile provides exclusive staging + failure cleanup without changing them.
    let mut staged = tempfile::NamedTempFile::new_in(parent).context("无法暂存 LLM 配置")?;
    serde_json::to_writer_pretty(&mut staged, config).context("无法序列化 LLM 配置")?;
    staged.flush().context("无法暂存 LLM 配置")?;
    staged.as_file().sync_all().context("无法同步 LLM 配置")?;
    staged
        .persist(path)
        .map_err(|_| anyhow::anyhow!("无法原子替换 LLM 配置，原配置未更改"))?;
    Ok(())
}

pub fn prepare(path: &Path) -> Result<()> {
    prepare_with_protector(path, &ProtectedKey::protect)
}

fn prepare_with_protector(
    path: &Path,
    protect: &impl Fn(&str) -> Result<ProtectedKey>,
) -> Result<()> {
    let _guard = CONFIG_LOCK
        .lock()
        .map_err(|_| anyhow::anyhow!("LLM 配置锁不可用"))?;
    let (config, needs_write) = load_with_protector(path, protect)?;
    if needs_write {
        write(path, &config)?;
    }
    Ok(())
}

pub fn read(path: &Path) -> Result<LlmConfigResponse> {
    let _guard = CONFIG_LOCK
        .lock()
        .map_err(|_| anyhow::anyhow!("LLM 配置锁不可用"))?;
    let (config, needs_write) = load(path)?;
    if needs_write {
        write(path, &config)?;
    }
    Ok(config.into())
}

fn update_key(
    key: &mut Option<ProtectedKey>,
    input: Option<String>,
    clear: Option<bool>,
) -> Result<()> {
    if clear.unwrap_or(false) {
        *key = None;
    } else if let Some(value) = input.filter(|value| !value.trim().is_empty()) {
        *key = Some(ProtectedKey::protect(value.trim())?);
    }
    Ok(())
}

pub fn save(path: &Path, payload: SaveLlmConfigRequest) -> Result<LlmConfigResponse> {
    let _guard = CONFIG_LOCK
        .lock()
        .map_err(|_| anyhow::anyhow!("LLM 配置锁不可用"))?;
    let (mut next, _) = load(path)?;
    next.provider = payload.provider.trim().into();
    next.base_url = payload.base_url.trim().into();
    next.model = payload.model.trim().into();
    update_key(&mut next.api_key, payload.api_key, payload.clear_api_key)?;
    if let Some(polish) = payload.polish {
        let slot = next.polish.get_or_insert_with(StoredLlmSlot::default);
        slot.provider = polish.provider.trim().into();
        slot.base_url = polish.base_url.trim().into();
        slot.model = polish.model.trim().into();
        update_key(&mut slot.api_key, polish.api_key, polish.clear_api_key)?;
    }
    write(path, &next)?;
    Ok(next.into())
}

#[cfg(test)]
mod tests;
