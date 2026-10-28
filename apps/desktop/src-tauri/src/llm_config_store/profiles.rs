//! 多套模型配置：迁移、旧版回写对账、增删改切。只动内存里的配置，落盘归上层。
//!
//! - 第一次用新版打开（没有 `profiles`）：顶层那套成为「默认」并设为当前；0.2.1 的专用
//!   润色槽若完整且与顶层不同，另成一套「润色（旧配置）」，但润色仍跟随当前（作者拍板）。
//!   润色槽随后从文件里去掉（密文原样搬进新的一套，不解密重加密）。
//! - 顶层始终镜像当前那套；若两者不一致，说明 0.2.1 存过盘，以顶层为准写回当前那套。
use super::StoredLlmConfig;
use crate::secret_protection::ProtectedKey;
use anyhow::{bail, Result};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::{BTreeMap, BTreeSet};

pub(super) const MIGRATED_MAIN_NAME: &str = "默认";
pub(super) const MIGRATED_POLISH_NAME: &str = "润色（旧配置）";

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct StoredProfile {
    pub(super) id: String,
    #[serde(default)]
    pub(super) name: String,
    pub(super) provider: String,
    pub(super) base_url: String,
    pub(super) model: String,
    pub(super) api_key: Option<ProtectedKey>,
    #[serde(flatten)]
    pub(super) extra: BTreeMap<String, Value>,
}

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveLlmProfileRequest {
    id: Option<String>,
    name: String,
    provider: String,
    base_url: String,
    model: String,
    api_key: Option<String>,
    clear_api_key: Option<bool>,
}

/// 一套配置里决定出网去向与身份的四样东西。
#[derive(Clone, PartialEq)]
struct Settings {
    provider: String,
    base_url: String,
    model: String,
    api_key: Option<ProtectedKey>,
}

impl Settings {
    fn of_top(config: &StoredLlmConfig) -> Self {
        Self {
            provider: config.provider.clone(),
            base_url: config.base_url.clone(),
            model: config.model.clone(),
            api_key: config.api_key.clone(),
        }
    }

    fn of(profile: &StoredProfile) -> Self {
        Self {
            provider: profile.provider.clone(),
            base_url: profile.base_url.clone(),
            model: profile.model.clone(),
            api_key: profile.api_key.clone(),
        }
    }

    fn is_empty(&self) -> bool {
        self.provider.trim().is_empty()
            && self.base_url.trim().is_empty()
            && self.model.trim().is_empty()
            && self.api_key.is_none()
    }

    fn is_complete(&self) -> bool {
        !self.provider.trim().is_empty()
            && !self.base_url.trim().is_empty()
            && !self.model.trim().is_empty()
            && self.api_key.is_some()
    }

    // DPAPI 每次加密结果都不同：同一个 key 存两次密文也不同，所以密文不同时再比明文。
    fn same_as(&self, other: &Self) -> bool {
        let same_key = match (&self.api_key, &other.api_key) {
            (None, None) => true,
            (Some(left), Some(right)) => {
                left == right || matches!((left.reveal(), right.reveal()), (Ok(a), Ok(b)) if a == b)
            }
            _ => false,
        };
        same_key
            && self.provider == other.provider
            && self.base_url == other.base_url
            && self.model == other.model
    }

    fn apply_to(self, profile: &mut StoredProfile) {
        profile.provider = self.provider;
        profile.base_url = self.base_url;
        profile.model = self.model;
        profile.api_key = self.api_key;
    }

    fn apply_to_top(self, config: &mut StoredLlmConfig) {
        config.provider = self.provider;
        config.base_url = self.base_url;
        config.model = self.model;
        config.api_key = self.api_key;
    }

    fn into_profile(self, id: String, name: &str) -> StoredProfile {
        StoredProfile {
            id,
            name: name.into(),
            provider: self.provider,
            base_url: self.base_url,
            model: self.model,
            api_key: self.api_key,
            extra: BTreeMap::new(),
        }
    }
}

fn next_id(profiles: &[StoredProfile]) -> String {
    (profiles.len() + 1..)
        .map(|n| format!("p{n}"))
        .find(|id| profiles.iter().all(|profile| &profile.id != id))
        .expect("an unbounded range always yields a free id")
}

fn validate_ids(profiles: &[StoredProfile]) -> Result<()> {
    let mut seen = BTreeSet::new();
    for profile in profiles {
        if profile.id.trim().is_empty() || !seen.insert(profile.id.as_str()) {
            bail!("LLM 配置里多套模型的编号无效");
        }
    }
    Ok(())
}

fn position(profiles: &[StoredProfile], id: &str) -> Option<usize> {
    profiles.iter().position(|profile| profile.id == id)
}

