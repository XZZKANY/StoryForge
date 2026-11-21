use crate::secret_protection::ProtectedKey;
use serde::{Deserialize, Serialize};
use std::fs;
use std::io::{Read, Write};
use std::path::Path;
use std::sync::{Mutex, MutexGuard};

const MAX_CONFIG_BYTES: u64 = 32 * 1024;
static CONFIG_LOCK: Mutex<()> = Mutex::new(());

#[derive(Debug, Clone, Copy, Default, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum SearchProvider {
    #[default]
    Tavily,
    Openai,
}

#[derive(Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct StoredConfig {
    schema_version: u32,
    enabled: bool,
    api_key: Option<ProtectedKey>,
    #[serde(default)]
    provider: SearchProvider,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConfigView {
    pub enabled: bool,
    pub has_api_key: bool,
    pub provider: SearchProvider,
    pub openai_ready: bool,
    pub openai_model: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SaveConfig {
    pub enabled: bool,
    pub provider: Option<SearchProvider>,
    pub api_key: Option<String>,
    #[serde(default)]
    pub clear_api_key: bool,
}

fn lock() -> Result<MutexGuard<'static, ()>, String> {
    CONFIG_LOCK
        .lock()
        .map_err(|_| "联网搜索配置暂不可用，请重新打开应用。".into())
}

fn read(path: &Path) -> Result<StoredConfig, String> {
    let file = match fs::File::open(path) {
        Ok(file) => file,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            return Ok(StoredConfig {
                schema_version: 1,
                ..Default::default()
            })
        }
        Err(_) => return Err("无法读取联网搜索配置。".into()),
    };
    let mut bytes = Vec::new();
    file.take(MAX_CONFIG_BYTES + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| "无法读取联网搜索配置。")?;
    if bytes.len() as u64 > MAX_CONFIG_BYTES {
        return Err("联网搜索配置文件超过读取上限。".into());
    }
    let config: StoredConfig =
        serde_json::from_slice(&bytes).map_err(|_| "联网搜索配置格式无效，请检查配置文件。")?;
    if config.schema_version != 1 {
        return Err("联网搜索配置版本不受支持。".into());
    }
    Ok(config)
}

fn view(config: &StoredConfig) -> ConfigView {
    ConfigView {
        enabled: config.enabled,
        has_api_key: config.api_key.is_some(),
        provider: config.provider,
        openai_ready: false,
        openai_model: None,
    }
}

pub fn get(path: &Path) -> Result<ConfigView, String> {
    let _guard = lock()?;
    read(path).map(|config| view(&config))
}

pub fn save(path: &Path, request: SaveConfig) -> Result<ConfigView, String> {
    let _guard = lock()?;
    let mut config = read(path)?;
    let provider = request.provider.unwrap_or(config.provider);
    let provided = request
        .api_key
        .as_deref()
        .map(str::trim)
        .filter(|key| !key.is_empty());
    if provider == SearchProvider::Openai && (request.clear_api_key || provided.is_some()) {
        return Err("OpenAI 搜索复用模型服务配置，不能在这里修改模型密钥。".into());
    }
    if request.clear_api_key && provided.is_some() {
        return Err("不能同时清除和更新搜索密钥。".into());
    }
    if request.clear_api_key {
        config.api_key = None;
    }
    if let Some(key) = provided {
        if !(6..=4096).contains(&key.len()) || key.chars().any(char::is_control) {
            return Err("搜索密钥格式无效。".into());
        }
        config.api_key =
            Some(ProtectedKey::protect(key).map_err(|_| "无法加密搜索密钥，原配置未更改。")?);
    }
    if request.enabled && provider == SearchProvider::Tavily && config.api_key.is_none() {
        return Err("请先填写 Tavily API Key，再启用联网搜索。".into());
    }
    config.enabled = request.enabled;
    config.provider = provider;
    let parent = path.parent().ok_or("联网搜索配置目录无效。")?;
    fs::create_dir_all(parent).map_err(|_| "无法创建联网搜索配置目录。")?;
    let mut staged =
        tempfile::NamedTempFile::new_in(parent).map_err(|_| "无法暂存联网搜索配置。")?;
    serde_json::to_writer_pretty(staged.as_file_mut(), &config)
        .map_err(|_| "无法序列化联网搜索配置。")?;
    staged
        .as_file_mut()
        .flush()
        .map_err(|_| "无法保存联网搜索配置。")?;
    staged
        .as_file()
        .sync_all()
        .map_err(|_| "无法同步联网搜索配置。")?;
    staged
        .persist(path)
        .map_err(|_| "无法原子替换联网搜索配置，原配置未更改。")?;
    Ok(view(&config))
}