/// 迁移 + 对账；返回是否改动（需要写回）。
pub(super) fn normalize(config: &mut StoredLlmConfig) -> Result<bool> {
    let mut changed = false;
    let legacy_polish = if config.profiles.is_none() {
        config.profiles = Some(Vec::new());
        changed = true;
        config.polish.take()
    } else {
        None
    };
    let top = Settings::of_top(config);
    let profiles = config.profiles.get_or_insert_with(Vec::new);
    validate_ids(profiles)?;
    let current = config
        .active_profile_id
        .as_deref()
        .and_then(|id| position(profiles, id));
    let mut mirror_to_top = None;
    let active = match current {
        Some(index) => {
            if Settings::of(&profiles[index]) != top {
                top.clone().apply_to(&mut profiles[index]);
                changed = true;
            }
            Some(index)
        }
        None => {
            let matching = profiles
                .iter()
                .position(|profile| Settings::of(profile) == top);
            let index = if matching.is_some() {
                matching
            } else if !top.is_empty() {
                let id = next_id(profiles);
                profiles.push(top.clone().into_profile(id, MIGRATED_MAIN_NAME));
                Some(profiles.len() - 1)
            } else if profiles.is_empty() {
                None
            } else {
                Some(0)
            };
            if let Some(index) = index {
                let chosen = Settings::of(&profiles[index]);
                if chosen != top {
                    mirror_to_top = Some(chosen);
                }
            }
            index
        }
    };
    if let Some(slot) = legacy_polish {
        let candidate = Settings {
            provider: slot.provider,
            base_url: slot.base_url,
            model: slot.model,
            api_key: slot.api_key,
        };
        if candidate.is_complete() && !candidate.same_as(&top) {
            let id = next_id(profiles);
            profiles.push(candidate.into_profile(id, MIGRATED_POLISH_NAME));
        }
    }
    let active_id = active.map(|index| profiles[index].id.clone());
    let polish_valid = config
        .polish_profile_id
        .as_deref()
        .is_none_or(|id| position(profiles, id).is_some());
    if config.active_profile_id != active_id {
        config.active_profile_id = active_id;
        changed = true;
    }
    if !polish_valid {
        config.polish_profile_id = None;
        changed = true;
    }
    if let Some(settings) = mirror_to_top {
        settings.apply_to_top(config);
        changed = true;
    }
    Ok(changed)
}

fn profiles_mut(config: &mut StoredLlmConfig) -> &mut Vec<StoredProfile> {
    config.profiles.get_or_insert_with(Vec::new)
}

pub(super) fn find<'a>(config: &'a StoredLlmConfig, id: &str) -> Result<&'a StoredProfile> {
    config
        .profiles
        .iter()
        .flatten()
        .find(|profile| profile.id == id)
        .ok_or_else(|| anyhow::anyhow!("这套模型配置已经不在了，请重新打开设置再试"))
}

fn sync_top(config: &mut StoredLlmConfig) {
    let active = config
        .active_profile_id
        .as_deref()
        .and_then(|id| find(config, id).ok())
        .map(Settings::of);
    if let Some(settings) = active {
        settings.apply_to_top(config);
    }
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

/// 返回保存的那套的编号。第一套自动成为当前那套。
pub(super) fn upsert(
    config: &mut StoredLlmConfig,
    payload: SaveLlmProfileRequest,
) -> Result<String> {
    let profiles = profiles_mut(config);
    let index = match payload.id.as_deref() {
        Some(id) => position(profiles, id)
            .ok_or_else(|| anyhow::anyhow!("这套模型配置已经不在了，请重新打开设置再试"))?,
        None => {
            let id = next_id(profiles);
            profiles.push(StoredProfile {
                id,
                name: String::new(),
                provider: String::new(),
                base_url: String::new(),
                model: String::new(),
                api_key: None,
                extra: BTreeMap::new(),
            });
            profiles.len() - 1
        }
    };
    let mut key = profiles[index].api_key.clone();
    update_key(&mut key, payload.api_key, payload.clear_api_key)?;
    let profile = &mut profiles[index];
    profile.name = payload.name.trim().into();
    profile.provider = payload.provider.trim().into();
    profile.base_url = payload.base_url.trim().into();
    profile.model = payload.model.trim().into();
    profile.api_key = key;
    let id = profile.id.clone();
    if config.active_profile_id.is_none() {
        config.active_profile_id = Some(id.clone());
    }
    sync_top(config);
    Ok(id)
}

pub(super) fn remove(config: &mut StoredLlmConfig, id: &str) -> Result<()> {
    find(config, id)?;
    if config.active_profile_id.as_deref() == Some(id) {
        bail!("正在用的这套不能删；先切到别的那套再删");
    }
    let profiles = profiles_mut(config);
    if profiles.len() <= 1 {
        bail!("至少要留一套模型配置");
    }
    profiles.retain(|profile| profile.id != id);
    if config.polish_profile_id.as_deref() == Some(id) {
        config.polish_profile_id = None;
    }
    Ok(())
}

pub(super) fn activate(config: &mut StoredLlmConfig, id: &str) -> Result<()> {
    find(config, id)?;
    config.active_profile_id = Some(id.into());
    sync_top(config);
    Ok(())
}

pub(super) fn set_polish(config: &mut StoredLlmConfig, id: Option<&str>) -> Result<()> {
    if let Some(id) = id {
        find(config, id)?;
    }
    config.polish_profile_id = id.map(Into::into);
    Ok(())
}

/// 出网用哪套：润色优先指定的那套，其余（含润色没指定）都是当前那套。
pub(super) fn resolve(config: &StoredLlmConfig, polish: bool) -> Option<&StoredProfile> {
    let dedicated = polish
        .then_some(config.polish_profile_id.as_deref())
        .flatten()
        .and_then(|id| find(config, id).ok());
    dedicated.or_else(|| {
        config
            .active_profile_id
            .as_deref()
            .and_then(|id| find(config, id).ok())
    })
}