/// 一次取到开关、服务与对应凭据，防止两次读配置之间切服务而拿错密钥。
pub enum SearchAccess {
    Tavily(String),
    Openai,
}
pub fn access(path: &Path) -> Result<SearchAccess, String> {
    let _guard = lock()?;
    let config = read(path)?;
    if !config.enabled {
        return Err("联网搜索未启用，请在设置中启用。".into());
    }
    if config.provider == SearchProvider::Openai {
        return Ok(SearchAccess::Openai);
    }
    let key = config
        .api_key
        .as_ref()
        .ok_or("未配置 Tavily API Key，请先到设置中填写。")?
        .reveal()
        .map_err(|_| "搜索密钥无法解密，请在设置中重新填写。")?;
    Ok(SearchAccess::Tavily(key))
}

/// 原Tavily测试路径，正式执行使用一次性快照access。
#[cfg(test)]
pub fn credential(path: &Path) -> Result<String, String> {
    let _guard = lock()?;
    let config = read(path)?;
    if !config.enabled {
        return Err("联网搜索未启用，请在设置中启用。".into());
    }
    config
        .api_key
        .as_ref()
        .ok_or("未配置 Tavily API Key，请先到设置中填写。")?
        .reveal()
        .map_err(|_| "搜索密钥无法解密，请在设置中重新填写。".into())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn missing_configuration_is_disabled_and_cannot_search() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("web-search.json");
        let config = get(&path).unwrap();
        assert!(!config.enabled && !config.has_api_key);
        assert!(credential(&path).unwrap_err().contains("未启用"));
        assert!(save(
            &path,
            SaveConfig {
                provider: None,
                enabled: true,
                api_key: None,
                clear_api_key: false
            }
        )
        .is_err());
        assert!(!path.exists());
    }

    #[test]
    fn corrupt_or_oversized_configuration_is_not_silently_replaced() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("web-search.json");
        for text in ["{bad".to_owned(), " ".repeat(MAX_CONFIG_BYTES as usize + 1)] {
            fs::write(&path, &text).unwrap();
            assert!(get(&path).is_err());
            assert!(save(
                &path,
                SaveConfig {
                    provider: None,
                    enabled: false,
                    api_key: None,
                    clear_api_key: false
                }
            )
            .is_err());
            assert_eq!(fs::read_to_string(&path).unwrap(), text);
        }
    }

    #[cfg(windows)]
    #[test]
    fn key_is_encrypted_preserved_replaced_and_cleared_without_leaking() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("web-search.json");
        let key = "tvly-unit-test-secret-not-a-real-key";
        let config = save(
            &path,
            SaveConfig {
                provider: None,
                enabled: true,
                api_key: Some(key.into()),
                clear_api_key: false,
            },
        )
        .unwrap();
        assert!(config.enabled && config.has_api_key);
        let bytes = fs::read_to_string(&path).unwrap();
        assert!(!bytes.contains(key));
        assert!(bytes.contains("windows-dpapi-user-v1"));
        assert!(!serde_json::to_string(&config).unwrap().contains(key));
        assert_eq!(credential(&path).unwrap(), key);
        for api_key in [None, Some(" ".into())] {
            save(
                &path,
                SaveConfig {
                    provider: None,
                    enabled: true,
                    api_key,
                    clear_api_key: false,
                },
            )
            .unwrap();
            assert_eq!(credential(&path).unwrap(), key);
        }
        let before = fs::read(&path).unwrap();
        assert!(save(
            &path,
            SaveConfig {
                provider: None,
                enabled: true,
                api_key: None,
                clear_api_key: true
            }
        )
        .is_err());
        assert_eq!(fs::read(&path).unwrap(), before);
        assert!(save(
            &path,
            SaveConfig {
                provider: None,
                enabled: true,
                api_key: Some("bad\nkey".into()),
                clear_api_key: false
            }
        )
        .is_err());
        assert_eq!(fs::read(&path).unwrap(), before);
        save(
            &path,
            SaveConfig {
                provider: None,
                enabled: false,
                api_key: None,
                clear_api_key: false,
            },
        )
        .unwrap();
        assert!(credential(&path).unwrap_err().contains("未启用"));
        let cleared = save(
            &path,
            SaveConfig {
                provider: None,
                enabled: false,
                api_key: None,
                clear_api_key: true,
            },
        )
        .unwrap();
        assert!(!cleared.has_api_key);
        assert!(!fs::read_to_string(&path).unwrap().contains("ciphertext"));
    }
    #[test]
    fn old_tavily_configuration_migrates_without_losing_provider_or_key() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("web-search.json");
        fs::write(
            &path,
            r#"{"schemaVersion":1,"enabled":false,"apiKey":null}"#,
        )
        .unwrap();
        assert_eq!(get(&path).unwrap().provider, SearchProvider::Tavily);
        let selected = save(
            &path,
            SaveConfig {
                enabled: false,
                provider: Some(SearchProvider::Openai),
                api_key: None,
                clear_api_key: false,
            },
        )
        .unwrap();
        assert_eq!(selected.provider, SearchProvider::Openai);
        assert!(access(&path).is_err());
        let enabled = save(
            &path,
            SaveConfig {
                enabled: true,
                provider: None,
                api_key: None,
                clear_api_key: false,
            },
        )
        .unwrap();
        assert_eq!(enabled.provider, SearchProvider::Openai);
        assert!(matches!(access(&path).unwrap(), SearchAccess::Openai));
        let before = fs::read(&path).unwrap();
        assert!(save(
            &path,
            SaveConfig {
                enabled: true,
                provider: Some(SearchProvider::Tavily),
                api_key: None,
                clear_api_key: false
            }
        )
        .is_err());
        assert_eq!(fs::read(&path).unwrap(), before);
        assert!(serde_json::from_str::<SaveConfig>(
            r#"{"enabled":true,"provider":"evil","apiKey":null}"#
        )
        .is_err());
    }
    #[cfg(windows)]
    #[test]
    fn provider_switch_retains_tavily_secret_without_copying_model_credentials() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("web-search.json");
        let key = "synthetic-tavily-preserved-key";
        save(
            &path,
            SaveConfig {
                enabled: true,
                provider: Some(SearchProvider::Tavily),
                api_key: Some(key.into()),
                clear_api_key: false,
            },
        )
        .unwrap();
        let original: serde_json::Value =
            serde_json::from_slice(&fs::read(&path).unwrap()).unwrap();
        save(
            &path,
            SaveConfig {
                enabled: true,
                provider: Some(SearchProvider::Openai),
                api_key: None,
                clear_api_key: false,
            },
        )
        .unwrap();
        assert!(matches!(access(&path).unwrap(), SearchAccess::Openai));
        let switched: serde_json::Value =
            serde_json::from_slice(&fs::read(&path).unwrap()).unwrap();
        assert_eq!(original["apiKey"], switched["apiKey"]);
        assert!(save(
            &path,
            SaveConfig {
                enabled: true,
                provider: None,
                api_key: Some("accidental-model-secret".into()),
                clear_api_key: false
            }
        )
        .is_err());
        save(
            &path,
            SaveConfig {
                enabled: true,
                provider: Some(SearchProvider::Tavily),
                api_key: None,
                clear_api_key: false,
            },
        )
        .unwrap();
        match access(&path).unwrap() {
            SearchAccess::Tavily(value) => assert_eq!(value, key),
            _ => panic!("wrong provider"),
        }
    }
}
